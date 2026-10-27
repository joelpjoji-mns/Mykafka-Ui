package io.kafbat.ui.service.explorer;

import io.kafbat.ui.emitter.MessageFilters;
import io.kafbat.ui.exception.ValidationException;
import io.kafbat.ui.model.KafkaCluster;
import io.kafbat.ui.model.RecordExplorerRecordDTO;
import io.kafbat.ui.model.RecordExplorerResponseDTO;
import io.kafbat.ui.model.RecordExplorerTopicCoverageDTO;
import io.kafbat.ui.model.TopicMessageDTO;
import io.kafbat.ui.serdes.ConsumerRecordDeserializer;
import io.kafbat.ui.service.DeserializationService;
import io.kafbat.ui.service.sampling.RecentTopicSampler;
import java.util.Comparator;
import java.util.List;
import java.util.function.Predicate;
import javax.annotation.Nullable;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

@Slf4j
@Service
@RequiredArgsConstructor
public class RecordExplorerService {
  private static final int DEFAULT_TOPIC_LIMIT = 8;
  private static final int MAX_TOPIC_LIMIT = 12;
  private static final int DEFAULT_PER_TOPIC_SAMPLE_LIMIT = 25;
  private static final int MAX_PER_TOPIC_SAMPLE_LIMIT = 100;
  private static final int DEFAULT_RESULT_LIMIT = 100;
  private static final int MAX_RESULT_LIMIT = 200;
  private static final int MAX_CONCURRENT_TOPIC_SAMPLES = 3;

  private final RecentTopicSampler recentTopicSampler;
  private final DeserializationService deserializationService;

  public record Limits(int topicLimit, int perTopicSampleLimit, int resultLimit) {
  }

  public Limits resolveLimits(@Nullable Integer requestedTopicLimit,
                              @Nullable Integer requestedPerTopicSampleLimit,
                              @Nullable Integer requestedResultLimit) {
    return new Limits(
        bound(requestedTopicLimit, DEFAULT_TOPIC_LIMIT, MAX_TOPIC_LIMIT),
        bound(requestedPerTopicSampleLimit, DEFAULT_PER_TOPIC_SAMPLE_LIMIT,
            MAX_PER_TOPIC_SAMPLE_LIMIT),
        bound(requestedResultLimit, DEFAULT_RESULT_LIMIT, MAX_RESULT_LIMIT));
  }

  public Mono<RecordExplorerResponseDTO> search(KafkaCluster cluster,
                                                 List<String> visibleTopics,
                                                 String query,
                                                 Limits limits) {
    String normalizedQuery = query == null ? "" : query.trim();
    if (normalizedQuery.isEmpty()) {
      return Mono.error(new ValidationException("A record search query is required"));
    }

    List<String> topics = visibleTopics.stream()
        .sorted()
        .limit(limits.topicLimit())
        .toList();
    Predicate<TopicMessageDTO> filter = MessageFilters.containsStringFilter(normalizedQuery);

    return Flux.fromIterable(topics)
        .flatMapSequential(topic -> sampleTopic(cluster, topic, filter, limits.perTopicSampleLimit()),
            MAX_CONCURRENT_TOPIC_SAMPLES)
        .collectList()
        .map(samples -> response(normalizedQuery, visibleTopics.size(), topics.size(), limits, samples));
  }

  private Mono<TopicSample> sampleTopic(KafkaCluster cluster,
                                        String topic,
                                        Predicate<TopicMessageDTO> filter,
                                        int sampleLimit) {
    return Mono.defer(() -> {
      ConsumerRecordDeserializer deserializer = deserializationService.deserializerFor(
          cluster,
          topic,
          null,
          null);
      return recentTopicSampler.sample(cluster, topic, sampleLimit)
          .map(sample -> new TopicSample(
              topic,
              sample.records().size(),
              sample.records().stream()
                  .map(deserializer::deserialize)
                  .filter(filter)
                  .map(message -> toRecord(topic, message))
                  .toList()));
    }).onErrorResume(e -> {
      // A deleted topic, broken serde or transient broker error must not fail the whole search.
      log.warn("Record explorer could not sample topic {}: {}", topic, e.getMessage());
      return Mono.just(new TopicSample(topic, 0, List.of()));
    });
  }

  private RecordExplorerResponseDTO response(String query,
                                             int visibleTopicCount,
                                             int topicsScanned,
                                             Limits limits,
                                             List<TopicSample> samples) {
    List<RecordExplorerRecordDTO> allMatches = samples.stream()
        .flatMap(sample -> sample.matches().stream())
        .sorted(Comparator
            .comparing(RecordExplorerRecordDTO::getTimestamp,
                Comparator.nullsLast(Comparator.reverseOrder()))
            .thenComparing(RecordExplorerRecordDTO::getTopic)
            .thenComparing(RecordExplorerRecordDTO::getPartition)
            .thenComparing(RecordExplorerRecordDTO::getOffset))
        .toList();
    boolean resultLimitReached = allMatches.size() > limits.resultLimit();
    List<RecordExplorerRecordDTO> records = allMatches.stream().limit(limits.resultLimit()).toList();
    List<RecordExplorerTopicCoverageDTO> coverage = samples.stream()
        .map(sample -> new RecordExplorerTopicCoverageDTO()
            .topic(sample.topic())
            .sampledRecords(sample.sampledRecords())
            .matchedRecords(sample.matches().size()))
        .toList();

    return new RecordExplorerResponseDTO()
        .query(query)
        .collectedAtMs(System.currentTimeMillis())
        .visibleTopicCount(visibleTopicCount)
        .topicLimit(limits.topicLimit())
        .topicLimitReached(visibleTopicCount > topicsScanned)
        .topicsScanned(topicsScanned)
        .perTopicSampleLimit(limits.perTopicSampleLimit())
        .sampledRecords(samples.stream().mapToInt(TopicSample::sampledRecords).sum())
        .resultLimit(limits.resultLimit())
        .resultLimitReached(resultLimitReached)
        .coverage(coverage)
        .records(records);
  }

  private RecordExplorerRecordDTO toRecord(String topic, TopicMessageDTO message) {
    return new RecordExplorerRecordDTO()
        .topic(topic)
        .partition(message.getPartition())
        .offset(message.getOffset())
        .timestamp(message.getTimestamp())
        .key(message.getKey())
        .value(message.getValue())
        .headers(message.getHeaders())
        .keySize(message.getKeySize())
        .valueSize(message.getValueSize())
        .headersSize(message.getHeadersSize());
  }

  private int bound(@Nullable Integer requested, int defaultValue, int maxValue) {
    return Math.max(1, Math.min(requested == null ? defaultValue : requested, maxValue));
  }

  private record TopicSample(String topic,
                             int sampledRecords,
                             List<RecordExplorerRecordDTO> matches) {
  }
}