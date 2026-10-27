package io.kafbat.ui.service.profile;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.kafbat.ui.model.KafkaCluster;
import io.kafbat.ui.model.TopicDataProfileDTO;
import io.kafbat.ui.service.sampling.RecentTopicSampler;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

@Service
@RequiredArgsConstructor
public class TopicDataProfileService {
  private static final int DEFAULT_SAMPLE_LIMIT = 250;
  private static final int MAX_SAMPLE_LIMIT = 1_000;
  private static final int MIN_SAMPLE_LIMIT = 25;

  private final RecentTopicSampler recentTopicSampler;
  private final ObjectMapper objectMapper;

  public Mono<TopicDataProfileDTO> profile(
      KafkaCluster cluster, String topicName, Integer requestedSampleLimit) {
    int sampleLimit = resolveSampleLimit(requestedSampleLimit);
    return recentTopicSampler
        .sample(cluster, topicName, sampleLimit)
        // Parsing up to MAX_SAMPLE_LIMIT JSON payloads is CPU-bound; keep it off I/O threads.
        .publishOn(Schedulers.parallel())
        .map(sample -> profile(sample, sampleLimit));
  }

  private TopicDataProfileDTO profile(RecentTopicSampler.Sample sample, int sampleLimit) {
    TopicDataProfileAccumulator accumulator = new TopicDataProfileAccumulator(objectMapper);
    sample.records().forEach(accumulator::apply);
    return accumulator.toDto(sampleLimit, sample.totalPartitions());
  }

  public int resolveSampleLimit(Integer requestedSampleLimit) {
    if (requestedSampleLimit == null) {
      return DEFAULT_SAMPLE_LIMIT;
    }
    return Math.max(MIN_SAMPLE_LIMIT, Math.min(requestedSampleLimit, MAX_SAMPLE_LIMIT));
  }
}
