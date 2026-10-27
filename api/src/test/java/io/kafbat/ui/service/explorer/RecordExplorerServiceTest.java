package io.kafbat.ui.service.explorer;

import static org.assertj.core.api.Assertions.assertThat;

import io.kafbat.ui.model.KafkaCluster;
import io.kafbat.ui.model.TopicMessageDTO;
import io.kafbat.ui.serdes.ConsumerRecordDeserializer;
import io.kafbat.ui.service.DeserializationService;
import io.kafbat.ui.service.sampling.RecentTopicSampler;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.common.utils.Bytes;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import reactor.core.publisher.Mono;

class RecordExplorerServiceTest {

  @Test
  void searchesOnlyTheBoundedSamplesAndReturnsCoverage() {
    RecentTopicSampler sampler = Mockito.mock(RecentTopicSampler.class);
    DeserializationService deserializationService = Mockito.mock(DeserializationService.class);
    ConsumerRecordDeserializer ordersDeserializer = Mockito.mock(ConsumerRecordDeserializer.class);
    ConsumerRecordDeserializer paymentsDeserializer =
        Mockito.mock(ConsumerRecordDeserializer.class);
    KafkaCluster cluster = KafkaCluster.builder().name("local").build();
    ConsumerRecord<Bytes, Bytes> orderRecord = record("orders", 0, 4L);
    ConsumerRecord<Bytes, Bytes> paymentRecord = record("payments", 1, 8L);

    Mockito.when(sampler.sample(cluster, "orders", 25))
        .thenReturn(Mono.just(new RecentTopicSampler.Sample(List.of(orderRecord), 2)));
    Mockito.when(sampler.sample(cluster, "payments", 25))
        .thenReturn(Mono.just(new RecentTopicSampler.Sample(List.of(paymentRecord), 1)));
    Mockito.when(deserializationService.deserializerFor(cluster, "orders", null, null))
        .thenReturn(ordersDeserializer);
    Mockito.when(deserializationService.deserializerFor(cluster, "payments", null, null))
        .thenReturn(paymentsDeserializer);
    Mockito.when(ordersDeserializer.deserialize(orderRecord))
        .thenReturn(
            message(
                0,
                4L,
                "order-4",
                "customer-42",
                OffsetDateTime.of(2026, 8, 15, 10, 0, 0, 0, ZoneOffset.UTC)));
    Mockito.when(paymentsDeserializer.deserialize(paymentRecord))
        .thenReturn(
            message(
                1,
                8L,
                "payment-8",
                "customer-17",
                OffsetDateTime.of(2026, 8, 15, 11, 0, 0, 0, ZoneOffset.UTC)));

    RecordExplorerService service = new RecordExplorerService(sampler, deserializationService);
    var response =
        service
            .search(
                cluster,
                List.of("payments", "orders"),
                "customer",
                new RecordExplorerService.Limits(8, 25, 100))
            .block();

    assertThat(response.getTopicsScanned()).isEqualTo(2);
    assertThat(response.getSampledRecords()).isEqualTo(2);
    assertThat(response.getCoverage())
        .extracting(coverage -> coverage.getTopic() + ":" + coverage.getMatchedRecords())
        .containsExactly("orders:1", "payments:1");
    assertThat(response.getRecords())
        .extracting(record -> record.getTopic() + ":" + record.getOffset())
        .containsExactly("payments:8", "orders:4");
  }

  @Test
  void topicThatCannotBeSampledDoesNotFailTheWholeSearch() {
    RecentTopicSampler sampler = Mockito.mock(RecentTopicSampler.class);
    DeserializationService deserializationService = Mockito.mock(DeserializationService.class);
    ConsumerRecordDeserializer ordersDeserializer = Mockito.mock(ConsumerRecordDeserializer.class);
    KafkaCluster cluster = KafkaCluster.builder().name("local").build();
    ConsumerRecord<Bytes, Bytes> orderRecord = record("orders", 0, 4L);

    Mockito.when(sampler.sample(cluster, "orders", 25))
        .thenReturn(Mono.just(new RecentTopicSampler.Sample(List.of(orderRecord), 1)));
    Mockito.when(sampler.sample(cluster, "deleted", 25))
        .thenReturn(Mono.error(new IllegalStateException("topic deleted")));
    Mockito.when(deserializationService.deserializerFor(cluster, "orders", null, null))
        .thenReturn(ordersDeserializer);
    Mockito.when(deserializationService.deserializerFor(cluster, "deleted", null, null))
        .thenReturn(Mockito.mock(ConsumerRecordDeserializer.class));
    Mockito.when(ordersDeserializer.deserialize(orderRecord))
        .thenReturn(
            message(
                0,
                4L,
                "order-4",
                "customer-42",
                OffsetDateTime.of(2026, 8, 15, 10, 0, 0, 0, ZoneOffset.UTC)));

    var response = new RecordExplorerService(sampler, deserializationService)
        .search(cluster, List.of("orders", "deleted"), "customer",
            new RecordExplorerService.Limits(8, 25, 100))
        .block();

    assertThat(response.getRecords())
        .extracting(record -> record.getTopic() + ":" + record.getOffset())
        .containsExactly("orders:4");
    assertThat(response.getCoverage())
        .extracting(coverage -> coverage.getTopic() + ":" + coverage.getSampledRecords())
        .containsExactly("deleted:0", "orders:1");
  }

  @Test
  void boundsExplorerLimits() {
    RecordExplorerService service =
        new RecordExplorerService(
            Mockito.mock(RecentTopicSampler.class), Mockito.mock(DeserializationService.class));

    assertThat(service.resolveLimits(null, null, null))
        .isEqualTo(new RecordExplorerService.Limits(8, 25, 100));
    assertThat(service.resolveLimits(99, 500, 500))
        .isEqualTo(new RecordExplorerService.Limits(12, 100, 200));
  }

  private ConsumerRecord<Bytes, Bytes> record(String topic, int partition, long offset) {
    return new ConsumerRecord<>(
        topic, partition, offset, Bytes.wrap(new byte[] {1}), Bytes.wrap(new byte[] {2}));
  }

  private TopicMessageDTO message(
      int partition, long offset, String key, String value, OffsetDateTime timestamp) {
    return new TopicMessageDTO()
        .partition(partition)
        .offset(offset)
        .timestamp(timestamp)
        .key(key)
        .value(value)
        .headers(Map.of("source", "test"))
        .keySize(5L)
        .valueSize(11L)
        .headersSize(10L);
  }
}
