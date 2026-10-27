package io.kafbat.ui.emitter;

import io.kafbat.ui.model.ConsumerPosition;
import io.kafbat.ui.model.TopicMessageDTO;
import io.kafbat.ui.model.TopicMessageEventDTO;
import io.kafbat.ui.serdes.ConsumerRecordDeserializer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;
import java.util.function.Supplier;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.errors.InterruptException;
import org.apache.kafka.common.utils.Bytes;
import reactor.core.publisher.FluxSink;

@Slf4j
public class TailingEmitter extends AbstractEmitter {

  private final Supplier<EnhancedConsumer> consumerSupplier;
  private final ConsumerPosition consumerPosition;
  private final int recentMessagesLimit;

  public TailingEmitter(Supplier<EnhancedConsumer> consumerSupplier,
                        ConsumerPosition consumerPosition,
                        ConsumerRecordDeserializer deserializer,
                        Predicate<TopicMessageDTO> filter,
                        PollingSettings pollingSettings,
                        int recentMessagesLimit) {
    super(
      MessagesProcessing.create(deserializer, filter, false, recentMessagesLimit),
      pollingSettings);
    this.consumerSupplier = consumerSupplier;
    this.consumerPosition = consumerPosition;
    this.recentMessagesLimit = recentMessagesLimit;
  }

  @Override
  public void accept(FluxSink<TopicMessageEventDTO> sink) {
    log.debug("Starting tailing polling for {}", consumerPosition);
    try (EnhancedConsumer consumer = consumerSupplier.get()) {
      Snapshot snapshot = loadRecentMessages(consumer, sink);
      if (sink.isCancelled()) {
        return;
      }

      sendPhase(sink, "Recent messages loaded");
      send(sink, snapshot.historicalRecords(), null);
      prepareForLiveTailing();
      sendPhase(sink, "Live polling");
      send(sink, snapshot.bufferedLiveRecords(), null);

      // Each poll already emits a CONSUMING event that keeps the SSE stream alive, so the phase
      // only needs to be announced once instead of on every poll.
      sendPhase(sink, "Polling");
      while (!sink.isCancelled()) {
        var polled = poll(sink, consumer);
        send(sink, polled, null);
      }
      sink.complete();
      log.debug("Tailing finished");
    } catch (InterruptException kafkaInterruptException) {
      log.debug("Tailing finished due to thread interruption");
      sink.complete();
    } catch (Exception e) {
      log.error("Error consuming {}", consumerPosition, e);
      sink.error(e);
    }
  }

  private Snapshot loadRecentMessages(
      EnhancedConsumer consumer, FluxSink<TopicMessageEventDTO> sink) {
    var seekOperations = SeekOperations.create(consumer, consumerPosition);
    Map<TopicPartition, Long> checkpointOffsets = new HashMap<>(seekOperations.getEndOffsets());
    Map<TopicPartition, Long> snapshotStartOffsets = snapshotStartOffsets(seekOperations);
    Set<TopicPartition> fullyRead = new HashSet<>();
    Set<TopicPartition> paused = new HashSet<>();
    List<ConsumerRecord<Bytes, Bytes>> historicalRecords = new ArrayList<>();
    List<ConsumerRecord<Bytes, Bytes>> bufferedLiveRecords = new ArrayList<>();

    consumer.assign(checkpointOffsets.keySet());
    snapshotStartOffsets.forEach(consumer::seek);
    snapshotStartOffsets.forEach((partition, startOffset) -> {
      if (startOffset >= checkpointOffsets.get(partition)) {
        // Already at the checkpoint: pause it so live records are not buffered without bound
        // while other partitions are still loading history.
        fullyRead.add(partition);
        paused.add(partition);
      }
    });
    consumer.pause(paused);

    sendPhase(sink, "Loading recent messages");
    while (!sink.isCancelled() && fullyRead.size() < checkpointOffsets.size()) {
      var polled = poll(sink, consumer);
      checkpointOffsets.forEach((partition, checkpointOffset) -> {
        polled.records(partition).forEach(record -> {
          if (record.offset() < checkpointOffset) {
            historicalRecords.add(record);
          } else {
            bufferedLiveRecords.add(record);
          }
        });
        if (!fullyRead.contains(partition) && consumer.position(partition) >= checkpointOffset) {
          fullyRead.add(partition);
          paused.add(partition);
          consumer.pause(List.of(partition));
        }
      });
    }
    consumer.resume(paused);
    return new Snapshot(historicalRecords, bufferedLiveRecords);
  }

  private Map<TopicPartition, Long> snapshotStartOffsets(SeekOperations seekOperations) {
    Map<TopicPartition, Long> checkpointOffsets = seekOperations.getEndOffsets();
    Map<TopicPartition, Long> beginOffsets = seekOperations.getBeginOffsets();
    long nonEmptyPartitions = checkpointOffsets.entrySet().stream()
        .filter(entry -> entry.getValue() > beginOffsets.get(entry.getKey()))
        .count();
    int messagesPerPartition = nonEmptyPartitions == 0
        ? 0
        : Math.max(1, (int) Math.ceil((double) recentMessagesLimit / nonEmptyPartitions));
    Map<TopicPartition, Long> result = new HashMap<>();
    checkpointOffsets.forEach((partition, checkpointOffset) -> result.put(
        partition,
        Math.max(beginOffsets.get(partition), checkpointOffset - messagesPerPartition)));
    return result;
  }

  private record Snapshot(
      List<ConsumerRecord<Bytes, Bytes>> historicalRecords,
      List<ConsumerRecord<Bytes, Bytes>> bufferedLiveRecords) {
  }
}
