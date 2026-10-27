package io.kafbat.ui.service.sampling;

import com.github.benmanes.caffeine.cache.AsyncCache;
import com.github.benmanes.caffeine.cache.Caffeine;
import io.kafbat.ui.emitter.EnhancedConsumer;
import io.kafbat.ui.model.KafkaCluster;
import io.kafbat.ui.service.ConsumerGroupService;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.utils.Bytes;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

@Service
@RequiredArgsConstructor
public class RecentTopicSampler {
  private static final int MAX_EMPTY_POLLS = 3;
  private static final Duration POLL_TIMEOUT = Duration.ofMillis(500);
  private static final Duration SAMPLE_CACHE_TTL = Duration.ofSeconds(15);
  private static final long SAMPLE_CACHE_MAX_BYTES = 64L * 1024 * 1024;
  private static final int RECORD_OVERHEAD_BYTES = 128;

  private final ConsumerGroupService consumerGroupService;

  // Record Explorer, Data Profile and repeated refreshes sample the same recent records; sharing
  // them briefly avoids opening a new Kafka consumer and re-polling for every request.
  private final AsyncCache<SampleKey, Sample> samples = Caffeine.newBuilder()
      .expireAfterWrite(SAMPLE_CACHE_TTL)
      .maximumWeight(SAMPLE_CACHE_MAX_BYTES)
      .weigher((SampleKey key, Sample sample) -> sample.weight())
      .buildAsync();

  public record Sample(List<ConsumerRecord<Bytes, Bytes>> records, int totalPartitions) {

    int weight() {
      long bytes = 0;
      for (ConsumerRecord<Bytes, Bytes> record : records) {
        bytes += Math.max(0, record.serializedKeySize())
            + Math.max(0, record.serializedValueSize())
            + RECORD_OVERHEAD_BYTES;
      }
      return (int) Math.min(Integer.MAX_VALUE, bytes);
    }
  }

  private record SampleKey(String clusterName, String topicName, int sampleLimit) {
  }

  public Mono<Sample> sample(KafkaCluster cluster, String topicName, int sampleLimit) {
    SampleKey key = new SampleKey(cluster.getName(), topicName, sampleLimit);
    // suppressCancel: one cancelled subscriber must not cancel the shared, cached sampling future.
    return Mono.fromFuture(
        () -> samples.get(key, (ignored, executor) ->
            Mono.fromCallable(() -> sampleBlocking(cluster, topicName, sampleLimit))
                .subscribeOn(Schedulers.boundedElastic())
                .toFuture()),
        true);
  }

  private Sample sampleBlocking(KafkaCluster cluster, String topicName, int sampleLimit) {
    try (EnhancedConsumer consumer = consumerGroupService.createConsumer(cluster, Map.of(
        ConsumerConfig.MAX_POLL_RECORDS_CONFIG, sampleLimit))) {
      List<TopicPartition> partitions = Optional.ofNullable(consumer.partitionsFor(topicName))
          .orElse(List.of())
          .stream()
          .map(info -> new TopicPartition(topicName, info.partition()))
          .toList();
      if (partitions.isEmpty()) {
        return new Sample(List.of(), 0);
      }

      Map<TopicPartition, Long> beginOffsets = consumer.beginningOffsets(partitions);
      Map<TopicPartition, Long> endOffsets = consumer.endOffsets(partitions);
      Map<TopicPartition, Integer> remainingByPartition = recentSampleQuotas(
          beginOffsets,
          endOffsets,
          sampleLimit);
      if (remainingByPartition.isEmpty()) {
        return new Sample(List.of(), partitions.size());
      }

      consumer.assign(remainingByPartition.keySet());
      seekRecentSamples(consumer, beginOffsets, endOffsets, remainingByPartition);
      return new Sample(
          pollSamples(consumer, remainingByPartition, endOffsets, sampleLimit),
          partitions.size());
    }
  }

  static Map<TopicPartition, Integer> recentSampleQuotas(
      Map<TopicPartition, Long> beginOffsets,
      Map<TopicPartition, Long> endOffsets,
      int sampleLimit) {
    if (sampleLimit < 1 || endOffsets.isEmpty()) {
      return Map.of();
    }
    int perPartitionLimit = Math.max(1, (int) Math.ceil((double) sampleLimit / endOffsets.size()));
    Map<TopicPartition, Integer> remainingByPartition = new HashMap<>();
    for (Map.Entry<TopicPartition, Long> entry : endOffsets.entrySet()) {
      long beginning = beginOffsets.getOrDefault(entry.getKey(), entry.getValue());
      long available = Math.max(0, entry.getValue() - beginning);
      if (available > 0) {
        remainingByPartition.put(entry.getKey(), (int) Math.min(perPartitionLimit, available));
      }
    }
    return remainingByPartition;
  }

  private void seekRecentSamples(EnhancedConsumer consumer,
                                 Map<TopicPartition, Long> beginOffsets,
                                 Map<TopicPartition, Long> endOffsets,
                                 Map<TopicPartition, Integer> remainingByPartition) {
    remainingByPartition.forEach((partition, quota) -> {
      long beginning = beginOffsets.getOrDefault(partition, endOffsets.get(partition));
      long offset = Math.max(beginning, endOffsets.get(partition) - quota);
      consumer.seek(partition, offset);
    });
  }

  private List<ConsumerRecord<Bytes, Bytes>> pollSamples(
      EnhancedConsumer consumer,
      Map<TopicPartition, Integer> remainingByPartition,
      Map<TopicPartition, Long> endOffsets,
      int sampleLimit) {
    List<ConsumerRecord<Bytes, Bytes>> records = new ArrayList<>();
    int emptyPolls = 0;
    while (!remainingByPartition.isEmpty()
        && records.size() < sampleLimit
        && emptyPolls < MAX_EMPTY_POLLS) {
      boolean acceptedRecord = false;
      for (ConsumerRecord<Bytes, Bytes> record : consumer.pollEnhanced(POLL_TIMEOUT)) {
        TopicPartition partition = new TopicPartition(record.topic(), record.partition());
        Integer remaining = remainingByPartition.get(partition);
        if (remaining == null || remaining == 0) {
          continue;
        }
        records.add(record);
        acceptedRecord = true;
        if (remaining == 1) {
          remainingByPartition.remove(partition);
        } else {
          remainingByPartition.put(partition, remaining - 1);
        }
        if (records.size() == sampleLimit) {
          return List.copyOf(records);
        }
      }
      // Compacted topics and transaction markers leave fewer records than the offset range
      // suggests; stop waiting on partitions that already reached their end offset.
      remainingByPartition.keySet()
          .removeIf(partition -> consumer.position(partition) >= endOffsets.get(partition));
      emptyPolls = acceptedRecord ? 0 : emptyPolls + 1;
    }
    return List.copyOf(records);
  }
}