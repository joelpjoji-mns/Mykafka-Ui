package io.kafbat.ui.service.audit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.kafbat.ui.exception.ValidationException;
import io.kafbat.ui.model.AuditTrailResponseDTO;
import io.kafbat.ui.model.KafkaCluster;
import io.kafbat.ui.model.rbac.Resource;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AuditTrailServiceTest {

  private static final String AUDIT_TOPIC = "__kui-audit-log";

  private final KafkaCluster cluster = KafkaCluster.builder().name("local").build();
  private final AuditService auditService = mock(AuditService.class);
  private final AuditTrailService.AuditRecordsLoader recordsLoader = mock(AuditTrailService.AuditRecordsLoader.class);

  private AuditTrailService service;

  @BeforeEach
  void setUp() {
    service = new AuditTrailService(auditService, recordsLoader);
  }

  @Test
  void returnsUnavailableStateWhenTopicAuditIsDisabled() {
    when(auditService.getAuditTopic(any())).thenReturn(Optional.empty());

    var response = service.getAuditTrail(cluster, query(null, null, null, null, null, 25)).block();

    assertThat(response.getStatus()).isEqualTo(AuditTrailResponseDTO.StatusEnum.UNAVAILABLE);
    assertThat(response.getUnavailableReason()).contains("not enabled");
    assertThat(response.getEvents()).isEmpty();
    assertThat(response.getTruncated()).isFalse();
  }

  @Test
  void filtersAndPaginatesAuditEvidenceFromASingleSnapshot() {
    when(auditService.getAuditTopic(cluster)).thenReturn(Optional.of(AUDIT_TOPIC));
    when(recordsLoader.load(cluster, AUDIT_TOPIC)).thenReturn(new AuditTrailService.AuditReadResult(List.of(
        record("2026-08-15T12:00:00Z", "deleteTopic", "orders", true),
        record("2026-08-15T11:00:00Z", "createTopic", "orders", true),
        record("2026-08-15T10:00:00Z", "createTopic", "payments", false)
    ), true));

    var firstPage = service.getAuditTrail(cluster, query("orders", "topic", "SUCCESS", null, null, 1)).block();
    var secondPage = service.getAuditTrail(cluster,
        query("orders", "topic", "SUCCESS", firstPage.getNextCursor(), null, 1)).block();

    assertThat(firstPage.getStatus()).isEqualTo(AuditTrailResponseDTO.StatusEnum.AVAILABLE);
    assertThat(firstPage.getEvents()).extracting(event -> event.getOperation())
        .containsExactly("deleteTopic");
    assertThat(firstPage.getNextCursor()).isNotBlank();
    assertThat(firstPage.getTruncated()).isTrue();
    assertThat(secondPage.getEvents()).extracting(event -> event.getOperation())
        .containsExactly("createTopic");
    assertThat(secondPage.getNextCursor()).isNull();
  }

  @Test
  void keepsCursorsValidAcrossManyConcurrentQueriesAndReusesRecentReads() {
    when(auditService.getAuditTopic(cluster)).thenReturn(Optional.of(AUDIT_TOPIC));
    when(recordsLoader.load(cluster, AUDIT_TOPIC)).thenReturn(new AuditTrailService.AuditReadResult(List.of(
        record("2026-08-15T12:00:00Z", "deleteTopic", "orders", true),
        record("2026-08-15T11:00:00Z", "createTopic", "orders", true)
    ), false));

    var firstPage = service.getAuditTrail(cluster, query(null, null, null, null, null, 1)).block();
    for (int i = 0; i < 100; i++) {
      service.getAuditTrail(cluster, query("orders", null, null, null, null, 1)).block();
    }
    var secondPage = service.getAuditTrail(cluster,
        query(null, null, null, firstPage.getNextCursor(), null, 1)).block();

    assertThat(secondPage.getEvents()).extracting(event -> event.getOperation())
        .containsExactly("createTopic");
    verify(recordsLoader, times(1)).load(cluster, AUDIT_TOPIC);
  }

  @Test
  void rejectsInvalidAuditTimeRangeAndPageSize() {
    OffsetDateTime now = OffsetDateTime.parse("2026-08-15T12:00:00Z");

    assertThatThrownBy(() -> service.getAuditTrail(cluster,
        new AuditTrailService.Query(now, now.minusMinutes(1), null, null, null, null, 25)))
        .isInstanceOf(ValidationException.class)
        .hasMessageContaining("start time");
    assertThatThrownBy(() -> service.getAuditTrail(cluster, query(null, null, null, null, null, 101)))
        .isInstanceOf(ValidationException.class)
        .hasMessageContaining("page size");
  }

  private AuditTrailService.Query query(String resource,
                                        String operation,
                                        String outcome,
                                        String cursor,
                                        OffsetDateTime from,
                                        Integer limit) {
    return new AuditTrailService.Query(from, null, resource, operation, outcome, cursor, limit);
  }

  private AuditRecord record(String timestamp, String operation, String resourceId, boolean success) {
    return new AuditRecord(
        timestamp,
        "operator@example.com",
        cluster.getName(),
        List.of(new AuditRecord.AuditResource(Resource.TOPIC, resourceId, true, List.of("VIEW"))),
        operation,
        Map.of(),
        success
            ? AuditRecord.OperationResult.successful()
            : AuditRecord.OperationResult.error(new ValidationException("invalid"))
    );
  }
}