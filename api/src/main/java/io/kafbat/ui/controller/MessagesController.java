package io.kafbat.ui.controller;

import static com.google.common.base.Preconditions.checkNotNull;
import static io.kafbat.ui.model.rbac.permission.TopicAction.MESSAGES_DELETE;
import static io.kafbat.ui.model.rbac.permission.TopicAction.MESSAGES_PRODUCE;
import static io.kafbat.ui.model.rbac.permission.TopicAction.MESSAGES_READ;

import io.kafbat.ui.api.MessagesApi;
import io.kafbat.ui.exception.ValidationException;
import io.kafbat.ui.model.ConsumerPosition;
import io.kafbat.ui.model.CreateTopicMessageDTO;
import io.kafbat.ui.model.MessageFilterIdDTO;
import io.kafbat.ui.model.MessageFilterRegistrationDTO;
import io.kafbat.ui.model.MessageFilterTypeDTO;
import io.kafbat.ui.model.MessageValidationPreviewDTO;
import io.kafbat.ui.model.PollingModeDTO;
import io.kafbat.ui.model.SeekDirectionDTO;
import io.kafbat.ui.model.SeekTypeDTO;
import io.kafbat.ui.model.SerdeUsageDTO;
import io.kafbat.ui.model.SmartFilterTestExecutionDTO;
import io.kafbat.ui.model.SmartFilterTestExecutionResultDTO;
import io.kafbat.ui.model.TopicMessageEventDTO;
import io.kafbat.ui.model.TopicSerdeSuggestionDTO;
import io.kafbat.ui.model.rbac.AccessContext;
import io.kafbat.ui.model.rbac.permission.AuditAction;
import io.kafbat.ui.model.rbac.permission.TopicAction;
import io.kafbat.ui.serde.api.Serde;
import io.kafbat.ui.service.DeserializationService;
import io.kafbat.ui.service.MessagesService;
import io.kafbat.ui.service.MessagesService.DownloadFormat;
import io.kafbat.ui.service.MessagesService.OffsetRange;
import io.kafbat.ui.service.MessagesService.UploadKeyMode;
import io.kafbat.ui.service.MessagesService.UploadMessagesOptions;
import io.kafbat.ui.service.MessagesService.UploadMessagesResult;
import io.kafbat.ui.service.MessagesService.UploadParseMode;
import io.kafbat.ui.service.MessagesService.UploadPartitionStrategy;
import io.kafbat.ui.service.MessagesService.UploadSourceFile;
import io.kafbat.ui.service.mcp.McpTool;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import javax.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.multipart.FilePart;
import org.springframework.http.codec.multipart.FormFieldPart;
import org.springframework.http.codec.multipart.Part;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

@RestController
@RequiredArgsConstructor
@Slf4j
public class MessagesController extends AbstractController implements MessagesApi, McpTool {

  private final MessagesService messagesService;
  private final DeserializationService deserializationService;

  @GetMapping("/api/clusters/{clusterName}/topics/{topicName}/messages/download/settings")
  public Mono<ResponseEntity<MessagesService.DownloadSettings>> downloadSettings(
      @PathVariable String clusterName, @PathVariable String topicName) {
    var context = AccessContext.builder()
        .cluster(clusterName)
        .topicActions(topicName, MESSAGES_READ)
        .operationName("downloadSettings")
        .build();
    return validateAccess(context)
        .then(Mono.fromSupplier(() -> ResponseEntity.ok(messagesService.downloadSettings())))
        .doOnEach(sig -> audit(context, sig));
  }

  private boolean searchOption(ServerWebExchange exchange, String name, String defaultValue, String alternative) {
    String value = Optional.ofNullable(firstQueryParam(exchange, name)).orElse(defaultValue);
    if (!value.equals(defaultValue) && !value.equals(alternative)) {
      throw new ValidationException(name + " must be " + defaultValue + " or " + alternative);
    }
    return value.equals(alternative);
  }

  @Override
  public Mono<ResponseEntity<Void>> deleteTopicMessages(
      String clusterName, String topicName, @Valid List<Integer> partitions,
      ServerWebExchange exchange) {

    var context = AccessContext.builder()
        .cluster(clusterName)
        .topicActions(topicName, MESSAGES_DELETE)
        .build();

    return validateAccess(context).<ResponseEntity<Void>>then(
        messagesService.deleteTopicMessages(
            getCluster(clusterName),
            topicName,
            Optional.ofNullable(partitions).orElse(List.of())
        ).thenReturn(ResponseEntity.ok().build())
    ).doOnEach(sig -> audit(context, sig));
  }

  @Override
  public Mono<ResponseEntity<SmartFilterTestExecutionResultDTO>> executeSmartFilterTest(
      Mono<SmartFilterTestExecutionDTO> smartFilterTestExecutionDto, ServerWebExchange exchange) {
    return smartFilterTestExecutionDto
        .map(MessagesService::execSmartFilterTest)
        .map(ResponseEntity::ok);
  }

  @Override
  public Mono<ResponseEntity<Resource>> downloadMessages(String clusterName,
                                                         String topicName,
                                                         Integer limit,
                                                         List<Integer> partitions,
                                                         List<String> stringFilter,
                                                         String smartFilterId,
                                                         String keySerde,
                                                         String valueSerde,
                                                         String downloadMode,
                                                         Long offset,
                                                         Long timestamp,
                                                         Long timestampTo,
                                                         String format,
                                                         String partitionOffsets,
                                                         String partitionOffsetRanges,
                                                         ServerWebExchange exchange) {
    var context = AccessContext.builder()
        .cluster(clusterName)
        .topicActions(topicName, MESSAGES_READ)
        .operationName("downloadMessages")
        .build();

    return validateAccess(context).then(
        Mono.defer(() -> {
          int downloadLimit = messagesService.resolveDownloadLimit(limit);
          PollingModeDTO pollingMode = resolveDownloadMode(downloadMode, exchange);
          DownloadFormat downloadFormat = DownloadFormat.fromRequest(format);
          Map<Integer, Long> parsedPartitionOffsets = parsePartitionOffsets(partitionOffsets);
          Map<Integer, OffsetRange> parsedPartitionOffsetRanges =
              parsePartitionOffsetRanges(partitionOffsetRanges);
          return messagesService.downloadMessages(
                  getCluster(clusterName),
                  topicName,
                  downloadLimit,
                  Optional.ofNullable(partitions).orElse(List.of()),
                  stringFilter,
                  smartFilterId,
                  keySerde,
                  valueSerde,
                  pollingMode,
                  offset,
                  timestamp,
                  timestampTo,
                  downloadFormat,
                  searchOption(exchange, "searchMatch", "ALL", "ANY"),
                  searchOption(exchange, "searchScope", "ALL", "HEADERS"),
                  parsedPartitionOffsets,
                  parsedPartitionOffsetRanges
              )
              .map(result -> ResponseEntity.ok()
                  .contentType(MediaType.parseMediaType(result.mediaType()))
                  .contentLength(result.content().length)
                  .header(
                      HttpHeaders.CONTENT_DISPOSITION,
                      ContentDisposition.attachment()
                          .filename(result.fileName(), StandardCharsets.UTF_8)
                          .build()
                          .toString()
                  )
                  .body((Resource) new ByteArrayResource(result.content())));
        })
    ).doOnEach(sig -> audit(context, sig));
  }

  @PostMapping(
      value = "/api/clusters/{clusterName}/topics/{topicName}/messages/upload",
      consumes = MediaType.MULTIPART_FORM_DATA_VALUE
  )
  public Mono<ResponseEntity<UploadMessagesResult>> uploadMessages(
      @PathVariable String clusterName,
      @PathVariable String topicName,
      ServerWebExchange exchange) {
    var context = AccessContext.builder()
        .cluster(clusterName)
        .topicActions(topicName, MESSAGES_PRODUCE)
        .operationName("uploadMessages")
        .build();

    return validateAccess(context).then(
      exchange.getMultipartData()
        .flatMap(parts -> Flux.fromIterable(uploadFileParts(parts))
          .flatMap(this::toUploadedSourceFile)
          .collectList()
          .flatMap(uploadFiles -> messagesService.uploadMessages(
            getCluster(clusterName),
            topicName,
            uploadFiles,
            uploadOptions(parts)
          ))
        )
        .map(ResponseEntity::ok)
    ).doOnEach(sig -> audit(context, sig));
  }

  @Deprecated(forRemoval = true, since = "1.1.0")
  @Override
  public Mono<ResponseEntity<Flux<TopicMessageEventDTO>>> getTopicMessages(String clusterName,
                                                                           String topicName,
                                                                           SeekTypeDTO seekType,
                                                                           List<String> seekTo,
                                                                           Integer limit,
                                                                           String q,
                                                                           MessageFilterTypeDTO filterQueryType,
                                                                           SeekDirectionDTO seekDirection,
                                                                           String keySerde,
                                                                           String valueSerde,
                                                                           ServerWebExchange exchange) {
    throw new ValidationException("Not supported");
  }


  @Override
  public Mono<ResponseEntity<Flux<TopicMessageEventDTO>>> getTopicMessagesV2(String clusterName, String topicName,
                                                                             PollingModeDTO mode,
                                                                             List<Integer> partitions,
                                                                             Integer limit,
                                                                             List<String> stringFilter,
                                                                             String smartFilterId,
                                                                             Long offset,
                                                                             Long timestamp,
                                                                             Long timestampTo,
                                                                             String keySerde,
                                                                             String valueSerde,
                                                                             String cursor,
                                                                             ServerWebExchange exchange) {
    var contextBuilder = AccessContext.builder()
        .cluster(clusterName)
        .operationName("getTopicMessages");

    if (auditService.isAuditTopic(getCluster(clusterName), topicName)) {
      contextBuilder.auditActions(AuditAction.VIEW);
    } else {
      contextBuilder.topicActions(topicName, MESSAGES_READ);
    }

    var accessContext = contextBuilder.build();

    Flux<TopicMessageEventDTO> messagesFlux;
    String orderBy = firstQueryParam(exchange, "orderBy");
    if (orderBy != null) {
      var cluster = getCluster(clusterName);
      boolean matchAny = searchOption(exchange, "searchMatch", "ALL", "ANY");
      boolean headersOnly = searchOption(exchange, "searchScope", "ALL", "HEADERS");
      String sortOrder = Optional.ofNullable(firstQueryParam(exchange, "sortOrder")).orElse("ASC");
      if (cursor != null) {
        messagesFlux = messagesService.loadSortedTopicMessagePage(
            cluster, topicName, cursor, limit, stringFilter, smartFilterId, keySerde, valueSerde,
            matchAny, headersOnly, orderBy, sortOrder);
      } else {
        messagesFlux = messagesService.loadSortedTopicMessages(
            cluster, topicName, stringFilter, smartFilterId, limit, keySerde, valueSerde,
            matchAny, headersOnly, orderBy, sortOrder);
      }
    } else if (cursor != null) {
      messagesFlux = messagesService.loadMessages(getCluster(clusterName), topicName, cursor);
    } else {
      var pollingMode = mode == null ? PollingModeDTO.LATEST : mode;
      messagesFlux = messagesService.loadMessages(
          getCluster(clusterName),
          topicName,
          ConsumerPosition.create(pollingMode, checkNotNull(topicName), partitions, timestamp, offset),
          stringFilter,
          smartFilterId,
          limit,
          keySerde,
          valueSerde,
          searchOption(exchange, "searchMatch", "ALL", "ANY"),
          searchOption(exchange, "searchScope", "ALL", "HEADERS"),
          timestampTo
      );
    }
    if (orderBy == null) {
      messagesFlux = messagesService.filterMessagesByTimestampUpperBound(messagesFlux, timestampTo);
    }
    return accessControlService.validateAccess(accessContext)
        .then(Mono.just(ResponseEntity.ok(messagesFlux)))
        .doOnEach(sig -> auditService.audit(accessContext, sig));
  }

  @Override
  public Mono<ResponseEntity<Void>> sendTopicMessages(
      String clusterName, String topicName, @Valid Mono<CreateTopicMessageDTO> createTopicMessage,
      ServerWebExchange exchange) {

    var context = AccessContext.builder()
        .cluster(clusterName)
        .topicActions(topicName, MESSAGES_PRODUCE)
        .operationName("sendTopicMessages")
        .build();

    return validateAccess(context).then(
        createTopicMessage.flatMap(msg ->
            messagesService.sendMessage(getCluster(clusterName), topicName, msg)
        ).map(m -> new ResponseEntity<Void>(HttpStatus.OK))
    ).doOnEach(sig -> audit(context, sig));
  }

  @Override
  public Mono<ResponseEntity<MessageValidationPreviewDTO>> previewTopicMessage(
      String clusterName, String topicName, @Valid Mono<CreateTopicMessageDTO> createTopicMessage,
      ServerWebExchange exchange) {

    var context = AccessContext.builder()
        .cluster(clusterName)
        .topicActions(topicName, MESSAGES_PRODUCE)
        .operationName("previewTopicMessage")
        .build();

    return validateAccess(context).then(
        createTopicMessage
            .flatMap(message -> messagesService.previewMessage(getCluster(clusterName), topicName, message))
            .map(ResponseEntity::ok)
    ).doOnEach(sig -> audit(context, sig));
  }

  @Override
  public Mono<ResponseEntity<TopicSerdeSuggestionDTO>> getSerdes(String clusterName,
                                                                 String topicName,
                                                                 SerdeUsageDTO use,
                                                                 ServerWebExchange exchange) {
    var context = AccessContext.builder()
        .cluster(clusterName)
        .topicActions(topicName, TopicAction.VIEW)
        .operationName("getSerdes")
        .build();

    TopicSerdeSuggestionDTO dto = new TopicSerdeSuggestionDTO()
        .key(use == SerdeUsageDTO.SERIALIZE
            ? deserializationService.getSerdesForSerialize(getCluster(clusterName), topicName, Serde.Target.KEY)
            : deserializationService.getSerdesForDeserialize(getCluster(clusterName), topicName, Serde.Target.KEY))
        .value(use == SerdeUsageDTO.SERIALIZE
            ? deserializationService.getSerdesForSerialize(getCluster(clusterName), topicName, Serde.Target.VALUE)
            : deserializationService.getSerdesForDeserialize(getCluster(clusterName), topicName, Serde.Target.VALUE));

    return validateAccess(context).then(
        Mono.just(dto)
            .subscribeOn(Schedulers.boundedElastic())
            .map(ResponseEntity::ok)
    );
  }

  @Override
  public Mono<ResponseEntity<MessageFilterIdDTO>> registerFilter(String clusterName,
                                                                 String topicName,
                                                                 Mono<MessageFilterRegistrationDTO> registration,
                                                                 ServerWebExchange exchange) {


    final Mono<Void> validateAccess = accessControlService.validateAccess(AccessContext.builder()
        .cluster(clusterName)
        .topicActions(topicName, MESSAGES_READ)
        .build());
    return validateAccess.then(registration)
        .map(reg -> messagesService.registerMessageFilter(reg.getFilterCode()))
        .map(id -> ResponseEntity.ok(new MessageFilterIdDTO().id(id)));
  }

  private Mono<UploadSourceFile> toUploadedSourceFile(FilePart filePart) {
    return filePart.content()
        .reduce(new ByteArrayOutputStream(), (outputStream, dataBuffer) -> {
          byte[] bytes = new byte[dataBuffer.readableByteCount()];
          dataBuffer.read(bytes);
          DataBufferUtils.release(dataBuffer);
          outputStream.writeBytes(bytes);
          return outputStream;
        })
        .map(outputStream -> new UploadSourceFile(filePart.filename(), outputStream.toByteArray()));
  }

  private List<FilePart> uploadFileParts(MultiValueMap<String, Part> parts) {
    List<FilePart> files = Optional.ofNullable(parts.get("files"))
        .orElse(List.of())
        .stream()
        .filter(FilePart.class::isInstance)
        .map(FilePart.class::cast)
        .toList();
    if (files.isEmpty()) {
      throw new ValidationException("At least one upload file is required");
    }
    return files;
  }

  private UploadMessagesOptions uploadOptions(MultiValueMap<String, Part> parts) {
    return new UploadMessagesOptions(
        UploadParseMode.fromRequest(partValue(parts, "parseMode")),
        UploadPartitionStrategy.fromRequest(partValue(parts, "partitionStrategy")),
        UploadKeyMode.fromRequest(partValue(parts, "keyMode")),
        partInteger(parts, "partition"),
        partIntegers(parts, "partitions"),
        partValue(parts, "keySerde"),
        partValue(parts, "valueSerde"),
        partValue(parts, "headersJson"),
        partBoolean(parts, "includeMetadataHeaders", true),
        partBoolean(parts, "dryRun", false),
        partInteger(parts, "messageLimit")
    );
  }

  private List<Integer> partIntegers(MultiValueMap<String, Part> parts, String name) {
    return Optional.ofNullable(parts.get(name))
        .orElse(List.of())
        .stream()
        .map(this::formFieldValue)
        .filter(value -> value != null && !value.isBlank())
        .map(Integer::valueOf)
        .toList();
  }

  private Integer partInteger(MultiValueMap<String, Part> parts, String name) {
    String value = partValue(parts, name);
    return value == null || value.isBlank() ? null : Integer.valueOf(value);
  }

  private boolean partBoolean(MultiValueMap<String, Part> parts, String name, boolean defaultValue) {
    String value = partValue(parts, name);
    return value == null || value.isBlank() ? defaultValue : Boolean.parseBoolean(value);
  }

  private String partValue(MultiValueMap<String, Part> parts, String name) {
    return formFieldValue(parts.getFirst(name));
  }

  private String formFieldValue(Part part) {
    return part instanceof FormFieldPart formFieldPart ? formFieldPart.value() : null;
  }

  private PollingModeDTO resolveDownloadMode(String downloadMode, ServerWebExchange exchange) {
    String value = Optional.ofNullable(downloadMode)
        .orElseGet(() -> firstQueryParam(exchange, "mode"));
    if (value == null || value.isBlank()) {
      return PollingModeDTO.LATEST;
    }
    try {
      return PollingModeDTO.valueOf(value.toUpperCase(Locale.ROOT));
    } catch (IllegalArgumentException e) {
      throw new ValidationException("Unsupported download mode: " + value);
    }
  }

  private Map<Integer, Long> parsePartitionOffsets(String value) {
    if (value == null || value.isBlank()) {
      return Map.of();
    }

    Map<Integer, Long> offsets = new LinkedHashMap<>();
    for (String rawItem : value.split(",")) {
      String item = rawItem.trim();
      if (item.isEmpty()) {
        continue;
      }
      String[] parts = item.split(":", -1);
      if (parts.length != 2) {
        throw new ValidationException("partitionOffsets must use p0:123,p1:456 format");
      }
      int partition = parsePartition(parts[0], "partitionOffsets");
      long offset = parseNonNegativeLong(parts[1], "partitionOffsets");
      if (offsets.putIfAbsent(partition, offset) != null) {
        throw new ValidationException("Duplicate partition in partitionOffsets: " + partition);
      }
    }
    return offsets;
  }

  private Map<Integer, OffsetRange> parsePartitionOffsetRanges(String value) {
    if (value == null || value.isBlank()) {
      return Map.of();
    }

    Map<Integer, OffsetRange> ranges = new LinkedHashMap<>();
    for (String rawItem : value.split(",")) {
      String item = rawItem.trim();
      if (item.isEmpty()) {
        continue;
      }
      String[] parts = item.split(":", -1);
      if (parts.length != 2) {
        throw new ValidationException("partitionOffsetRanges must use p0:100-200,p1:500-600 format");
      }
      String[] rangeParts = parts[1].split("-", -1);
      if (rangeParts.length != 2) {
        throw new ValidationException("partitionOffsetRanges must use p0:100-200,p1:500-600 format");
      }
      int partition = parsePartition(parts[0], "partitionOffsetRanges");
      long startOffset = parseNonNegativeLong(rangeParts[0], "partitionOffsetRanges");
      long endOffset = parseNonNegativeLong(rangeParts[1], "partitionOffsetRanges");
      if (endOffset < startOffset) {
        throw new ValidationException("Range end offset must be greater than or equal to start offset");
      }
      if (ranges.putIfAbsent(partition, new OffsetRange(startOffset, endOffset)) != null) {
        throw new ValidationException("Duplicate partition in partitionOffsetRanges: " + partition);
      }
    }
    return ranges;
  }

  private int parsePartition(String value, String queryParam) {
    String normalized = value.trim();
    if (normalized.toLowerCase(Locale.ROOT).startsWith("p")) {
      normalized = normalized.substring(1);
    }
    try {
      int partition = Integer.parseInt(normalized);
      if (partition < 0) {
        throw new NumberFormatException("negative partition");
      }
      return partition;
    } catch (NumberFormatException e) {
      throw new ValidationException("Query parameter '" + queryParam + "' contains an invalid partition");
    }
  }

  private long parseNonNegativeLong(String value, String queryParam) {
    try {
      long parsed = Long.parseLong(value.trim());
      if (parsed < 0) {
        throw new NumberFormatException("negative offset");
      }
      return parsed;
    } catch (NumberFormatException e) {
      throw new ValidationException("Query parameter '" + queryParam + "' contains an invalid offset");
    }
  }

  private String firstQueryParam(ServerWebExchange exchange, String name) {
    MultiValueMap<String, String> queryParams = exchange.getRequest().getQueryParams();
    return queryParams.getFirst(name);
  }
}
