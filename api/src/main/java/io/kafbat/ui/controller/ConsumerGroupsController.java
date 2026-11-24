package io.kafbat.ui.controller;

import static io.kafbat.ui.model.rbac.permission.ConsumerGroupAction.DELETE;
import static io.kafbat.ui.model.rbac.permission.ConsumerGroupAction.RESET_OFFSETS;
import static io.kafbat.ui.model.rbac.permission.ConsumerGroupAction.VIEW;
import static java.lang.Boolean.TRUE;

import io.kafbat.ui.api.ConsumerGroupsApi;
import io.kafbat.ui.exception.ValidationException;
import io.kafbat.ui.mapper.ConsumerGroupMapper;
import io.kafbat.ui.model.ConsumerGroupDTO;
import io.kafbat.ui.model.ConsumerGroupDetailsDTO;
import io.kafbat.ui.model.ConsumerGroupOffsetResetImpactDTO;
import io.kafbat.ui.model.ConsumerGroupOffsetsResetDTO;
import io.kafbat.ui.model.ConsumerGroupOffsetsResetPartitionPreviewDTO;
import io.kafbat.ui.model.ConsumerGroupOffsetsResetPreviewDTO;
import io.kafbat.ui.model.ConsumerGroupOrderingDTO;
import io.kafbat.ui.model.ConsumerGroupStateDTO;
import io.kafbat.ui.model.ConsumerGroupsLagResponseDTO;
import io.kafbat.ui.model.ConsumerGroupsPageResponseDTO;
import io.kafbat.ui.model.PartitionOffsetDTO;
import io.kafbat.ui.model.SortOrderDTO;
import io.kafbat.ui.model.rbac.AccessContext;
import io.kafbat.ui.model.rbac.permission.TopicAction;
import io.kafbat.ui.service.ConsumerGroupService;
import io.kafbat.ui.service.OffsetsResetService;
import io.kafbat.ui.service.mcp.McpTool;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.util.CollectionUtils;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.util.function.Tuples;

@RestController
@RequiredArgsConstructor
@Slf4j
public class ConsumerGroupsController extends AbstractController implements ConsumerGroupsApi, McpTool {

  private final ConsumerGroupService consumerGroupService;
  private final OffsetsResetService offsetsResetService;

  @Value("${consumer.groups.page.size:25}")
  private int defaultConsumerGroupsPageSize;

  @Override
  public Mono<ResponseEntity<Void>> deleteConsumerGroup(String clusterName,
                                                        String id,
                                                        ServerWebExchange exchange) {
    var context = AccessContext.builder()
        .cluster(clusterName)
        .consumerGroupActions(id, DELETE)
        .operationName("deleteConsumerGroup")
        .build();

    return validateAccess(context)
        .then(consumerGroupService.deleteConsumerGroupById(getCluster(clusterName), id))
        .doOnEach(sig -> audit(context, sig))
        .thenReturn(ResponseEntity.ok().build());
  }

  @Override
  public Mono<ResponseEntity<Void>> deleteConsumerGroupOffsets(String clusterName,
                                                               String groupId,
                                                               String topicName,
                                                               ServerWebExchange exchange) {
    var context = AccessContext.builder()
        .cluster(clusterName)
        .consumerGroupActions(groupId, RESET_OFFSETS)
        .topicActions(topicName, TopicAction.VIEW)
        .operationName("deleteConsumerGroupOffsets")
        .build();

    return validateAccess(context)
        .then(consumerGroupService.deleteConsumerGroupOffset(getCluster(clusterName), groupId, topicName))
        .doOnEach(sig -> audit(context, sig))
        .thenReturn(ResponseEntity.ok().build());
  }

  @Override
  public Mono<ResponseEntity<ConsumerGroupDetailsDTO>> getConsumerGroup(String clusterName,
                                                                        String consumerGroupId,
                                                                        ServerWebExchange exchange) {
    var context = AccessContext.builder()
        .cluster(clusterName)
        .consumerGroupActions(consumerGroupId, VIEW)
        .operationName("getConsumerGroup")
        .build();

    return validateAccess(context)
        .then(consumerGroupService.getConsumerGroupDetail(getCluster(clusterName), consumerGroupId)
            .map(ConsumerGroupMapper::toDetailsDto)
            .map(ResponseEntity::ok))
        .doOnEach(sig -> audit(context, sig));
  }



  @Override
  public Mono<ResponseEntity<ConsumerGroupsLagResponseDTO>> getConsumerGroupsLag(String clusterName,
                                                                                 List<String> groupNames,
                                                                                 Long lastUpdate,
                                                                                 Boolean includePartitions,
                                                                                 ServerWebExchange exchange) {

    var context = AccessContext.builder()
        .cluster(clusterName)
        .operationName("getConsumerGroupsLag")
        .build();

    Mono<ResponseEntity<ConsumerGroupsLagResponseDTO>> result =
        consumerGroupService.getConsumerGroupsLag(
                getCluster(clusterName),
                groupNames,
                TRUE.equals(includePartitions),
                Optional.ofNullable(lastUpdate)
            ).flatMap(t ->
                Flux.fromIterable(t.getT1().entrySet())
                    .filterWhen(cg -> accessControlService.isConsumerGroupAccessible(cg.getKey(), clusterName))
                    .collectList()
                    .map(l -> l.stream().collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue)))
                    .map(l -> Tuples.of(t.getT2(), l))
            )
            .map(t ->
                new ConsumerGroupsLagResponseDTO(
                    t.getT1().orElse(0L), t.getT2()
                )
            )
            .map(ResponseEntity::ok)
            .switchIfEmpty(Mono.just(ResponseEntity.notFound().build()));

    return validateAccess(context)
        .then(result)
        .doOnEach(sig -> audit(context, sig));
  }

  @Override
  public Mono<ResponseEntity<Flux<ConsumerGroupDTO>>> getTopicConsumerGroups(String clusterName,
                                                                             String topicName,
                                                                             ServerWebExchange exchange) {
    var context = AccessContext.builder()
        .cluster(clusterName)
        .topicActions(topicName, TopicAction.VIEW)
        .operationName("getTopicConsumerGroups")
        .build();

    Mono<ResponseEntity<Flux<ConsumerGroupDTO>>> job =
        consumerGroupService.getConsumerGroupsForTopic(getCluster(clusterName), topicName)
            .flatMapMany(Flux::fromIterable)
            .filterWhen(cg -> accessControlService.isConsumerGroupAccessible(cg.getGroupId(), clusterName))
            .map(ConsumerGroupMapper::toDto)
            .collectList()
            .map(Flux::fromIterable)
            .map(ResponseEntity::ok)
            .switchIfEmpty(Mono.just(ResponseEntity.notFound().build()));

    return validateAccess(context)
        .then(job)
        .doOnEach(sig -> audit(context, sig));
  }



  @Override
  public Mono<ResponseEntity<ConsumerGroupsPageResponseDTO>> getConsumerGroupsPage(
      String clusterName,
      Integer page,
      Integer perPage,
      String search,
      ConsumerGroupOrderingDTO orderBy,
      SortOrderDTO sortOrderDto,
      Boolean fts,
      List<ConsumerGroupStateDTO> state,
      ServerWebExchange exchange) {

    var context = AccessContext.builder()
        .cluster(clusterName)
        // consumer group access validation is within the service
        .operationName("getConsumerGroupsPage")
        .build();

    return validateAccess(context).then(
        consumerGroupService.getConsumerGroups(
                getCluster(clusterName),
                OptionalInt.of(
                    Optional.ofNullable(page).filter(i -> i > 0).orElse(1)
                ),
                OptionalInt.of(
                    Optional.ofNullable(perPage).filter(i -> i > 0).orElse(defaultConsumerGroupsPageSize)
                ),
                search,
                fts,
                Optional.ofNullable(orderBy).orElse(ConsumerGroupOrderingDTO.NAME),
                Optional.ofNullable(sortOrderDto).orElse(SortOrderDTO.ASC),
                Optional.ofNullable(state).orElse(List.of())
            )
            .map(this::convertPage)
            .map(ResponseEntity::ok)
    ).doOnEach(sig -> audit(context, sig));
  }


  @Override
  public Mono<ResponseEntity<String>> getConsumerGroupsCsv(String clusterName, Integer page,
                                                           Integer perPage, String search,
                                                           ConsumerGroupOrderingDTO orderBy,
                                                           SortOrderDTO sortOrderDto, Boolean fts,
                                                           List<ConsumerGroupStateDTO> state,
                                                           ServerWebExchange exchange) {

    var context = AccessContext.builder()
        .cluster(clusterName)
        // consumer group access validation is within the service
        .operationName("getConsumerGroupsPage")
        .build();

    return validateAccess(context).then(
        consumerGroupService.getConsumerGroups(
                getCluster(clusterName),
                OptionalInt.empty(),
                OptionalInt.empty(),
                search,
                fts,
                Optional.ofNullable(orderBy).orElse(ConsumerGroupOrderingDTO.NAME),
                Optional.ofNullable(sortOrderDto).orElse(SortOrderDTO.ASC),
                Optional.ofNullable(state).orElse(List.of())
            )
            .map(this::convertPage)
            .map(ResponseEntity::ok)
            .flatMap(r -> responseToCsv(r, (g) -> Flux.fromIterable(g.getConsumerGroups())))
    ).doOnEach(sig -> audit(context, sig));
  }

  @Override
  public Mono<ResponseEntity<Void>> resetConsumerGroupOffsets(
      String clusterName,
      String group,
      Mono<ConsumerGroupOffsetsResetDTO> resetDto,
      ServerWebExchange exchange) {
    return resetDto
        .flatMap(
            reset -> {
              var context =
                  AccessContext.builder()
                      .cluster(clusterName)
                      .topicActions(reset.getTopic(), TopicAction.VIEW)
                      .consumerGroupActions(group, RESET_OFFSETS)
                      .operationName("resetConsumerGroupOffsets")
                      .build();

              Supplier<Mono<Void>> mono =
                  () -> {
                    var cluster = getCluster(clusterName);
                    switch (reset.getResetType()) {
                      case EARLIEST:
                        return offsetsResetService.resetToEarliest(
                            cluster,
                            group,
                            reset.getTopic(),
                            reset.getPartitions(),
                            waitForInactive(reset));
                      case LATEST:
                        return offsetsResetService.resetToLatest(
                            cluster,
                            group,
                            reset.getTopic(),
                            reset.getPartitions(),
                            waitForInactive(reset));
                      case TIMESTAMP:
                        if (reset.getResetToTimestamp() == null) {
                          return Mono.error(
                              new ValidationException(
                                  "resetToTimestamp is required when TIMESTAMP reset type used"));
                        }
                        return offsetsResetService.resetToTimestamp(
                            cluster,
                            group,
                            reset.getTopic(),
                            reset.getPartitions(),
                            reset.getResetToTimestamp(),
                            waitForInactive(reset));
                      case OFFSET:
                        return offsetsResetService.resetToOffsets(
                            cluster,
                            group,
                            reset.getTopic(),
                            resetOffsets(reset),
                            waitForInactive(reset));
                      default:
                        return Mono.error(
                            new ValidationException("Unknown resetType " + reset.getResetType()));
                    }
                  };

              return validateAccess(context)
                  .then(Mono.defer(mono))
                  .doOnEach(sig -> audit(context, sig));
            })
        .thenReturn(ResponseEntity.ok().build());
  }

  @Override
  public Mono<ResponseEntity<ConsumerGroupOffsetsResetPreviewDTO>> previewConsumerGroupOffsetsReset(
      String clusterName,
      String group,
      Mono<ConsumerGroupOffsetsResetDTO> resetDto,
      ServerWebExchange exchange) {
    return resetDto.flatMap(
        reset -> {
          var context =
              AccessContext.builder()
                  .cluster(clusterName)
                  .topicActions(reset.getTopic(), TopicAction.VIEW)
                  .consumerGroupActions(group, RESET_OFFSETS)
                  .operationName("previewConsumerGroupOffsetsReset")
                  .build();

          return validateAccess(context)
              .then(Mono.defer(() -> previewResetOffsets(clusterName, group, reset)))
              .map(preview -> ResponseEntity.ok(toOffsetResetPreview(reset, preview)))
              .doOnEach(sig -> audit(context, sig));
        });
  }

  private Mono<OffsetsResetService.OffsetResetPreview> previewResetOffsets(
      String clusterName, String group, ConsumerGroupOffsetsResetDTO reset) {
    var cluster = getCluster(clusterName);
    switch (reset.getResetType()) {
      case EARLIEST:
        return offsetsResetService.previewToEarliest(
            cluster, group, reset.getTopic(), reset.getPartitions());
      case LATEST:
        return offsetsResetService.previewToLatest(
            cluster, group, reset.getTopic(), reset.getPartitions());
      case TIMESTAMP:
        if (reset.getResetToTimestamp() == null) {
          return Mono.error(
              new ValidationException(
                  "resetToTimestamp is required when TIMESTAMP reset type used"));
        }
        return offsetsResetService.previewToTimestamp(
            cluster, group, reset.getTopic(), reset.getPartitions(), reset.getResetToTimestamp());
      case OFFSET:
        return offsetsResetService.previewToOffsets(
            cluster, group, reset.getTopic(), resetOffsets(reset));
      default:
        return Mono.error(new ValidationException("Unknown resetType " + reset.getResetType()));
    }
  }

  private Map<Integer, Long> resetOffsets(ConsumerGroupOffsetsResetDTO reset) {
    return toResetOffsets(reset.getPartitionsOffsets());
  }

  static Map<Integer, Long> toResetOffsets(List<PartitionOffsetDTO> partitionOffsets) {
    if (CollectionUtils.isEmpty(partitionOffsets)) {
      throw new ValidationException("partitionsOffsets is required when OFFSET reset type used");
    }
    Map<Integer, Long> offsets = new LinkedHashMap<>();
    for (PartitionOffsetDTO partitionOffset : partitionOffsets) {
      if (partitionOffset == null || partitionOffset.getPartition() == null) {
        throw new ValidationException("Each partition offset must include a partition");
      }
      Integer partition = partitionOffset.getPartition();
      if (partition < 0) {
        throw new ValidationException("Partition must be non-negative");
      }
      if (offsets.containsKey(partition)) {
        throw new ValidationException("Duplicate partition offset for partition %s".formatted(partition));
      }
      offsets.put(partition, Optional.ofNullable(partitionOffset.getOffset()).orElse(0L));
    }
    return offsets;
  }

  private boolean waitForInactive(ConsumerGroupOffsetsResetDTO reset) {
    return TRUE.equals(reset.getWaitForInactive());
  }

  private ConsumerGroupOffsetsResetPreviewDTO toOffsetResetPreview(
      ConsumerGroupOffsetsResetDTO reset, OffsetsResetService.OffsetResetPreview preview) {
    return new ConsumerGroupOffsetsResetPreviewDTO()
        .topic(reset.getTopic())
        .resetType(reset.getResetType())
        .partitions(
            preview.partitions().stream().map(this::toOffsetResetPartitionPreview).toList());
  }

  private ConsumerGroupOffsetsResetPartitionPreviewDTO toOffsetResetPartitionPreview(
      OffsetsResetService.OffsetResetPartitionPreview preview) {
    return new ConsumerGroupOffsetsResetPartitionPreviewDTO()
        .partition(preview.partition())
        .currentCommittedOffset(preview.currentCommittedOffset())
        .requestedOffset(preview.requestedOffset())
        .targetOffset(preview.targetOffset())
        .logStartOffset(preview.logStartOffset())
        .logEndOffset(preview.logEndOffset())
        .impact(ConsumerGroupOffsetResetImpactDTO.valueOf(preview.impact().name()))
        .affectedMessages(preview.affectedMessages())
        .targetAdjusted(preview.targetAdjusted());
  }

  private ConsumerGroupsPageResponseDTO convertPage(ConsumerGroupService.ConsumerGroupsPage
                                                        consumerGroupConsumerGroupsPage) {
    return new ConsumerGroupsPageResponseDTO()
        .pageCount(consumerGroupConsumerGroupsPage.totalPages())
        .consumerGroups(consumerGroupConsumerGroupsPage.consumerGroups()
            .stream()
            .map(ConsumerGroupMapper::toDto)
            .toList());
  }

}
