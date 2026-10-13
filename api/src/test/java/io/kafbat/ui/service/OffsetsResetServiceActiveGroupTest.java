package io.kafbat.ui.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.google.common.collect.ImmutableTable;
import io.kafbat.ui.model.KafkaCluster;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.apache.kafka.clients.admin.ConsumerGroupDescription;
import org.apache.kafka.clients.admin.OffsetSpec;
import org.apache.kafka.common.ConsumerGroupState;
import org.apache.kafka.common.TopicPartition;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

class OffsetsResetServiceActiveGroupTest {

  @Test
  void previewsOffsetsForAnActiveGroupWithoutChangingThem() {
    String groupId = "orders-consumer";
    TopicPartition partition = new TopicPartition("orders", 0);
    KafkaCluster cluster = KafkaCluster.builder().name("test").build();
    AdminClientService adminClientService = Mockito.mock(AdminClientService.class);
    ReactiveAdminClient adminClient = Mockito.mock(ReactiveAdminClient.class);
    OffsetsResetService service = new OffsetsResetService(adminClientService);

    when(adminClientService.get(cluster)).thenReturn(Mono.just(adminClient));
    when(adminClient.listConsumerGroupNames()).thenReturn(Mono.just(List.of(groupId)));
    when(adminClient.describeConsumerGroups(List.of(groupId))).thenReturn(
        Mono.just(Map.of(groupId, consumerGroup(groupId, ConsumerGroupState.STABLE))));
    when(adminClient.listOffsets(
        Mockito.anyCollection(), Mockito.any(OffsetSpec.class), Mockito.eq(true)))
        .thenReturn(Mono.just(Map.of(partition, 0L)), Mono.just(Map.of(partition, 10L)));
    when(adminClient.listConsumerGroupOffsets(Mockito.eq(List.of(groupId)), Mockito.anyList()))
        .thenReturn(Mono.just(ImmutableTable.of(groupId, partition, 8L)));

    StepVerifier.create(service.previewToOffsets(cluster, groupId, partition.topic(), Map.of(0, 5L)))
        .assertNext(preview -> {
          assertThat(preview.partitions()).singleElement().satisfies(partitionPreview -> {
            assertThat(partitionPreview.currentCommittedOffset()).isEqualTo(8L);
            assertThat(partitionPreview.targetOffset()).isEqualTo(5L);
            assertThat(partitionPreview.affectedMessages()).isEqualTo(3L);
          });
        })
        .verifyComplete();

    Mockito.verify(adminClient, Mockito.never())
        .alterConsumerGroupOffsets(Mockito.anyString(), Mockito.anyMap());
  }

  @Test
  void waitsForAnActiveGroupToBecomeInactiveBeforeResettingOffsets() {
    ActiveWaitFixture fixture = activeWaitFixture();
    when(fixture.adminClient().listOffsets(
      Mockito.anyCollection(), Mockito.any(OffsetSpec.class), Mockito.eq(true)))
      .thenReturn(Mono.just(Map.of(fixture.partition(), 0L)), Mono.just(Map.of(fixture.partition(), 10L)));
    when(fixture.adminClient().alterConsumerGroupOffsets(fixture.groupId(), Map.of(fixture.partition(), 5L)))
        .thenReturn(Mono.empty());

    StepVerifier.withVirtualTime(() ->
        fixture.service().resetToOffsets(
          fixture.cluster(), fixture.groupId(), fixture.partition().topic(), Map.of(0, 5L), true))
        .thenAwait(Duration.ofMillis(500))
        .verifyComplete();

    verify(fixture.adminClient()).alterConsumerGroupOffsets(
      fixture.groupId(), Map.of(fixture.partition(), 5L));
    }

    @Test
    void waitsForAnActiveGroupBeforeResettingToEarliest() {
    ActiveWaitFixture fixture = activeWaitFixture();
    when(fixture.adminClient().listOffsets(
      Mockito.anyCollection(), Mockito.any(OffsetSpec.class), Mockito.eq(true)))
      .thenReturn(Mono.just(Map.of(fixture.partition(), 0L)));
    when(fixture.adminClient().alterConsumerGroupOffsets(fixture.groupId(), Map.of(fixture.partition(), 0L)))
      .thenReturn(Mono.empty());

    verifyWaitsAndResets(
      fixture,
      fixture.service().resetToEarliest(
        fixture.cluster(), fixture.groupId(), fixture.partition().topic(), List.of(0), true),
      0L);
    }

    @Test
    void waitsForAnActiveGroupBeforeResettingToLatest() {
    ActiveWaitFixture fixture = activeWaitFixture();
    when(fixture.adminClient().listOffsets(
      Mockito.anyCollection(), Mockito.any(OffsetSpec.class), Mockito.eq(true)))
      .thenReturn(Mono.just(Map.of(fixture.partition(), 10L)));
    when(fixture.adminClient().alterConsumerGroupOffsets(fixture.groupId(), Map.of(fixture.partition(), 10L)))
      .thenReturn(Mono.empty());

    verifyWaitsAndResets(
      fixture,
      fixture.service().resetToLatest(
        fixture.cluster(), fixture.groupId(), fixture.partition().topic(), List.of(0), true),
      10L);
    }

    @Test
    void waitsForAnActiveGroupBeforeResettingToTimestamp() {
    ActiveWaitFixture fixture = activeWaitFixture();
    when(fixture.adminClient().listOffsets(
      Mockito.anyCollection(), Mockito.any(OffsetSpec.class), Mockito.eq(true)))
      .thenReturn(Mono.just(Map.of(fixture.partition(), 4L)), Mono.just(Map.of(fixture.partition(), 10L)));
    when(fixture.adminClient().alterConsumerGroupOffsets(fixture.groupId(), Map.of(fixture.partition(), 4L)))
      .thenReturn(Mono.empty());

    verifyWaitsAndResets(
      fixture,
      fixture.service().resetToTimestamp(
        fixture.cluster(), fixture.groupId(), fixture.partition().topic(), List.of(0), 1_000L, true),
      4L);
  }

  @Test
  void waitsBeyondTheOldTimeoutAndCancelsWithoutChangingOffsets() {
    String groupId = "orders-consumer";
    TopicPartition partition = new TopicPartition("orders", 0);
    KafkaCluster cluster = KafkaCluster.builder().name("test").build();
    AdminClientService adminClientService = Mockito.mock(AdminClientService.class);
    ReactiveAdminClient adminClient = Mockito.mock(ReactiveAdminClient.class);
    OffsetsResetService service = new OffsetsResetService(adminClientService);

    when(adminClientService.get(cluster)).thenReturn(Mono.just(adminClient));
    when(adminClient.listConsumerGroupNames()).thenReturn(Mono.just(List.of(groupId)));
    when(adminClient.describeConsumerGroups(List.of(groupId))).thenReturn(
        Mono.just(Map.of(groupId, consumerGroup(groupId, ConsumerGroupState.STABLE))));

    StepVerifier.withVirtualTime(() ->
            service.resetToOffsets(cluster, groupId, partition.topic(), Map.of(0, 5L), true))
        .thenAwait(Duration.ofHours(2))
        .thenCancel()
        .verify();

    Mockito.verify(adminClient, Mockito.never())
        .alterConsumerGroupOffsets(Mockito.anyString(), Mockito.anyMap());
  }

  private void verifyWaitsAndResets(ActiveWaitFixture fixture, Mono<Void> reset, long expectedOffset) {
    StepVerifier.withVirtualTime(() -> reset)
        .thenAwait(Duration.ofMillis(500))
        .verifyComplete();

    verify(fixture.adminClient()).alterConsumerGroupOffsets(
        fixture.groupId(), Map.of(fixture.partition(), expectedOffset));
  }

  private ActiveWaitFixture activeWaitFixture() {
    String groupId = "orders-consumer";
    TopicPartition partition = new TopicPartition("orders", 0);
    KafkaCluster cluster = KafkaCluster.builder().name("test").build();
    AdminClientService adminClientService = Mockito.mock(AdminClientService.class);
    ReactiveAdminClient adminClient = Mockito.mock(ReactiveAdminClient.class);
    OffsetsResetService service = new OffsetsResetService(adminClientService);

    when(adminClientService.get(cluster)).thenReturn(Mono.just(adminClient));
    when(adminClient.listConsumerGroupNames()).thenReturn(Mono.just(List.of(groupId)));
    when(adminClient.describeConsumerGroups(List.of(groupId))).thenReturn(
        Mono.just(Map.of(groupId, consumerGroup(groupId, ConsumerGroupState.STABLE))),
        Mono.just(Map.of(groupId, consumerGroup(groupId, ConsumerGroupState.EMPTY))),
        Mono.just(Map.of(groupId, consumerGroup(groupId, ConsumerGroupState.EMPTY))));

    return new ActiveWaitFixture(cluster, groupId, partition, service, adminClient);
  }

  private ConsumerGroupDescription consumerGroup(String groupId, ConsumerGroupState state) {
    return new ConsumerGroupDescription(groupId, false, List.of(), "", state, null);
  }

  private record ActiveWaitFixture(
      KafkaCluster cluster,
      String groupId,
      TopicPartition partition,
      OffsetsResetService service,
      ReactiveAdminClient adminClient) {}
}