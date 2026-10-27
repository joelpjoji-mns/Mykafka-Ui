package io.kafbat.ui.service;

import com.github.benmanes.caffeine.cache.AsyncCache;
import com.github.benmanes.caffeine.cache.Caffeine;
import io.kafbat.ui.model.InternalPartition;
import io.kafbat.ui.model.InternalTopic;
import io.kafbat.ui.model.InternalTopicConfig;
import io.kafbat.ui.model.InternalTopicConsumerGroup;
import io.kafbat.ui.model.KafkaCluster;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Collectors;
import javax.annotation.Nullable;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

@Service
@RequiredArgsConstructor
public class TopicDeveloperInsightsService {

  private static final long LAG_WARNING_THRESHOLD = 10_000L;
  private static final long LAG_CRITICAL_THRESHOLD = 1_000_000L;

  private static final Duration INSIGHTS_CACHE_TTL = Duration.ofSeconds(15);

  private final TopicsService topicsService;
  private final ConsumerGroupService consumerGroupService;
  private final KafkaConnectService kafkaConnectService;

  // Insights fan out to topic, consumer group, producer and Kafka Connect APIs; tab switches and
  // concurrent viewers of the same topic share one recent result instead of repeating them.
  private final AsyncCache<InsightsKey, Insights> insightsCache = Caffeine.newBuilder()
      .expireAfterWrite(INSIGHTS_CACHE_TTL)
      .maximumSize(500)
      .buildAsync();

  private record InsightsKey(String clusterName, String topicName) {
  }

  public Mono<Insights> getInsights(KafkaCluster cluster, String topicName) {
    InsightsKey key = new InsightsKey(cluster.getName(), topicName);
    return Mono.fromFuture(
        () -> insightsCache.get(key, (ignored, executor) -> loadInsights(cluster, topicName).toFuture()),
        true);
  }

  private Mono<Insights> loadInsights(KafkaCluster cluster, String topicName) {
    Mono<InternalTopic> topic = topicsService.getTopicDetails(cluster, topicName);
    Mono<List<InternalTopicConsumerGroup>> consumers =
        consumerGroupService.getConsumerGroupsForTopic(cluster, topicName).onErrorReturn(List.of());
    Mono<Integer> activeProducers =
        topicsService
            .getActiveProducersState(cluster, topicName)
            .map(states -> states.values().stream().mapToInt(List::size).sum())
            .onErrorReturn(0);
    Mono<Long> connectors =
        kafkaConnectService.getTopicConnectors(cluster, topicName).count().onErrorReturn(0L);

    return Mono.zip(topic, consumers, activeProducers, connectors)
        .map(
            values ->
                createInsights(
                    values.getT1(),
                    values.getT2(),
                    values.getT3(),
                    Math.toIntExact(values.getT4())));
  }

  static Insights createInsights(
      InternalTopic topic,
      List<InternalTopicConsumerGroup> consumers,
      int activeProducers,
      int connectorCount) {
    Map<String, String> configs =
        topic.getTopicConfigs().stream()
            .filter(config -> config.getName() != null && config.getValue() != null)
            .collect(
                Collectors.toMap(
                    InternalTopicConfig::getName,
                    InternalTopicConfig::getValue,
                    (left, ignored) -> left));
    List<InternalPartition> partitions =
        topic.getPartitions() == null ? List.of() : new ArrayList<>(topic.getPartitions().values());
    int leaderlessPartitions =
        (int) partitions.stream().filter(partition -> partition.getLeader() == null).count();
    long partitionOffsetSpread = partitionOffsetSpread(partitions);
    long totalLag =
        consumers.stream()
            .map(InternalTopicConsumerGroup::getConsumerLag)
            .filter(Objects::nonNull)
            .mapToLong(Long::longValue)
            .sum();
    long maxLag =
        consumers.stream()
            .map(InternalTopicConsumerGroup::getConsumerLag)
            .filter(Objects::nonNull)
            .mapToLong(Long::longValue)
            .max()
            .orElse(0L);
    int activeConsumers = consumers.stream().mapToInt(InternalTopicConsumerGroup::getMembers).sum();
    int laggingGroups =
        (int)
            consumers.stream()
                .map(InternalTopicConsumerGroup::getConsumerLag)
                .filter(Objects::nonNull)
                .filter(lag -> lag > 0)
                .count();
    int explicitConfigCount =
        (int)
            topic.getTopicConfigs().stream()
                .filter(config -> config.getDefaultValue() != null)
                .filter(config -> !Objects.equals(config.getValue(), config.getDefaultValue()))
                .count();
    int replicationFactor = topic.getReplicationFactor();
    int minInSyncReplicas = parseInt(configs.get("min.insync.replicas"), 0);
    boolean uncleanLeaderElection =
        Boolean.parseBoolean(configs.getOrDefault("unclean.leader.election.enable", "false"));
    List<Recommendation> recommendations =
        recommendations(
            topic,
            leaderlessPartitions,
            minInSyncReplicas,
            uncleanLeaderElection,
            maxLag,
            consumers);
    int healthScore =
        healthScore(topic, leaderlessPartitions, minInSyncReplicas, uncleanLeaderElection, maxLag);
    Health health = health(topic, leaderlessPartitions, healthScore);

    List<Metric> metrics =
        List.of(
            metric(
                "health-score",
                Category.HEALTH,
                "Health score",
                healthScore + "/100",
                "Replica, configuration, and consumer signals",
                tone(health)),
            metric(
                "risk-signals",
                Category.HEALTH,
                "Risk signals",
                String.valueOf(recommendations.size()),
                "Actionable recommendations currently detected",
                recommendationsTone(recommendations)),
            metric(
                "partitions",
                Category.TOPOLOGY,
                "Partitions",
                String.valueOf(topic.getPartitionCount()),
                "Topic partitions available to producers and consumers",
                Tone.NEUTRAL),
            metric(
                "replication-factor",
                Category.TOPOLOGY,
                "Replication factor",
                String.valueOf(replicationFactor),
                "Replica copies targeted per partition",
                replicationFactor > 1 ? Tone.SUCCESS : Tone.WARNING),
            metric(
                "in-sync-replicas",
                Category.TOPOLOGY,
                "In-sync replicas",
                String.valueOf(topic.getInSyncReplicas()),
                "Replica assignments currently in sync",
                Tone.NEUTRAL),
            metric(
                "under-replicated",
                Category.TOPOLOGY,
                "Under-replicated partitions",
                String.valueOf(topic.getUnderReplicatedPartitions()),
                "Partitions below the target replica set",
                topic.getUnderReplicatedPartitions() == 0 ? Tone.SUCCESS : Tone.CRITICAL),
            metric(
                "leaderless",
                Category.TOPOLOGY,
                "Leaderless partitions",
                String.valueOf(leaderlessPartitions),
                "Partitions without a currently reported leader",
                leaderlessPartitions == 0 ? Tone.SUCCESS : Tone.CRITICAL),
            metric(
                "offset-spread",
                Category.TOPOLOGY,
                "Partition offset spread",
                formatNumber(partitionOffsetSpread),
                "Difference between the busiest and quietest partition",
                Tone.INFO),
            metric(
                "estimated-messages",
                Category.STORAGE,
                "Estimated records",
                formatNullable(topic.getMessagesCount()),
                "Calculated from log offsets when the cleanup policy supports it",
                Tone.NEUTRAL),
            metric(
                "stored-segments",
                Category.STORAGE,
                "Stored segment data",
                formatBytes(topic.getSize()),
                "Approximate local segment footprint",
                Tone.NEUTRAL),
            metric(
                "cleanup-policy",
                Category.STORAGE,
                "Cleanup policy",
                topic.getCleanUpPolicy().name(),
                "Broker retention behavior for this topic",
                Tone.NEUTRAL),
            metric(
                "retention-duration",
                Category.STORAGE,
                "Retention duration",
                formatDuration(configLong(configs, "retention.ms")),
                "Configured log retention window",
                Tone.NEUTRAL),
            metric(
                "retention-capacity",
                Category.STORAGE,
                "Retention capacity",
                formatBytes(configLong(configs, "retention.bytes")),
                "Configured log retention size",
                Tone.NEUTRAL),
            metric(
                "segment-duration",
                Category.STORAGE,
                "Segment duration",
                formatDuration(configLong(configs, "segment.ms")),
                "Time before a new log segment rolls",
                Tone.NEUTRAL),
            metric(
                "segment-capacity",
                Category.STORAGE,
                "Segment capacity",
                formatBytes(configLong(configs, "segment.bytes")),
                "Maximum bytes per log segment",
                Tone.NEUTRAL),
            metric(
                "max-message-size",
                Category.CONFIGURATION,
                "Maximum message size",
                formatBytes(configLong(configs, "max.message.bytes")),
                "Largest accepted serialized record",
                Tone.NEUTRAL),
            metric(
                "compression",
                Category.CONFIGURATION,
                "Compression",
                configValue(configs, "compression.type"),
                "Configured producer compression strategy",
                Tone.NEUTRAL),
            metric(
                "min-isr",
                Category.CONFIGURATION,
                "Minimum in-sync replicas",
                String.valueOf(minInSyncReplicas),
                "Minimum replicas required for acknowledged writes",
                replicationFactor > 1 && minInSyncReplicas < 2 ? Tone.WARNING : Tone.SUCCESS),
            metric(
                "unclean-leader-election",
                Category.CONFIGURATION,
                "Unclean leader election",
                uncleanLeaderElection ? "Enabled" : "Disabled",
                "Enabled can trade acknowledged data for availability",
                uncleanLeaderElection ? Tone.CRITICAL : Tone.SUCCESS),
            metric(
                "explicit-configs",
                Category.CONFIGURATION,
                "Explicit config overrides",
                String.valueOf(explicitConfigCount),
                "Values differing from broker defaults",
                Tone.INFO),
            metric(
                "config-drift",
                Category.CONFIGURATION,
                "Configuration drift",
                String.valueOf(explicitConfigCount),
                "Overrides to review before infrastructure changes",
                explicitConfigCount == 0 ? Tone.SUCCESS : Tone.INFO),
            metric(
                "ingress-rate",
                Category.TRAFFIC,
                "Ingress rate",
                formatRate(topic.getBytesInPerSec()),
                "Current topic bytes written per second",
                Tone.INFO),
            metric(
                "egress-rate",
                Category.TRAFFIC,
                "Egress rate",
                formatRate(topic.getBytesOutPerSec()),
                "Current topic bytes read per second",
                Tone.INFO),
            metric(
                "active-producers",
                Category.TRAFFIC,
                "Active producer sessions",
                String.valueOf(activeProducers),
                "Producer IDs reported by partition leader state",
                activeProducers > 0 ? Tone.SUCCESS : Tone.INFO),
            metric(
                "consumer-groups",
                Category.CONSUMERS,
                "Consumer groups",
                String.valueOf(consumers.size()),
                "Groups with assignments or offsets for this topic",
                Tone.NEUTRAL),
            metric(
                "active-consumers",
                Category.CONSUMERS,
                "Active consumers",
                String.valueOf(activeConsumers),
                "Assigned consumer members across related groups",
                activeConsumers > 0 ? Tone.SUCCESS : Tone.INFO),
            metric(
                "total-lag",
                Category.CONSUMERS,
                "Total consumer lag",
                formatNumber(totalLag),
                "Aggregate lag for related consumer groups",
                lagTone(totalLag)),
            metric(
                "max-group-lag",
                Category.CONSUMERS,
                "Highest group lag",
                formatNumber(maxLag),
                "Largest lag observed for one consumer group",
                lagTone(maxLag)),
            metric(
                "lagging-groups",
                Category.CONSUMERS,
                "Lagging groups",
                String.valueOf(laggingGroups),
                "Groups with at least one message behind",
                laggingGroups == 0 ? Tone.SUCCESS : Tone.WARNING),
            metric(
                "connectors",
                Category.INTEGRATIONS,
                "Connected connectors",
                String.valueOf(connectorCount),
                "Kafka Connect connectors currently associated with this topic",
                Tone.INFO),
            metric(
                "recommended-actions",
                Category.HEALTH,
                "Recommended actions",
                String.valueOf(recommendations.size()),
                "Prioritized developer follow-ups",
                recommendationsTone(recommendations)));

    return new Insights(
        Instant.now().toEpochMilli(), healthScore, health, metrics, recommendations);
  }

  private static List<Recommendation> recommendations(
      InternalTopic topic,
      int leaderlessPartitions,
      int minInSyncReplicas,
      boolean uncleanLeaderElection,
      long maxLag,
      List<InternalTopicConsumerGroup> consumers) {
    List<Recommendation> recommendations = new ArrayList<>();
    if (topic.getUnderReplicatedPartitions() > 0) {
      recommendations.add(
          recommendation(
              "under-replicated",
              Severity.CRITICAL,
              "Repair under-replicated partitions",
              "Replica assignments are below the configured target.",
              "STATISTICS"));
    }
    if (leaderlessPartitions > 0) {
      recommendations.add(
          recommendation(
              "leaderless",
              Severity.CRITICAL,
              "Investigate leaderless partitions",
              "One or more partitions have no reported leader.",
              "STATISTICS"));
    }
    if (topic.getReplicationFactor() < 2) {
      recommendations.add(
          recommendation(
              "single-replica",
              Severity.WARNING,
              "Review single-replica durability",
              "Replication factor below two leaves no replica redundancy.",
              "SETTINGS"));
    }
    if (topic.getReplicationFactor() > 1 && minInSyncReplicas < 2) {
      recommendations.add(
          recommendation(
              "min-isr",
              Severity.WARNING,
              "Raise minimum in-sync replicas",
              "Acknowledged writes can succeed with only one in-sync replica.",
              "SETTINGS"));
    }
    if (uncleanLeaderElection) {
      recommendations.add(
          recommendation(
              "unclean-election",
              Severity.CRITICAL,
              "Disable unclean leader election",
              "This setting can recover availability at the cost of acknowledged data.",
              "SETTINGS"));
    }
    if (maxLag >= LAG_WARNING_THRESHOLD) {
      Severity severity = maxLag >= LAG_CRITICAL_THRESHOLD ? Severity.CRITICAL : Severity.WARNING;
      recommendations.add(
          recommendation(
              "consumer-lag",
              severity,
              "Investigate consumer lag",
              "At least one related consumer group is behind the topic head.",
              "CONSUMERS"));
    }
    if (consumers.isEmpty()) {
      recommendations.add(
          recommendation(
              "no-consumers",
              Severity.INFO,
              "Confirm consumer ownership",
              "No consumer group currently reports an assignment or offset for this topic.",
              "CONSUMERS"));
    }
    if (recommendations.isEmpty()) {
      recommendations.add(
          recommendation(
              "healthy",
              Severity.INFO,
              "No immediate operational risk detected",
              "Review profile and statistics before changing production settings.",
              "PROFILE"));
    }
    return recommendations;
  }

  private static int healthScore(
      InternalTopic topic,
      int leaderlessPartitions,
      int minInSyncReplicas,
      boolean uncleanLeaderElection,
      long maxLag) {
    int score = 100;
    if (topic.getUnderReplicatedPartitions() > 0) {
      score -= 45;
    }
    if (leaderlessPartitions > 0) {
      score -= 35;
    }
    if (topic.getReplicationFactor() < 2) {
      score -= 20;
    }
    if (topic.getReplicationFactor() > 1 && minInSyncReplicas < 2) {
      score -= 15;
    }
    if (uncleanLeaderElection) {
      score -= 20;
    }
    if (maxLag >= LAG_CRITICAL_THRESHOLD) {
      score -= 20;
    } else if (maxLag >= LAG_WARNING_THRESHOLD) {
      score -= 10;
    }
    return Math.max(0, score);
  }

  private static Health health(InternalTopic topic, int leaderlessPartitions, int healthScore) {
    if (topic.getUnderReplicatedPartitions() > 0 || leaderlessPartitions > 0 || healthScore < 60) {
      return Health.CRITICAL;
    }
    return healthScore < 85 ? Health.ATTENTION : Health.HEALTHY;
  }

  private static long partitionOffsetSpread(List<InternalPartition> partitions) {
    List<Long> partitionCounts =
        partitions.stream()
            .map(
                partition -> {
                  if (partition.getOffsetMin() == null || partition.getOffsetMax() == null) {
                    return null;
                  }
                  return partition.getOffsetMax() - partition.getOffsetMin();
                })
            .filter(Objects::nonNull)
            .sorted(Comparator.naturalOrder())
            .toList();
    if (partitionCounts.size() < 2) {
      return 0L;
    }
    return partitionCounts.get(partitionCounts.size() - 1) - partitionCounts.get(0);
  }

  private static Recommendation recommendation(
      String id, Severity severity, String title, String detail, String action) {
    return new Recommendation(id, severity, title, detail, action);
  }

  private static Metric metric(
      String id, Category category, String label, String value, String detail, Tone tone) {
    return new Metric(id, category, label, value, detail, tone);
  }

  private static Tone tone(Health health) {
    return switch (health) {
      case HEALTHY -> Tone.SUCCESS;
      case ATTENTION -> Tone.WARNING;
      case CRITICAL -> Tone.CRITICAL;
    };
  }

  private static Tone recommendationsTone(List<Recommendation> recommendations) {
    if (recommendations.stream().anyMatch(item -> item.severity() == Severity.CRITICAL)) {
      return Tone.CRITICAL;
    }
    if (recommendations.stream().anyMatch(item -> item.severity() == Severity.WARNING)) {
      return Tone.WARNING;
    }
    return Tone.INFO;
  }

  private static Tone lagTone(long lag) {
    if (lag >= LAG_CRITICAL_THRESHOLD) {
      return Tone.CRITICAL;
    }
    if (lag >= LAG_WARNING_THRESHOLD) {
      return Tone.WARNING;
    }
    return lag == 0 ? Tone.SUCCESS : Tone.INFO;
  }

  private static String configValue(Map<String, String> configs, String key) {
    return Optional.ofNullable(configs.get(key))
        .filter(value -> !value.isBlank())
        .orElse("Broker default");
  }

  private static long configLong(Map<String, String> configs, String key) {
    return Optional.ofNullable(configs.get(key))
        .flatMap(
            value -> {
              try {
                return Optional.of(Long.parseLong(value));
              } catch (NumberFormatException ignored) {
                return Optional.empty();
              }
            })
        .orElse(0L);
  }

  private static int parseInt(@Nullable String value, int fallback) {
    try {
      return value == null ? fallback : Integer.parseInt(value);
    } catch (NumberFormatException ignored) {
      return fallback;
    }
  }

  private static String formatNullable(@Nullable Long value) {
    return value == null ? "Unavailable" : formatNumber(value);
  }

  private static String formatNumber(long value) {
    return String.format("%,d", value);
  }

  private static String formatBytes(long value) {
    if (value < 0) {
      return "Unlimited";
    }
    if (value < 1024) {
      return value + " B";
    }
    String[] units = {"KB", "MB", "GB", "TB"};
    int index = Math.min((int) (Math.log(value) / Math.log(1024)), units.length);
    double scaled = value / Math.pow(1024, index);
    return String.format("%.1f %s", scaled, units[index - 1]);
  }

  private static String formatDuration(long value) {
    if (value < 0) {
      return "Unlimited";
    }
    if (value == 0) {
      return "Broker default";
    }
    if (value < 60_000) {
      return value + " ms";
    }
    if (value < 3_600_000) {
      return value / 60_000 + " min";
    }
    if (value < 86_400_000) {
      return value / 3_600_000 + " h";
    }
    return value / 86_400_000 + " d";
  }

  private static String formatRate(@Nullable BigDecimal value) {
    return value == null ? "Unavailable" : formatBytes(value.longValue()) + "/s";
  }

  public record Insights(
      long generatedAtMs,
      int healthScore,
      Health health,
      List<Metric> metrics,
      List<Recommendation> recommendations) {}

  public record Metric(
      String id, Category category, String label, String value, String detail, Tone tone) {}

  public record Recommendation(
      String id, Severity severity, String title, String detail, String action) {}

  public enum Health {
    HEALTHY,
    ATTENTION,
    CRITICAL,
  }

  public enum Category {
    HEALTH,
    TOPOLOGY,
    STORAGE,
    CONFIGURATION,
    TRAFFIC,
    CONSUMERS,
    INTEGRATIONS,
  }

  public enum Tone {
    NEUTRAL,
    SUCCESS,
    WARNING,
    CRITICAL,
    INFO,
  }

  public enum Severity {
    INFO,
    WARNING,
    CRITICAL,
  }
}
