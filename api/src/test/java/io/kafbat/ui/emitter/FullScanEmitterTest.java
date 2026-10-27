package io.kafbat.ui.emitter;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.kafbat.ui.model.ConsumerPosition;
import io.kafbat.ui.model.PollingModeDTO;
import io.kafbat.ui.model.TopicMessageEventDTO;
import io.kafbat.ui.serde.api.Serde;
import io.kafbat.ui.serdes.ConsumerRecordDeserializer;
import io.kafbat.ui.serdes.PropertyResolverImpl;
import io.kafbat.ui.serdes.builtin.StringSerde;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.OffsetAndTimestamp;
import org.apache.kafka.common.PartitionInfo;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.header.internals.RecordHeaders;
import org.apache.kafka.common.record.TimestampType;
import org.apache.kafka.common.utils.Bytes;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

class FullScanEmitterTest {

  @Test
  void scansPartitionsOnceAndExcludesRecordsWrittenAfterTheScanStarted() {
    String topic = "whole-topic-scan";
    var partition = new TopicPartition(topic, 0);
    var consumer = mock(EnhancedConsumer.class);
    var currentPosition = new AtomicLong();
    var included = message(topic, 0, "included");
    var producedDuringScan = message(topic, 1, "new-arrival");

    when(consumer.partitionsFor(topic))
        .thenReturn(List.of(new PartitionInfo(topic, 0, null, null, null, null)));
    when(consumer.offsetsForTimes(anyMap()))
        .thenReturn(Map.of(partition, new OffsetAndTimestamp(0, 0L)));
    when(consumer.beginningOffsets(anyCollection())).thenReturn(Map.of(partition, 0L));
    when(consumer.endOffsets(anyCollection())).thenReturn(Map.of(partition, 1L));
    when(consumer.assignment()).thenReturn(Set.of(partition));
    when(consumer.position(partition)).thenAnswer(_ -> currentPosition.get());
    doAnswer(invocation -> {
      currentPosition.set(invocation.getArgument(1));
      return null;
    }).when(consumer).seek(eq(partition), any(Long.class));
    when(consumer.pollEnhanced(any(Duration.class))).thenAnswer(_ -> {
      currentPosition.set(2L);
      return new PolledRecords(
          2,
          10,
          Duration.ZERO,
          new org.apache.kafka.clients.consumer.ConsumerRecords<>(
              Map.of(partition, List.of(included, producedDuringScan))));
    });

    var emitter = new FullScanEmitter(
        () -> consumer,
        new ConsumerPosition(PollingModeDTO.EARLIEST, topic, List.of(), null, null),
        deserializer(),
        _ -> true,
        PollingSettings.createDefault());

    var events = Flux.<TopicMessageEventDTO>create(emitter).collectList().block();

    assertThat(events)
        .filteredOn(event -> event.getType() == TopicMessageEventDTO.TypeEnum.MESSAGE)
        .extracting(event -> event.getMessage().getValue())
        .containsExactly("included");
    assertThat(events).anyMatch(event -> event.getType() == TopicMessageEventDTO.TypeEnum.DONE);
    verify(consumer, times(1)).assign(Set.of(partition));
    verify(consumer, times(1)).pollEnhanced(any(Duration.class));
  }

  @Test
  void completesAfterACompactedTailStopsReturningRecords() {
    String topic = "compacted-whole-topic-scan";
    var partition = new TopicPartition(topic, 0);
    var consumer = mock(EnhancedConsumer.class);
    var currentPosition = new AtomicLong();
    var pollCount = new AtomicInteger();
    var availableMessage = message(topic, 0, "available");

    when(consumer.partitionsFor(topic))
        .thenReturn(List.of(new PartitionInfo(topic, 0, null, null, null, null)));
    when(consumer.offsetsForTimes(anyMap()))
        .thenReturn(Map.of(partition, new OffsetAndTimestamp(0, 0L)));
    when(consumer.beginningOffsets(anyCollection())).thenReturn(Map.of(partition, 0L));
    when(consumer.endOffsets(anyCollection())).thenReturn(Map.of(partition, 2L));
    when(consumer.assignment()).thenReturn(Set.of(partition));
    when(consumer.position(partition)).thenAnswer(_ -> currentPosition.get());
    doAnswer(invocation -> {
      currentPosition.set(invocation.getArgument(1));
      return null;
    }).when(consumer).seek(eq(partition), any(Long.class));
    when(consumer.pollEnhanced(any(Duration.class))).thenAnswer(_ -> {
      if (pollCount.getAndIncrement() == 0) {
        currentPosition.set(1L);
        return new PolledRecords(
            1,
            10,
            Duration.ZERO,
            new org.apache.kafka.clients.consumer.ConsumerRecords<>(
                Map.of(partition, List.of(availableMessage))));
      }
      return new PolledRecords(
          0,
          0,
          Duration.ZERO,
          new org.apache.kafka.clients.consumer.ConsumerRecords<>(Map.of()));
    });

    var emitter = new FullScanEmitter(
        () -> consumer,
        new ConsumerPosition(PollingModeDTO.EARLIEST, topic, List.of(), null, null),
        deserializer(),
        _ -> true,
        PollingSettings.createDefault());

    var events = Flux.<TopicMessageEventDTO>create(emitter).collectList().block();

    assertThat(events)
        .filteredOn(event -> event.getType() == TopicMessageEventDTO.TypeEnum.MESSAGE)
        .extracting(event -> event.getMessage().getValue())
        .containsExactly("available");
    assertThat(events).anyMatch(event -> event.getType() == TopicMessageEventDTO.TypeEnum.DONE);
    verify(consumer, times(FullScanEmitter.EMPTY_POLLS_BEFORE_ADVANCING_COMPACTED_GAP + 1))
        .pollEnhanced(any(Duration.class));
  }

  @Test
  void failsInsteadOfHangingWhenOffsetsStopAdvancing() {
    String topic = "stalled-whole-topic-scan";
    var partition = new TopicPartition(topic, 0);
    var consumer = mock(EnhancedConsumer.class);

    when(consumer.partitionsFor(topic))
        .thenReturn(List.of(new PartitionInfo(topic, 0, null, null, null, null)));
    when(consumer.offsetsForTimes(anyMap()))
        .thenReturn(Map.of(partition, new OffsetAndTimestamp(0, 0L)));
    when(consumer.beginningOffsets(anyCollection())).thenReturn(Map.of(partition, 0L));
    when(consumer.endOffsets(anyCollection())).thenReturn(Map.of(partition, 1L));
    when(consumer.assignment()).thenReturn(Set.of(partition));
    when(consumer.position(partition)).thenReturn(0L);
    when(consumer.pollEnhanced(any(Duration.class))).thenReturn(
        new PolledRecords(
            0,
            0,
            Duration.ZERO,
            new org.apache.kafka.clients.consumer.ConsumerRecords<>(Map.of())));

    var emitter = new FullScanEmitter(
        () -> consumer,
        new ConsumerPosition(PollingModeDTO.EARLIEST, topic, List.of(), null, null),
        deserializer(),
        _ -> true,
        PollingSettings.createDefault(),
        Duration.ZERO);

    StepVerifier.create(Flux.<TopicMessageEventDTO>create(emitter))
        .thenConsumeWhile(event ->
            event.getType() == TopicMessageEventDTO.TypeEnum.PHASE
                || event.getType() == TopicMessageEventDTO.TypeEnum.CONSUMING)
        .expectErrorMatches(error -> error instanceof IllegalStateException
            && error.getMessage().startsWith("Whole-topic scan made no offset progress"))
        .verify();
    verify(consumer, times(1)).pollEnhanced(any(Duration.class));
  }

  @Test
  void completesWhenCompactionLeavesNoReadableRecordsBeforeTheEndOffset() {
    String topic = "compacted-whole-topic-scan";
    var partition = new TopicPartition(topic, 0);
    var consumer = mock(EnhancedConsumer.class);
    var currentPosition = new AtomicLong();
    var polls = new AtomicInteger();
    var availableMessage = message(topic, 0, "available");

    when(consumer.partitionsFor(topic))
        .thenReturn(List.of(new PartitionInfo(topic, 0, null, null, null, null)));
    when(consumer.offsetsForTimes(anyMap()))
        .thenReturn(Map.of(partition, new OffsetAndTimestamp(0, 0L)));
    when(consumer.beginningOffsets(anyCollection())).thenReturn(Map.of(partition, 0L));
    when(consumer.endOffsets(anyCollection())).thenReturn(Map.of(partition, 2L));
    when(consumer.assignment()).thenReturn(Set.of(partition));
    when(consumer.position(partition)).thenAnswer(_ -> currentPosition.get());
    doAnswer(invocation -> {
      currentPosition.set(invocation.getArgument(1));
      return null;
    }).when(consumer).seek(eq(partition), any(Long.class));
    when(consumer.pollEnhanced(any(Duration.class))).thenAnswer(_ -> {
      if (polls.getAndIncrement() == 0) {
        currentPosition.set(1L);
        return new PolledRecords(
            1,
            10,
            Duration.ZERO,
            new org.apache.kafka.clients.consumer.ConsumerRecords<>(
                Map.of(partition, List.of(availableMessage))));
      }
      return new PolledRecords(
          0,
          0,
          Duration.ZERO,
          new org.apache.kafka.clients.consumer.ConsumerRecords<>(Map.of()));
    });

    var emitter = new FullScanEmitter(
        () -> consumer,
        new ConsumerPosition(PollingModeDTO.EARLIEST, topic, List.of(), null, null),
        deserializer(),
        _ -> true,
        PollingSettings.createDefault());
    var events = Flux.<TopicMessageEventDTO>create(emitter).collectList().block();

    assertThat(events)
        .filteredOn(event -> event.getType() == TopicMessageEventDTO.TypeEnum.MESSAGE)
        .extracting(event -> event.getMessage().getValue())
        .containsExactly("available");
    assertThat(events).anyMatch(event -> event.getType() == TopicMessageEventDTO.TypeEnum.DONE);
    verify(consumer, times(FullScanEmitter.EMPTY_POLLS_BEFORE_ADVANCING_COMPACTED_GAP + 1))
        .pollEnhanced(any(Duration.class));
  }

  private static ConsumerRecord<Bytes, Bytes> message(String topic, long offset, String value) {
    byte[] bytes = value.getBytes();
    return new ConsumerRecord<>(
        topic,
        0,
        offset,
        0L,
        TimestampType.CREATE_TIME,
        0,
        bytes.length,
        null,
        Bytes.wrap(bytes),
        new RecordHeaders(),
        Optional.empty());
  }

  private static ConsumerRecordDeserializer deserializer() {
    Serde serde = new StringSerde();
    serde.configure(PropertyResolverImpl.empty(), PropertyResolverImpl.empty(), PropertyResolverImpl.empty());
    return new ConsumerRecordDeserializer(
        StringSerde.NAME,
        serde.deserializer(null, Serde.Target.KEY),
        StringSerde.NAME,
        serde.deserializer(null, Serde.Target.VALUE),
        StringSerde.NAME,
        serde.deserializer(null, Serde.Target.KEY),
        serde.deserializer(null, Serde.Target.VALUE),
        message -> message);
  }
}
