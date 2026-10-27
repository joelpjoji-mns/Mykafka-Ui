package io.kafbat.ui.service.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.google.common.annotations.VisibleForTesting;
import com.google.common.cache.Cache;
import com.google.common.cache.CacheBuilder;
import io.kafbat.ui.emitter.EnhancedConsumer;
import io.kafbat.ui.exception.ValidationException;
import io.kafbat.ui.model.AuditTrailEventDTO;
import io.kafbat.ui.model.AuditTrailResourceDTO;
import io.kafbat.ui.model.AuditTrailResponseDTO;
import io.kafbat.ui.model.KafkaCluster;
import io.kafbat.ui.service.ConsumerGroupService;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.common.TopicPartition;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

@Slf4j
@Service
public class AuditTrailService {

  private static final int DEFAULT_PAGE_SIZE = 25;
  private static final int MAX_PAGE_SIZE = 100;
  private static final int MAX_SCANNED_RECORDS = 2_000;
  private static final int MAX_AUDIT_PARTITIONS = 64;
  private static final int MAX_EMPTY_POLLS = 2;
  private static final Duration POLL_TIMEOUT = Duration.ofMillis(250);
  private static final Duration RECENT_READ_TTL = Duration.ofSeconds(10);
  private static final Duration PAGINATION_TTL = Duration.ofMinutes(5);
  private static final int MAX_SNAPSHOT_EVENTS = 100_000;
  private static final int MAX_CURSORS = 10_000;

  private final AuditService auditService;
  private final AuditRecordsLoader recordsLoader;
  // Filtered result lists are stored once per (audit read, query); cursors only reference them, so
  // many users can page concurrently without evicting each other's cursors.
  private final Cache<SnapshotKey, AuditSnapshot> snapshots;
  private final Cache<String, AuditCursor> cursors;
  // Re-filtering within a few seconds reuses the last audit topic read instead of re-polling it.
  private final Cache<ReadKey, RecentRead> recentReads;

  @Autowired
  public AuditTrailService(AuditService auditService, ConsumerGroupService consumerGroupService) {
    this(auditService, new KafkaAuditRecordsLoader(consumerGroupService));
  }

  @VisibleForTesting
  AuditTrailService(AuditService auditService, AuditRecordsLoader recordsLoader) {
    this.auditService = auditService;
    this.recordsLoader = recordsLoader;
    this.snapshots = CacheBuilder.newBuilder()
        .maximumWeight(MAX_SNAPSHOT_EVENTS)
        .weigher((SnapshotKey key, AuditSnapshot snapshot) -> snapshot.events().size() + 1)
        .expireAfterAccess(PAGINATION_TTL)
        .build();
    this.cursors =
        CacheBuilder.newBuilder().maximumSize(MAX_CURSORS).expireAfterAccess(PAGINATION_TTL).build();
    this.recentReads =
        CacheBuilder.newBuilder().maximumSize(16).expireAfterWrite(RECENT_READ_TTL).build();
  }

  public Mono<AuditTrailResponseDTO> getAuditTrail(KafkaCluster cluster, Query query) {
    validateQuery(query);
    Optional<String> auditTopic = auditService.getAuditTopic(cluster);
    if (auditTopic.isEmpty()) {
      return Mono.just(unavailable("Audit topic recording is not enabled for this cluster."));
    }

    return Mono.fromCallable(
            () ->
                query.hasCursor()
                    ? pageFromCursor(cluster, query)
                    : pageFromAuditTopic(cluster, auditTopic.get(), query))
        .subscribeOn(Schedulers.boundedElastic())
        .onErrorResume(
            error -> {
              if (error instanceof ValidationException) {
                return Mono.error(error);
              }
              log.warn("Unable to read audit topic for cluster '{}'", cluster.getName(), error);
              return Mono.just(
                  unavailable(
                      "Audit records are currently unavailable because the audit topic could not be"
                          + " read."));
            });
  }

  private AuditTrailResponseDTO pageFromAuditTopic(
      KafkaCluster cluster, String auditTopic, Query query) {
    RecentRead read = loadRecent(cluster, auditTopic);
    SnapshotKey key = new SnapshotKey(read.id(), cluster.getName(), query.signature());
    AuditSnapshot cached = snapshots.getIfPresent(key);
    if (cached != null) {
      return page(key, cached, 0, resolvePageSize(query.limit()));
    }
    AuditReadResult result = read.result();
    List<AuditTrailEventDTO> events =
        result.records().stream()
            .map(this::toEvent)
            .flatMap(Optional::stream)
            .filter(event -> matches(event, query))
            .sorted(
                Comparator.comparing(AuditTrailEventDTO::getTimestamp)
                    .reversed()
                    .thenComparing(AuditTrailEventDTO::getOperation)
                    .thenComparing(AuditTrailEventDTO::getOperator))
            .toList();
    return page(key, new AuditSnapshot(events, result.truncated()), 0, resolvePageSize(query.limit()));
  }

  private RecentRead loadRecent(KafkaCluster cluster, String auditTopic) {
    ReadKey key = new ReadKey(cluster.getName(), auditTopic);
    RecentRead cached = recentReads.getIfPresent(key);
    if (cached != null) {
      return cached;
    }
    RecentRead loaded =
        new RecentRead(UUID.randomUUID().toString(), recordsLoader.load(cluster, auditTopic));
    recentReads.put(key, loaded);
    return loaded;
  }

  private AuditTrailResponseDTO pageFromCursor(KafkaCluster cluster, Query query) {
    AuditCursor cursor = cursors.getIfPresent(query.cursor());
    AuditSnapshot snapshot = cursor == null ? null : snapshots.getIfPresent(cursor.snapshotKey());
    if (snapshot == null
        || !cursor.snapshotKey().clusterName().equals(cluster.getName())
        || !cursor.snapshotKey().signature().equals(query.signature())) {
      throw new ValidationException("Audit page cursor is invalid or expired.");
    }
    return page(cursor.snapshotKey(), snapshot, cursor.nextIndex(), resolvePageSize(query.limit()));
  }

  private AuditTrailResponseDTO page(
      SnapshotKey snapshotKey, AuditSnapshot snapshot, int start, int pageSize) {
    List<AuditTrailEventDTO> events = snapshot.events();
    int end = Math.min(start + pageSize, events.size());
    AuditTrailResponseDTO response =
        new AuditTrailResponseDTO()
            .status(AuditTrailResponseDTO.StatusEnum.AVAILABLE)
            .events(events.subList(start, end))
            .truncated(snapshot.truncated());
    if (end < events.size()) {
      if (snapshots.getIfPresent(snapshotKey) == null) {
        snapshots.put(snapshotKey, snapshot);
      }
      String nextCursor = UUID.randomUUID().toString();
      cursors.put(nextCursor, new AuditCursor(snapshotKey, end));
      response.nextCursor(nextCursor);
    }
    return response;
  }

  private static AuditTrailResponseDTO unavailable(String reason) {
    return new AuditTrailResponseDTO()
        .status(AuditTrailResponseDTO.StatusEnum.UNAVAILABLE)
        .unavailableReason(reason)
        .events(List.of())
        .truncated(false);
  }

  private void validateQuery(Query query) {
    if (query.from() != null && query.to() != null && query.from().isAfter(query.to())) {
      throw new ValidationException("Audit start time must not be after the end time.");
    }
    resolvePageSize(query.limit());
    outcome(query.outcome());
  }

  private static int resolvePageSize(Integer requestedSize) {
    if (requestedSize == null) {
      return DEFAULT_PAGE_SIZE;
    }
    if (requestedSize < 1 || requestedSize > MAX_PAGE_SIZE) {
      throw new ValidationException("Audit page size must be between 1 and " + MAX_PAGE_SIZE + ".");
    }
    return requestedSize;
  }

  private static boolean matches(AuditTrailEventDTO event, Query query) {
    if (query.from() != null && event.getTimestamp().isBefore(query.from())) {
      return false;
    }
    if (query.to() != null && event.getTimestamp().isAfter(query.to())) {
      return false;
    }
    if (hasText(query.resource())
        && event.getResources().stream()
            .noneMatch(resource -> matchesResource(resource, query.resource()))) {
      return false;
    }
    if (hasText(query.operation())
        && !containsIgnoreCase(event.getOperation(), query.operation())) {
      return false;
    }
    Outcome outcome = outcome(query.outcome());
    return outcome == null || event.getOutcome().getValue().equals(outcome.name());
  }

  private static boolean matchesResource(AuditTrailResourceDTO resource, String filter) {
    return containsIgnoreCase(resource.getType(), filter)
        || containsIgnoreCase(resource.getResourceId(), filter);
  }

  private static boolean containsIgnoreCase(String value, String filter) {
    return value != null
        && value.toLowerCase(Locale.ROOT).contains(filter.trim().toLowerCase(Locale.ROOT));
  }

  private static boolean hasText(String value) {
    return value != null && !value.isBlank();
  }

  private Optional<AuditTrailEventDTO> toEvent(AuditRecord record) {
    if (record.timestamp() == null || record.result() == null) {
      return Optional.empty();
    }
    try {
      return Optional.of(
          new AuditTrailEventDTO()
              .timestamp(
                  OffsetDateTime.parse(record.timestamp()).withOffsetSameInstant(ZoneOffset.UTC))
              .operator(Optional.ofNullable(record.username()).orElse("Unknown"))
              .resources(
                  Optional.ofNullable(record.resources()).orElse(List.of()).stream()
                      .map(this::toResource)
                      .toList())
              .operation(Optional.ofNullable(record.operation()).orElse("Unknown"))
              .outcome(
                  record.result().success()
                      ? AuditTrailEventDTO.OutcomeEnum.SUCCESS
                      : AuditTrailEventDTO.OutcomeEnum.FAILURE)
              .error(record.result().error() == null ? null : record.result().error().name()));
    } catch (DateTimeParseException exception) {
      log.debug("Skipping audit record with an invalid timestamp");
      return Optional.empty();
    }
  }

  private AuditTrailResourceDTO toResource(AuditRecord.AuditResource resource) {
    return new AuditTrailResourceDTO()
        .type(resource.type() == null ? "UNKNOWN" : resource.type().name())
        .resourceId(resourceId(resource.id()).orElse(null))
        .alter(resource.alter())
        .accessType(Optional.ofNullable(resource.accessType()).orElse(List.of()));
  }

  private static Optional<String> resourceId(Object resourceId) {
    if (resourceId == null) {
      return Optional.empty();
    }
    if (resourceId instanceof String string) {
      return Optional.of(string);
    }
    try {
      return Optional.of(AuditRecord.MAPPER.writeValueAsString(resourceId));
    } catch (JsonProcessingException exception) {
      return Optional.of(String.valueOf(resourceId));
    }
  }

  private static Outcome outcome(String value) {
    if (!hasText(value)) {
      return null;
    }
    try {
      return Outcome.valueOf(value.trim().toUpperCase(Locale.ROOT));
    } catch (IllegalArgumentException exception) {
      throw new ValidationException("Audit outcome must be SUCCESS or FAILURE.");
    }
  }

  public record Query(
      OffsetDateTime from,
      OffsetDateTime to,
      String resource,
      String operation,
      String outcome,
      String cursor,
      Integer limit) {
    private boolean hasCursor() {
      return hasText(cursor);
    }

    private QuerySignature signature() {
      return new QuerySignature(from, to, resource, operation, outcome);
    }
  }

  @VisibleForTesting
  interface AuditRecordsLoader {
    AuditReadResult load(KafkaCluster cluster, String auditTopic);
  }

  @VisibleForTesting
  record AuditReadResult(List<AuditRecord> records, boolean truncated) {}

  private record AuditSnapshot(List<AuditTrailEventDTO> events, boolean truncated) {}

  private record SnapshotKey(String readId, String clusterName, QuerySignature signature) {}

  private record AuditCursor(SnapshotKey snapshotKey, int nextIndex) {}

  private record ReadKey(String clusterName, String auditTopic) {}

  private record RecentRead(String id, AuditReadResult result) {}

  private record QuerySignature(
      OffsetDateTime from, OffsetDateTime to, String resource, String operation, String outcome) {}

  private enum Outcome {
    SUCCESS,
    FAILURE
  }

  private static final class KafkaAuditRecordsLoader implements AuditRecordsLoader {

    private final ConsumerGroupService consumerGroupService;

    private KafkaAuditRecordsLoader(ConsumerGroupService consumerGroupService) {
      this.consumerGroupService = consumerGroupService;
    }

    @Override
    public AuditReadResult load(KafkaCluster cluster, String auditTopic) {
      try (EnhancedConsumer consumer =
          consumerGroupService.createConsumer(
              cluster, Map.of(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, MAX_SCANNED_RECORDS))) {
        List<TopicPartition> allPartitions =
            consumer.partitionsFor(auditTopic).stream()
                .map(partition -> new TopicPartition(auditTopic, partition.partition()))
                .toList();
        boolean partitionLimitReached = allPartitions.size() > MAX_AUDIT_PARTITIONS;
        List<TopicPartition> partitions =
            allPartitions.stream().limit(MAX_AUDIT_PARTITIONS).toList();
        if (partitions.isEmpty()) {
          return new AuditReadResult(List.of(), partitionLimitReached);
        }

        Map<TopicPartition, Long> beginningOffsets = consumer.beginningOffsets(partitions);
        Map<TopicPartition, Long> endingOffsets = consumer.endOffsets(partitions);
        int recordsPerPartition = Math.max(1, MAX_SCANNED_RECORDS / partitions.size());
        Map<TopicPartition, Long> startingOffsets =
            partitions.stream()
                .filter(partition -> endingOffsets.get(partition) > beginningOffsets.get(partition))
                .collect(
                    Collectors.toMap(
                        partition -> partition,
                        partition ->
                            Math.max(
                                beginningOffsets.get(partition),
                                endingOffsets.get(partition) - recordsPerPartition)));
        if (startingOffsets.isEmpty()) {
          return new AuditReadResult(List.of(), partitionLimitReached);
        }

        consumer.assign(startingOffsets.keySet());
        startingOffsets.forEach(consumer::seek);
        List<AuditRecord> records = new ArrayList<>();
        int emptyPolls = 0;
        while (records.size() < MAX_SCANNED_RECORDS && emptyPolls < MAX_EMPTY_POLLS) {
          var polled = consumer.poll(POLL_TIMEOUT);
          if (polled.isEmpty()) {
            emptyPolls++;
            continue;
          }
          emptyPolls = 0;
          polled.forEach(record -> {
            // Tombstones (null values) carry no audit event and must not abort the whole read.
            if (record.value() != null) {
              parseRecord(record.value().get()).ifPresent(records::add);
            }
          });
          if (startingOffsets.keySet().stream()
              .allMatch(
                  partition -> consumer.position(partition) >= endingOffsets.get(partition))) {
            break;
          }
        }

        boolean olderRecordsNotScanned =
            startingOffsets.entrySet().stream()
                .anyMatch(entry -> entry.getValue() > beginningOffsets.get(entry.getKey()));
        boolean selectedRangeNotFullyRead =
            startingOffsets.keySet().stream()
                .anyMatch(partition -> consumer.position(partition) < endingOffsets.get(partition));
        return new AuditReadResult(
            records, partitionLimitReached || olderRecordsNotScanned || selectedRangeNotFullyRead);
      }
    }

    private Optional<AuditRecord> parseRecord(byte[] value) {
      if (value == null) {
        return Optional.empty();
      }
      try {
        return Optional.of(
            AuditRecord.MAPPER.readValue(
                new String(value, StandardCharsets.UTF_8), AuditRecord.class));
      } catch (JsonProcessingException exception) {
        log.debug("Skipping malformed audit record");
        return Optional.empty();
      }
    }
  }
}
