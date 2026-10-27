package io.kafbat.ui.emitter;

import io.kafbat.ui.model.ConsumerPosition;
import io.kafbat.ui.model.TopicMessageDTO;
import io.kafbat.ui.model.TopicMessageEventDTO;
import io.kafbat.ui.serdes.ConsumerRecordDeserializer;
import java.time.Duration;
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
public class FullScanEmitter extends AbstractEmitter {

  private static final Duration DEFAULT_NO_PROGRESS_TIMEOUT = Duration.ofMinutes(2);
  static final int EMPTY_POLLS_BEFORE_ADVANCING_COMPACTED_GAP = 10;

  private final Supplier<EnhancedConsumer> consumerSupplier;
  private final ConsumerPosition consumerPosition;
  private final Duration noProgressTimeout;

  public FullScanEmitter(
      Supplier<EnhancedConsumer> consumerSupplier,
      ConsumerPosition consumerPosition,
      ConsumerRecordDeserializer deserializer,
      Predicate<TopicMessageDTO> filter,
      PollingSettings pollingSettings) {
    this(consumerSupplier, consumerPosition, deserializer, filter, pollingSettings,
        DEFAULT_NO_PROGRESS_TIMEOUT);
  }

  FullScanEmitter(
      Supplier<EnhancedConsumer> consumerSupplier,
      ConsumerPosition consumerPosition,
      ConsumerRecordDeserializer deserializer,
      Predicate<TopicMessageDTO> filter,
      PollingSettings pollingSettings,
      Duration noProgressTimeout) {
    super(MessagesProcessing.createUnsorted(deserializer, filter), pollingSettings);
    this.consumerSupplier = consumerSupplier;
    this.consumerPosition = consumerPosition;
    this.noProgressTimeout = noProgressTimeout;
  }

  @Override
  public void accept(FluxSink<TopicMessageEventDTO> sink) {
    log.debug("Starting full-topic scan for {}", consumerPosition);
    try (EnhancedConsumer consumer = consumerSupplier.get()) {
      sendPhase(sink, "Consumer created");
      var seekOperations = SeekOperations.create(consumer, consumerPosition);
      var offsetsForSeek = seekOperations.getOffsetsForSeek();
      var endOffsets = seekOperations.getEndOffsets();
      if (!offsetsForSeek.isEmpty()) {
        consumer.assign(offsetsForSeek.keySet());
        offsetsForSeek.forEach(consumer::seek);
        sendPhase(sink, "Polling all topic partitions");

        long lastProcessedOffset = seekOperations.offsetsProcessedFromSeek();
        long lastProgressAt = System.nanoTime();
        Map<TopicPartition, Long> lastPositions = new HashMap<>(offsetsForSeek);
        Map<TopicPartition, Integer> emptyPolls = new HashMap<>();
        Set<TopicPartition> pausedPartitions = new HashSet<>();
        while (!sink.isCancelled() && !seekOperations.assignedPartitionsFullyPolled()) {
          var polled = poll(sink, consumer);
          var recordsInSnapshot = new ArrayList<ConsumerRecord<Bytes, Bytes>>(polled.count());
          for (var record : polled) {
            var partition = new TopicPartition(record.topic(), record.partition());
            if (record.offset() < endOffsets.get(partition)) {
              recordsInSnapshot.add(record);
            }
          }
          send(sink, recordsInSnapshot, null);

          for (var partition : offsetsForSeek.keySet()) {
            if (pausedPartitions.contains(partition)) {
              continue;
            }
            long position = consumer.position(partition);
            long endOffset = endOffsets.get(partition);
            if (position >= endOffset) {
              emptyPolls.remove(partition);
              if (pausedPartitions.add(partition)) {
                consumer.pause(List.of(partition));
              }
            } else if (polled.count() == 0 && position <= lastPositions.get(partition)) {
              int emptyPollCount = emptyPolls.merge(partition, 1, Integer::sum);
              if (emptyPollCount >= EMPTY_POLLS_BEFORE_ADVANCING_COMPACTED_GAP) {
                log.warn(
                    "No records returned for {} after {} empty polls; advancing to snapshot end offset {}",
                    partition,
                    emptyPollCount,
                    endOffset);
                consumer.seek(partition, endOffset);
                consumer.pause(List.of(partition));
                pausedPartitions.add(partition);
                emptyPolls.remove(partition);
                lastPositions.put(partition, endOffset);
              }
            } else {
              emptyPolls.remove(partition);
              lastPositions.put(partition, position);
            }
          }

          long processedOffset = seekOperations.offsetsProcessedFromSeek();
          if (processedOffset > lastProcessedOffset) {
            lastProcessedOffset = processedOffset;
            lastProgressAt = System.nanoTime();
          } else if (System.nanoTime() - lastProgressAt >= noProgressTimeout.toNanos()) {
            throw new IllegalStateException(
                "Whole-topic scan made no offset progress for " + noProgressTimeout);
          }
        }
      }
      sendFinishStatsAndCompleteSink(sink, null);
      log.debug("Full-topic scan finished for {}", consumerPosition);
    } catch (InterruptException interruptException) {
      log.debug("Full-topic scan stopped due to thread interruption");
      sink.complete();
    } catch (Exception e) {
      log.error("Error occurred while scanning topic {}", consumerPosition.topic(), e);
      sink.error(e);
    }
  }
}
