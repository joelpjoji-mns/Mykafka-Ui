package io.kafbat.ui.service;

import static java.util.stream.Collectors.toMap;
import static java.util.stream.Collectors.toSet;
import static org.apache.kafka.common.ConsumerGroupState.DEAD;
import static org.apache.kafka.common.ConsumerGroupState.EMPTY;

import com.google.common.base.Preconditions;
import io.kafbat.ui.exception.NotFoundException;
import io.kafbat.ui.exception.ValidationException;
import io.kafbat.ui.model.KafkaCluster;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import javax.annotation.Nullable;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.admin.ConsumerGroupDescription;
import org.apache.kafka.clients.admin.OffsetSpec;
import org.apache.kafka.common.ConsumerGroupState;
import org.apache.kafka.common.TopicPartition;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

/**
 * Implementation follows https://cwiki.apache.org/confluence/display/KAFKA/KIP-122%3A+Add+Reset+Consumer+Group+Offsets+tooling .
 * to works like "kafka-consumer-groups --reset-offsets" console command
 * (see kafka.admin.ConsumerGroupCommand)
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class OffsetsResetService {

  private static final Duration ACTIVE_GROUP_RESET_POLL_INTERVAL = Duration.ofMillis(500);

  private final AdminClientService adminClientService;

  public Mono<Void> resetToEarliest(
      KafkaCluster cluster, String group, String topic, Collection<Integer> partitions) {
    return resetToEarliest(cluster, group, topic, partitions, false);
  }

  public Mono<Void> resetToEarliest(
      KafkaCluster cluster,
      String group,
      String topic,
      Collection<Integer> partitions,
      boolean waitForInactive) {
    return getAdminClientForReset(cluster, group, waitForInactive)
        .flatMap(ac ->
            offsets(ac, topic, partitions, OffsetSpec.earliest())
                .flatMap(offsets -> resetOffsets(ac, group, offsets)));
  }

  private Mono<Map<TopicPartition, Long>> offsets(ReactiveAdminClient client,
                                                  String topic,
                                                  @Nullable Collection<Integer> partitions,
                                                  OffsetSpec spec) {
    if (partitions == null) {
      return client.listTopicOffsets(topic, spec, true);
    }
    return client.listOffsets(
        partitions.stream().map(idx -> new TopicPartition(topic, idx)).collect(toSet()),
        spec,
        true
    );
  }

  public Mono<Void> resetToLatest(
      KafkaCluster cluster, String group, String topic, Collection<Integer> partitions) {
    return resetToLatest(cluster, group, topic, partitions, false);
  }

  public Mono<Void> resetToLatest(
      KafkaCluster cluster,
      String group,
      String topic,
      Collection<Integer> partitions,
      boolean waitForInactive) {
    return getAdminClientForReset(cluster, group, waitForInactive)
        .flatMap(ac ->
            offsets(ac, topic, partitions, OffsetSpec.latest())
                .flatMap(offsets -> resetOffsets(ac, group, offsets)));
  }

  public Mono<Void> resetToTimestamp(
      KafkaCluster cluster, String group, String topic, Collection<Integer> partitions,
      long targetTimestamp) {
    return resetToTimestamp(cluster, group, topic, partitions, targetTimestamp, false);
  }

  public Mono<Void> resetToTimestamp(
      KafkaCluster cluster,
      String group,
      String topic,
      Collection<Integer> partitions,
      long targetTimestamp,
      boolean waitForInactive) {
    return getAdminClientForReset(cluster, group, waitForInactive)
        .flatMap(ac ->
            offsets(ac, topic, partitions, OffsetSpec.forTimestamp(targetTimestamp))
                .flatMap(
                    foundOffsets -> offsets(ac, topic, partitions, OffsetSpec.latest())
                        .map(endOffsets -> editTsOffsets(foundOffsets, endOffsets))
                )
                .flatMap(offsets -> resetOffsets(ac, group, offsets))
        );
  }

  public Mono<Void> resetToOffsets(
      KafkaCluster cluster, String group, String topic, Map<Integer, Long> targetOffsets) {
    return resetToOffsets(cluster, group, topic, targetOffsets, false);
  }

  public Mono<Void> resetToOffsets(
      KafkaCluster cluster,
      String group,
      String topic,
      Map<Integer, Long> targetOffsets,
      boolean waitForInactive) {
    Preconditions.checkNotNull(targetOffsets);
    var partitionOffsets = toTopicPartitionOffsets(topic, targetOffsets);
    return getAdminClientForReset(cluster, group, waitForInactive).flatMap(
        ac ->
            ac.listOffsets(partitionOffsets.keySet(), OffsetSpec.earliest(), true)
                .flatMap(earliest ->
                    ac.listOffsets(partitionOffsets.keySet(), OffsetSpec.latest(), true)
                        .map(latest -> editOffsetsBounds(partitionOffsets, earliest, latest))
                        .flatMap(offsetsToCommit -> resetOffsets(ac, group, offsetsToCommit)))
    );
  }

  public Mono<OffsetResetPreview> previewToEarliest(
      KafkaCluster cluster, String group, String topic, Collection<Integer> partitions) {
    return getAdminClientForExistingGroup(cluster, group)
        .flatMap(ac -> topicOffsetBounds(ac, topic, partitions)
            .flatMap(bounds -> previewOffsets(ac, group, bounds, bounds.earliest(), Map.of())));
  }

  public Mono<OffsetResetPreview> previewToLatest(
      KafkaCluster cluster, String group, String topic, Collection<Integer> partitions) {
    return getAdminClientForExistingGroup(cluster, group)
        .flatMap(ac -> topicOffsetBounds(ac, topic, partitions)
            .flatMap(bounds -> previewOffsets(ac, group, bounds, bounds.latest(), Map.of())));
  }

  public Mono<OffsetResetPreview> previewToTimestamp(
      KafkaCluster cluster, String group, String topic, Collection<Integer> partitions,
      long targetTimestamp) {
    return getAdminClientForExistingGroup(cluster, group)
        .flatMap(ac -> topicOffsetBounds(ac, topic, partitions)
            .flatMap(bounds -> offsets(ac, topic, partitions, OffsetSpec.forTimestamp(targetTimestamp))
                .flatMap(foundOffsets -> previewOffsets(
                    ac,
                    group,
                    bounds,
                    editTsOffsets(foundOffsets, bounds.latest()),
                    Map.of()
                ))));
  }

  public Mono<OffsetResetPreview> previewToOffsets(
      KafkaCluster cluster, String group, String topic, Map<Integer, Long> targetOffsets) {
    Preconditions.checkNotNull(targetOffsets);
    var requestedOffsets = toTopicPartitionOffsets(topic, targetOffsets);
    return getAdminClientForExistingGroup(cluster, group)
        .flatMap(ac -> partitionOffsetBounds(ac, requestedOffsets.keySet())
            .flatMap(bounds -> previewOffsets(
                ac,
                group,
                bounds,
                editOffsetsBounds(requestedOffsets, bounds.earliest(), bounds.latest()),
                requestedOffsets
            )));
  }

  private Mono<ReactiveAdminClient> getAdminClientForReset(
      KafkaCluster cluster, String groupId, boolean waitForInactive) {
    return adminClientService.get(cluster)
        .flatMap(ac -> {
          Mono<Void> groupCondition = waitForInactive
              ? waitForGroupToBecomeInactive(ac, groupId)
              : requireInactiveGroup(ac, groupId);
          return groupCondition.thenReturn(ac);
        });
  }

  private Mono<ReactiveAdminClient> getAdminClientForExistingGroup(
      KafkaCluster cluster, String groupId) {
    return adminClientService.get(cluster)
        .flatMap(ac -> describeExistingConsumerGroup(ac, groupId).thenReturn(ac));
  }

  private Mono<ConsumerGroupDescription> describeExistingConsumerGroup(
      ReactiveAdminClient adminClient, String groupId) {
    // describeConsumerGroups() returns a synthetic description for absent groups.
    return adminClient.listConsumerGroupNames()
        .filter(groupIds -> groupIds.contains(groupId))
        .flatMap(groupIds -> adminClient.describeConsumerGroups(List.of(groupId)))
        .filter(groupDescriptions -> groupDescriptions.containsKey(groupId))
        .map(groupDescriptions -> groupDescriptions.get(groupId))
        .switchIfEmpty(Mono.error(new NotFoundException("Consumer group not found")));
  }

  private Mono<Void> requireInactiveGroup(ReactiveAdminClient adminClient, String groupId) {
    return describeExistingConsumerGroup(adminClient, groupId)
        .flatMap(group -> {
          if (isInactive(group.state())) {
            return Mono.empty();
          }
          return Mono.error(activeGroupException(group.state()));
        });
  }

  private Mono<Void> waitForGroupToBecomeInactive(
      ReactiveAdminClient adminClient, String groupId) {
    return Mono.defer(() -> describeExistingConsumerGroup(adminClient, groupId))
        .repeatWhen(completed -> completed.delayElements(ACTIVE_GROUP_RESET_POLL_INTERVAL))
        .filter(group -> isInactive(group.state()))
        .next()
        .then();
  }

  private boolean isInactive(ConsumerGroupState state) {
    return Set.of(DEAD, EMPTY).contains(state);
  }

  private ValidationException activeGroupException(ConsumerGroupState state) {
    return new ValidationException(
        "Group's offsets can be reset only if group is inactive, but group is in %s state"
        .formatted(state.name()));
  }

  private Map<TopicPartition, Long> editTsOffsets(Map<TopicPartition, Long> foundTsOffsets,
                                                  Map<TopicPartition, Long> endOffsets) {
    // for partitions where we didnt find offset by timestamp, we use end offsets
    Map<TopicPartition, Long> result = new HashMap<>(endOffsets);
    result.putAll(foundTsOffsets);
    return result;
  }

  /**
   * Checks if submitted offsets is between earliest and latest offsets. If case of range change
   * fail we reset offset to either earliest or latest offsets (To follow logic from
   * kafka.admin.ConsumerGroupCommand.scala)
   */
  private Map<TopicPartition, Long> editOffsetsBounds(Map<TopicPartition, Long> offsetsToCheck,
                                                      Map<TopicPartition, Long> earliestOffsets,
                                                      Map<TopicPartition, Long> latestOffsets) {
    var result = new HashMap<TopicPartition, Long>();
    offsetsToCheck.forEach((tp, offset) -> {
      if (earliestOffsets.get(tp) > offset) {
        log.warn("Offset for partition {} is lower than earliest offset, resetting to earliest",
            tp);
        result.put(tp, earliestOffsets.get(tp));
      } else if (latestOffsets.get(tp) < offset) {
        log.warn("Offset for partition {} is greater than latest offset, resetting to latest", tp);
        result.put(tp, latestOffsets.get(tp));
      } else {
        result.put(tp, offset);
      }
    });
    return result;
  }

  private Map<TopicPartition, Long> toTopicPartitionOffsets(
      String topic, Map<Integer, Long> targetOffsets) {
    return targetOffsets.entrySet().stream()
        .collect(toMap(e -> new TopicPartition(topic, e.getKey()), Map.Entry::getValue));
  }

  private Mono<OffsetBounds> topicOffsetBounds(ReactiveAdminClient client,
                                                String topic,
                                                @Nullable Collection<Integer> partitions) {
    return Mono.zip(
        offsets(client, topic, partitions, OffsetSpec.earliest()),
        offsets(client, topic, partitions, OffsetSpec.latest()),
        OffsetBounds::new
    );
  }

  private Mono<OffsetBounds> partitionOffsetBounds(ReactiveAdminClient client,
                                                    Collection<TopicPartition> partitions) {
    return Mono.zip(
        client.listOffsets(partitions, OffsetSpec.earliest(), true),
        client.listOffsets(partitions, OffsetSpec.latest(), true),
        OffsetBounds::new
    );
  }

  private Mono<OffsetResetPreview> previewOffsets(
      ReactiveAdminClient client,
      String group,
      OffsetBounds bounds,
      Map<TopicPartition, Long> targetOffsets,
      Map<TopicPartition, Long> requestedOffsets) {
    return client.listConsumerGroupOffsets(
            List.of(group),
            new ArrayList<>(targetOffsets.keySet())
        )
        .map(committedOffsets -> {
          Map<TopicPartition, Long> groupOffsets = committedOffsets.row(group);
          List<OffsetResetPartitionPreview> partitions = targetOffsets.entrySet().stream()
              .map(entry -> toPartitionPreview(
                  entry,
                  groupOffsets.get(entry.getKey()),
                  requestedOffsets.get(entry.getKey()),
                  bounds
              ))
              .sorted(Comparator.comparingInt(OffsetResetPartitionPreview::partition))
              .toList();
          return new OffsetResetPreview(partitions);
        });
  }

  private OffsetResetPartitionPreview toPartitionPreview(
      Map.Entry<TopicPartition, Long> target,
      @Nullable Long currentCommittedOffset,
      @Nullable Long requestedOffset,
      OffsetBounds bounds) {
    TopicPartition topicPartition = target.getKey();
    long targetOffset = target.getValue();
    long logStartOffset = bounds.earliest().get(topicPartition);
    long logEndOffset = bounds.latest().get(topicPartition);
    OffsetResetImpact impact = currentCommittedOffset == null
        ? OffsetResetImpact.UNKNOWN
        : offsetImpact(currentCommittedOffset, targetOffset);
    Long affectedMessages = switch (impact) {
      case REPLAY -> currentCommittedOffset - targetOffset;
      case SKIP -> targetOffset - currentCommittedOffset;
      case NONE -> 0L;
      case UNKNOWN -> null;
    };
    boolean targetAdjusted = requestedOffset != null && requestedOffset != targetOffset;

    return new OffsetResetPartitionPreview(
        topicPartition.partition(),
        currentCommittedOffset,
        requestedOffset,
        targetOffset,
        logStartOffset,
        logEndOffset,
        impact,
        affectedMessages,
        targetAdjusted
    );
  }

  private OffsetResetImpact offsetImpact(long currentCommittedOffset, long targetOffset) {
    if (targetOffset < currentCommittedOffset) {
      return OffsetResetImpact.REPLAY;
    }
    if (targetOffset > currentCommittedOffset) {
      return OffsetResetImpact.SKIP;
    }
    return OffsetResetImpact.NONE;
  }

  private Mono<Void> resetOffsets(ReactiveAdminClient adminClient,
                                  String groupId,
                                  Map<TopicPartition, Long> offsets) {
    // Recheck immediately before altering offsets to fail closed if a member joined while planning.
    return requireInactiveGroup(adminClient, groupId)
        .then(adminClient.alterConsumerGroupOffsets(groupId, offsets));
  }

  public record OffsetResetPreview(List<OffsetResetPartitionPreview> partitions) {
  }

  public record OffsetResetPartitionPreview(
      int partition,
      @Nullable Long currentCommittedOffset,
      @Nullable Long requestedOffset,
      long targetOffset,
      long logStartOffset,
      long logEndOffset,
      OffsetResetImpact impact,
      @Nullable Long affectedMessages,
      boolean targetAdjusted) {
  }

  public enum OffsetResetImpact {
    REPLAY,
    SKIP,
    NONE,
    UNKNOWN
  }

  private record OffsetBounds(
      Map<TopicPartition, Long> earliest,
      Map<TopicPartition, Long> latest) {
  }

}
