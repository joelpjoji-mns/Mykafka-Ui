package io.kafbat.ui.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.common.base.Charsets;
import com.google.common.cache.Cache;
import com.google.common.cache.CacheBuilder;
import com.google.common.hash.Hashing;
import io.kafbat.ui.config.ClustersProperties;
import io.kafbat.ui.emitter.BackwardEmitter;
import io.kafbat.ui.emitter.Cursor;
import io.kafbat.ui.emitter.ForwardEmitter;
import io.kafbat.ui.emitter.FullScanEmitter;
import io.kafbat.ui.emitter.MessageFilters;
import io.kafbat.ui.emitter.TailingEmitter;
import io.kafbat.ui.exception.TopicNotFoundException;
import io.kafbat.ui.exception.ValidationException;
import io.kafbat.ui.model.ConsumerPosition;
import io.kafbat.ui.model.CreateTopicMessageDTO;
import io.kafbat.ui.model.KafkaCluster;
import io.kafbat.ui.model.MessageFieldValidationDTO;
import io.kafbat.ui.model.MessageSchemaEvidenceDTO;
import io.kafbat.ui.model.MessageValidationPreviewDTO;
import io.kafbat.ui.model.MessageValidationStatusDTO;
import io.kafbat.ui.model.PollingModeDTO;
import io.kafbat.ui.model.SmartFilterTestExecutionDTO;
import io.kafbat.ui.model.SmartFilterTestExecutionResultDTO;
import io.kafbat.ui.model.TopicMessageDTO;
import io.kafbat.ui.model.TopicMessageEventDTO;
import io.kafbat.ui.model.TopicMessageNextPageCursorDTO;
import io.kafbat.ui.model.TopicMessagePhaseDTO;
import io.kafbat.ui.serde.api.SchemaDescription;
import io.kafbat.ui.serde.api.Serde;
import io.kafbat.ui.serdes.ConsumerRecordDeserializer;
import io.kafbat.ui.serdes.ProducerRecordCreator;
import io.kafbat.ui.serdes.builtin.sr.SchemaRegistrySerde;
import io.kafbat.ui.util.KafkaClientSslPropertiesUtil;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.PriorityQueue;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Predicate;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import javax.annotation.Nullable;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.admin.OffsetSpec;
import org.apache.kafka.clients.admin.TopicDescription;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.clients.producer.RecordMetadata;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.serialization.ByteArraySerializer;
import org.openapitools.jackson.nullable.JsonNullable;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

@Service
@Slf4j
public class MessagesService {

  private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

  private static final long SALT_FOR_HASHING = ThreadLocalRandom.current().nextLong();

  private static final int DEFAULT_MAX_PAGE_SIZE = 5_000;
  private static final int DEFAULT_PAGE_SIZE = 1_000;
  private static final int DEFAULT_UPLOAD_MESSAGE_LIMIT = 1_000;
  private static final int MAX_UPLOAD_MESSAGE_LIMIT = 10_000;
  private static final int MAX_PRODUCER_REQUEST_BYTES = 16 * 1024 * 1024;
  private static final long MAX_PRODUCER_BUFFER_BYTES = 64L * 1024 * 1024;
  private static final int SORTED_SCAN_FIRST_PREVIEW_SIZE = 1_000;
  private static final int SORTED_SCAN_PREVIEW_INTERVAL = 50_000;
  private static final long SORTED_SCAN_RAW_PREVIEW_INTERVAL = 50_000;
  private static final long SORTED_SCAN_NARROW_FILTER_PREVIEW_INTERVAL = 10_000;
  private static final int SORTED_SCAN_PREVIEW_LIMIT = 1_000;
  private static final long SORTED_SCAN_PREVIEW_BYTES = 8L * 1024 * 1024;
  private static final String SORTED_SCAN_PREVIEW_PHASE = "Provisional sort results";
  private static final String SORTED_SCAN_PREVIEW_COMPLETE_PHASE = "Provisional sort results complete";
  private static final String SORTED_SCAN_FINAL_PHASE = "Final sort results";
  private static final String SORTED_SCAN_FINAL_COMPLETE_PHASE = "Final sort results complete";
  private static final String SORTED_PAGE_RESULTS_PHASE = "Sorted page results";
  private static final String SORTED_PAGE_COMPLETE_PHASE = "Sorted page results complete";

  private static final String INVALID_ZIP_ENTRY_CHARS = "[\\\\/:*?\"<>|\\p{Cntrl}]";

  private final AdminClientService adminClientService;
  private final DeserializationService deserializationService;
  private final ConsumerGroupService consumerGroupService;
  private final int maxPageSize;
  private final int defaultPageSize;
  private final int defaultDownloadLimit;

  private final Cache<String, Predicate<TopicMessageDTO>> registeredFilters =
      CacheBuilder.newBuilder().maximumSize(PollingCursorsStorage.MAX_SIZE).build();

  private final PollingCursorsStorage cursorsStorage = new PollingCursorsStorage();
  private final SortedTopicMessagePages sortedTopicMessagePages = new SortedTopicMessagePages();

  public MessagesService(
      AdminClientService adminClientService,
      DeserializationService deserializationService,
      ConsumerGroupService consumerGroupService,
      ClustersProperties properties) {
    this.adminClientService = adminClientService;
    this.deserializationService = deserializationService;
    this.consumerGroupService = consumerGroupService;

    var pollingProps =
        Optional.ofNullable(properties.getPolling())
            .orElseGet(ClustersProperties.PollingProperties::new);
    this.maxPageSize =
        Optional.ofNullable(pollingProps.getMaxPageSize()).orElse(DEFAULT_MAX_PAGE_SIZE);
    this.defaultPageSize =
        Optional.ofNullable(pollingProps.getDefaultPageSize()).orElse(DEFAULT_PAGE_SIZE);
    this.defaultDownloadLimit = Math.min(
        Optional.ofNullable(pollingProps.getDefaultDownloadLimit()).orElse(5_000), maxPageSize);
    if (maxPageSize < 1 || defaultPageSize < 1 || defaultDownloadLimit < 1) {
      throw new IllegalArgumentException("Kafka polling page sizes and download limit must be positive");
    }
  }

  public enum DownloadFormat {
    TEXT,
    JSON,
    VALUE_ONLY,
    CSV,
    NDJSON;

    public static DownloadFormat fromRequest(@Nullable String value) {
      if (value == null || value.isBlank()) {
        return TEXT;
      }
      try {
        return DownloadFormat.valueOf(value.toUpperCase(Locale.ROOT));
      } catch (IllegalArgumentException e) {
        throw new ValidationException("Unsupported download format: " + value);
      }
    }

    public boolean isSingleFile() {
      return this == CSV || this == NDJSON;
    }
  }

  public record DownloadResult(byte[] content, String mediaType, String fileName) {}

  public enum UploadParseMode {
    FILE_PER_MESSAGE,
    TEXT_LINES,
    NDJSON,
    JSON_ARRAY;

    public static UploadParseMode fromRequest(@Nullable String value) {
      if (value == null || value.isBlank()) {
        return FILE_PER_MESSAGE;
      }
      try {
        return UploadParseMode.valueOf(value.toUpperCase(Locale.ROOT));
      } catch (IllegalArgumentException e) {
        throw new ValidationException("Unsupported upload parse mode: " + value);
      }
    }
  }

  public enum UploadPartitionStrategy {
    ANY,
    SELECTED,
    RANDOM,
    EVEN;

    public static UploadPartitionStrategy fromRequest(@Nullable String value) {
      if (value == null || value.isBlank()) {
        return ANY;
      }
      try {
        return UploadPartitionStrategy.valueOf(value.toUpperCase(Locale.ROOT));
      } catch (IllegalArgumentException e) {
        throw new ValidationException("Unsupported upload partition strategy: " + value);
      }
    }
  }

  public enum UploadKeyMode {
    NONE,
    FILE_NAME,
    ENTRY_NAME;

    public static UploadKeyMode fromRequest(@Nullable String value) {
      if (value == null || value.isBlank()) {
        return NONE;
      }
      try {
        return UploadKeyMode.valueOf(value.toUpperCase(Locale.ROOT));
      } catch (IllegalArgumentException e) {
        throw new ValidationException("Unsupported upload key mode: " + value);
      }
    }
  }

  public record UploadSourceFile(String fileName, byte[] content) {}

  public record UploadMessagesOptions(
      UploadParseMode parseMode,
      UploadPartitionStrategy partitionStrategy,
      UploadKeyMode keyMode,
      @Nullable Integer selectedPartition,
      List<Integer> targetPartitions,
      @Nullable String keySerde,
      @Nullable String valueSerde,
      @Nullable String headersJson,
      boolean includeMetadataHeaders,
      boolean dryRun,
      @Nullable Integer messageLimit) {}

  public record UploadMessagesFileResult(
      String fileName, int extractedEntries, int parsedMessages) {}

  public record UploadMessagePreview(
      String sourceFile,
      String entryName,
      @Nullable Integer partition,
      @Nullable String key,
      int valueBytes,
      String valuePreview) {}

  public record UploadMessagesResult(
      boolean dryRun,
      int filesReceived,
      int entriesRead,
      int messagesParsed,
      int messagesProduced,
      int failures,
      List<UploadMessagesFileResult> files,
      List<UploadMessagePreview> previews,
      List<String> errors) {}

  private record UploadCandidate(
      String sourceFile, String entryName, @Nullable String key, String value, int sourceIndex) {}

  private Mono<TopicDescription> withExistingTopic(KafkaCluster cluster, String topicName) {
    return adminClientService
        .get(cluster)
        .flatMap(client -> client.describeTopic(topicName))
        .switchIfEmpty(Mono.error(new TopicNotFoundException()));
  }

  public static SmartFilterTestExecutionResultDTO execSmartFilterTest(
      SmartFilterTestExecutionDTO execData) {
    Predicate<TopicMessageDTO> predicate;
    try {
      predicate = MessageFilters.celScriptFilter(execData.getFilterCode());
    } catch (Exception e) {
      log.info("Smart filter '{}' compilation error", execData.getFilterCode(), e);
      return new SmartFilterTestExecutionResultDTO().error("Compilation error : " + e.getMessage());
    }
    try {
      var result =
          predicate.test(
              new TopicMessageDTO()
                  .key(execData.getKey())
                  .value(execData.getValue())
                  .headers(execData.getHeaders())
                  .offset(execData.getOffset())
                  .partition(execData.getPartition())
                  .timestamp(
                      Optional.ofNullable(execData.getTimestampMs())
                          .map(
                              ts ->
                                  OffsetDateTime.ofInstant(
                                      Instant.ofEpochMilli(ts), ZoneOffset.UTC))
                          .orElse(null)));
      return new SmartFilterTestExecutionResultDTO().result(result);
    } catch (Exception e) {
      log.info("Smart filter {} execution error", execData, e);
      return new SmartFilterTestExecutionResultDTO().error("Execution error : " + e.getMessage());
    }
  }

  public Mono<Void> deleteTopicMessages(
      KafkaCluster cluster, String topicName, List<Integer> partitionsToInclude) {
    return withExistingTopic(cluster, topicName)
        .flatMap(
            td ->
                offsetsForDeletion(cluster, topicName, partitionsToInclude)
                    .flatMap(
                        offsets ->
                            adminClientService
                                .get(cluster)
                                .flatMap(ac -> ac.deleteRecords(offsets))));
  }

  private Mono<Map<TopicPartition, Long>> offsetsForDeletion(
      KafkaCluster cluster, String topicName, List<Integer> partitionsToInclude) {
    return adminClientService
        .get(cluster)
        .flatMap(
            ac ->
                ac.listTopicOffsets(topicName, OffsetSpec.earliest(), true)
                    .zipWith(
                        ac.listTopicOffsets(topicName, OffsetSpec.latest(), true),
                        (start, end) ->
                            end.entrySet().stream()
                                .filter(
                                    e ->
                                        partitionsToInclude.isEmpty()
                                            || partitionsToInclude.contains(e.getKey().partition()))
                                // we only need non-empty partitions (where start offset != end
                                // offset)
                                .filter(
                                    entry -> !entry.getValue().equals(start.get(entry.getKey())))
                                .collect(
                                    Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue))));
  }

  public Mono<RecordMetadata> sendMessage(
      KafkaCluster cluster, String topic, CreateTopicMessageDTO msg) {
    return withExistingTopic(cluster, topic)
        .publishOn(Schedulers.boundedElastic())
        .flatMap(desc -> sendMessageImpl(cluster, desc, msg));
  }

  public Mono<MessageValidationPreviewDTO> previewMessage(
      KafkaCluster cluster, String topic, CreateTopicMessageDTO msg) {
    return withExistingTopic(cluster, topic)
        .publishOn(Schedulers.boundedElastic())
        .map(desc -> previewMessageImpl(cluster, desc, msg));
  }

  private MessageValidationPreviewDTO previewMessageImpl(
      KafkaCluster cluster, TopicDescription topicDescription, CreateTopicMessageDTO msg) {
    String keySerdeName = serdeName(msg.getKeySerde());
    String valueSerdeName = serdeName(msg.getValueSerde());

    if (msg.getPartition() != null
        && msg.getPartition() > topicDescription.partitions().size() - 1) {
      return invalidPreview(keySerdeName, valueSerdeName, "Invalid partition");
    }

    if (keySerdeName == null || valueSerdeName == null) {
      String error = "Select both key and value serdes before validating the message";
      return new MessageValidationPreviewDTO()
          .canSerialize(false)
          .errors(List.of(error))
          .key(
              keySerdeName == null
                  ? invalidField(null, "Select a key serde before validating the message")
                  : skippedField(keySerdeName))
          .value(
              valueSerdeName == null
                  ? invalidField(null, "Select a value serde before validating the message")
                  : skippedField(valueSerdeName));
    }

    try {
      ProducerRecordCreator producerRecordCreator =
          deserializationService.producerRecordCreator(
              cluster,
              topicDescription.name(),
              keySerdeName,
              valueSerdeName,
              msg.getKeySerdeProperties(),
              msg.getValueSerdeProperties());
      ProducerRecord<byte[], byte[]> record =
          producerRecordCreator.create(
              topicDescription.name(),
              msg.getPartition(),
              msg.getKey().orElse(null),
              msg.getValue().orElse(null),
              msg.getHeaders());
      SchemaDescription keySchema =
          deserializationService.getSchemaForSerialize(
              cluster, topicDescription.name(), Serde.Target.KEY, keySerdeName);
      SchemaDescription valueSchema =
          deserializationService.getSchemaForSerialize(
              cluster, topicDescription.name(), Serde.Target.VALUE, valueSerdeName);

      return new MessageValidationPreviewDTO()
          .canSerialize(true)
          .errors(List.of())
          .key(
              validatedField(
                  keySerdeName,
                  msg.getKey().orElse(null),
                  record.key(),
                  keySchema,
                  msg.getKeySerdeProperties()))
          .value(
              validatedField(
                  valueSerdeName,
                  msg.getValue().orElse(null),
                  record.value(),
                  valueSchema,
                  msg.getValueSerdeProperties()));
    } catch (Exception e) {
      return invalidPreview(keySerdeName, valueSerdeName, previewError(e));
    }
  }

  private MessageValidationPreviewDTO invalidPreview(
      @Nullable String keySerdeName, @Nullable String valueSerdeName, String error) {
    return new MessageValidationPreviewDTO()
        .canSerialize(false)
        .errors(List.of(error))
        .key(invalidField(keySerdeName, error))
        .value(invalidField(valueSerdeName, error));
  }

  private MessageFieldValidationDTO validatedField(
      String serdeName,
      @Nullable String value,
      @Nullable byte[] serializedValue,
      @Nullable SchemaDescription schema,
      @Nullable Map<String, Object> serdeProperties) {
    if (value == null) {
      return skippedField(serdeName);
    }

    String explicitSubject = explicitSchemaSubject(serdeProperties);
    MessageSchemaEvidenceDTO schemaEvidence = schemaEvidence(schema, explicitSubject);
    boolean hasSchemaEvidence =
        schemaEvidence != null
            || (SchemaRegistrySerde.NAME.equals(serdeName) && explicitSubject != null);

    MessageFieldValidationDTO result =
        new MessageFieldValidationDTO()
            .serde(serdeName)
            .status(
                hasSchemaEvidence
                    ? MessageValidationStatusDTO.VALIDATED
                    : MessageValidationStatusDTO.SERIALIZED)
            .errors(List.of());
    if (serializedValue != null) {
      result.serializedBytes((long) serializedValue.length);
    }
    if (schemaEvidence != null) {
      result.schema(schemaEvidence);
    }
    return result;
  }

  private MessageFieldValidationDTO skippedField(@Nullable String serdeName) {
    return new MessageFieldValidationDTO()
        .serde(serdeName)
        .status(MessageValidationStatusDTO.SKIPPED)
        .errors(List.of());
  }

  private MessageFieldValidationDTO invalidField(@Nullable String serdeName, String error) {
    return new MessageFieldValidationDTO()
        .serde(serdeName)
        .status(MessageValidationStatusDTO.INVALID)
        .errors(List.of(error));
  }

  @Nullable
  private static String serdeName(@Nullable JsonNullable<String> serde) {
    if (serde == null || !serde.isPresent()) {
      return null;
    }
    String name = serde.get();
    return name == null || name.isBlank() ? null : name;
  }

  @Nullable
  private static String explicitSchemaSubject(@Nullable Map<String, Object> serdeProperties) {
    if (serdeProperties == null) {
      return null;
    }
    Object subject = serdeProperties.get(SchemaRegistrySerde.SUBJECT_PARAMETER_NAME);
    return subject instanceof String name && !name.isBlank() ? name : null;
  }

  @Nullable
  private static MessageSchemaEvidenceDTO schemaEvidence(
      @Nullable SchemaDescription schema, @Nullable String explicitSubject) {
    if (explicitSubject != null) {
      return new MessageSchemaEvidenceDTO().subject(explicitSubject);
    }
    if (schema == null) {
      return null;
    }

    Map<String, Object> properties = schema.getAdditionalProperties();
    return new MessageSchemaEvidenceDTO()
        .subject(stringProperty(properties, "subject"))
        .id(integerProperty(properties, "schemaId"))
        .version(stringProperty(properties, "latestVersion"))
        .type(stringProperty(properties, "type"));
  }

  @Nullable
  private static String stringProperty(Map<String, Object> properties, String name) {
    Object value = properties.get(name);
    return value == null ? null : value.toString();
  }

  @Nullable
  private static Integer integerProperty(Map<String, Object> properties, String name) {
    Object value = properties.get(name);
    return value instanceof Number number ? number.intValue() : null;
  }

  private static String previewError(Exception error) {
    String message = error.getMessage();
    return message == null || message.isBlank()
        ? "The selected serdes could not serialize this message"
        : message;
  }

  private Mono<RecordMetadata> sendMessageImpl(
      KafkaCluster cluster, TopicDescription topicDescription, CreateTopicMessageDTO msg) {
    if (msg.getPartition() != null
        && msg.getPartition() > topicDescription.partitions().size() - 1) {
      return Mono.error(new ValidationException("Invalid partition"));
    }
    ProducerRecordCreator producerRecordCreator =
        deserializationService.producerRecordCreator(
            cluster,
            topicDescription.name(),
            msg.getKeySerde().get(),
            msg.getValueSerde().get(),
            msg.getKeySerdeProperties(),
            msg.getValueSerdeProperties());

    try (KafkaProducer<byte[], byte[]> producer = createProducer(cluster, Map.of())) {
      ProducerRecord<byte[], byte[]> producerRecord =
          producerRecordCreator.create(
              topicDescription.name(),
              msg.getPartition(),
              msg.getKey().orElse(null),
              msg.getValue().orElse(null),
              msg.getHeaders());
      CompletableFuture<RecordMetadata> cf = new CompletableFuture<>();
      producer.send(
          producerRecord,
          (metadata, exception) -> {
            if (exception != null) {
              cf.completeExceptionally(exception);
            } else {
              cf.complete(metadata);
            }
          });
      return Mono.fromFuture(cf);
    } catch (Throwable e) {
      return Mono.error(e);
    }
  }

  public static KafkaProducer<byte[], byte[]> createProducer(
      KafkaCluster cluster, Map<String, Object> additionalProps) {
    return createProducer(cluster.getOriginalProperties(), additionalProps);
  }

  public static KafkaProducer<byte[], byte[]> createProducer(
      ClustersProperties.Cluster cluster, Map<String, Object> additionalProps) {
    Properties properties = new Properties();
    KafkaClientSslPropertiesUtil.addKafkaSslProperties(cluster.getSsl(), properties);
    properties.putAll(cluster.getProperties());
    properties.putAll(cluster.getProducerProperties());
    properties.putIfAbsent(ProducerConfig.MAX_REQUEST_SIZE_CONFIG, MAX_PRODUCER_REQUEST_BYTES);
    properties.putIfAbsent(ProducerConfig.BUFFER_MEMORY_CONFIG, MAX_PRODUCER_BUFFER_BYTES);
    properties.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, cluster.getBootstrapServers());
    properties.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
    properties.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
    properties.putAll(additionalProps);
    return new KafkaProducer<>(properties);
  }

  public Flux<TopicMessageEventDTO> loadMessages(
      KafkaCluster cluster,
      String topic,
      ConsumerPosition consumerPosition,
      @Nullable List<String> containsStringFilters,
      @Nullable String filterId,
      @Nullable Integer limit,
      @Nullable String keySerde,
      @Nullable String valueSerde) {
    return loadMessages(cluster, topic, consumerPosition, containsStringFilters, filterId,
        limit, keySerde, valueSerde, false, false);
  }

  public Flux<TopicMessageEventDTO> loadMessages(
      KafkaCluster cluster, String topic, ConsumerPosition consumerPosition,
      @Nullable List<String> containsStringFilters, @Nullable String filterId,
      @Nullable Integer limit, @Nullable String keySerde, @Nullable String valueSerde,
      boolean matchAny, boolean headersOnly) {
    return loadMessages(cluster, topic, consumerPosition, containsStringFilters, filterId,
        limit, keySerde, valueSerde, matchAny, headersOnly, null);
  }

  public Flux<TopicMessageEventDTO> loadMessages(
      KafkaCluster cluster, String topic, ConsumerPosition consumerPosition,
      @Nullable List<String> containsStringFilters, @Nullable String filterId,
      @Nullable Integer limit, @Nullable String keySerde, @Nullable String valueSerde,
      boolean matchAny, boolean headersOnly, @Nullable Long timestampTo) {
    Predicate<TopicMessageDTO> filter = getMsgFilter(containsStringFilters, filterId, matchAny, headersOnly);
    if (timestampTo != null) {
      filter = filter.and(message -> matchesTimestampUpperBound(message, timestampTo));
    }
    return loadMessagesFromPosition(
        cluster,
        topic,
        deserializationService.deserializerFor(cluster, topic, keySerde, valueSerde),
        consumerPosition,
        filter,
        fixPageSize(limit));
  }

  public Flux<TopicMessageEventDTO> loadMessages(
      KafkaCluster cluster, String topic, String cursorId) {
    Cursor cursor =
        cursorsStorage
            .getCursor(cursorId)
            .orElseThrow(
                () ->
                    new ValidationException(
                        "Next page cursor not found. Maybe it was evicted from cache."));
    return loadMessagesFromPosition(
        cluster,
        topic,
        cursor.deserializer(),
        cursor.consumerPosition(),
        cursor.filter(),
        fixPageSize(cursor.limit()));
  }

  public Flux<TopicMessageEventDTO> loadSortedTopicMessages(
      KafkaCluster cluster, String topic, @Nullable List<String> stringFilters,
      @Nullable String filterId, @Nullable Integer limit, @Nullable String keySerde,
      @Nullable String valueSerde, boolean matchAny, boolean headersOnly,
      String orderBy, String sortOrder) {
    Comparator<TopicMessageDTO> order = topicMessageOrder(orderBy, sortOrder);
    int resultLimit = fixPageSize(limit);
    return withExistingTopic(cluster, topic).flux()
        .publishOn(Schedulers.boundedElastic())
        .flatMap(ignored -> Flux.defer(() -> {
          var position = ConsumerPosition.create(PollingModeDTO.EARLIEST, topic, List.of(), null, null);
          var deserializer = deserializationService.deserializerFor(cluster, topic, keySerde, valueSerde);
          var filter = getMsgFilter(stringFilters, filterId, matchAny, headersOnly);
          var pageWriter = "size".equals(orderBy)
              ? sortedTopicMessagePages.newWriter(
                  "DESC".equals(sortOrder),
                  Math.min(resultLimit, SORTED_SCAN_PREVIEW_LIMIT))
              : null;
          var pageSignature = sortedPageSignature(
              cluster, topic, stringFilters, filterId, limit, keySerde, valueSerde,
              matchAny, headersOnly, orderBy, sortOrder);
          var emitter = new FullScanEmitter(
              () -> consumerGroupService.createConsumer(
                  cluster, Map.of(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, 1_000)),
              position, deserializer, filter, cluster.getPollingSettings());
          return scanAndSortMessages(
              Flux.create(emitter),
              order,
              resultLimit,
              pageWriter,
              cluster.getName(),
              topic,
              pageSignature,
              "DESC".equals(sortOrder));
        }));
  }

  public Flux<TopicMessageEventDTO> loadSortedTopicMessagePage(
      KafkaCluster cluster,
      String topic,
      String cursorId,
      @Nullable Integer limit,
      @Nullable List<String> stringFilters,
      @Nullable String filterId,
      @Nullable String keySerde,
      @Nullable String valueSerde,
      boolean matchAny,
      boolean headersOnly,
      String orderBy,
      String sortOrder) {
    int pageSize = fixPageSize(limit);
    String signature = sortedPageSignature(
        cluster, topic, stringFilters, filterId, pageSize, keySerde, valueSerde,
        matchAny, headersOnly, orderBy, sortOrder);
    return Flux.defer(() -> {
      var page = sortedTopicMessagePages.readPage(
          cursorId, cluster.getName(), topic, signature, pageSize);
      return Flux.concat(
          Flux.just(sortedScanPhase(SORTED_PAGE_RESULTS_PHASE)),
          Flux.fromIterable(page.messages().stream()
              .map(MessagesService::sortedMessageEvent)
              .toList()),
          Flux.just(sortedScanPhase(SORTED_PAGE_COMPLETE_PHASE)),
          Flux.just(new TopicMessageEventDTO()
              .type(TopicMessageEventDTO.TypeEnum.DONE)
              .cursor(page.nextCursor() == null
                  ? null
                  : new TopicMessageNextPageCursorDTO().id(page.nextCursor()))));
    });
  }

  static Flux<TopicMessageEventDTO> sortScannedMessages(
      Flux<TopicMessageEventDTO> scan, Comparator<TopicMessageDTO> order, int resultLimit) {
    return scanAndSortMessages(scan, order, resultLimit, null, null, null, null, false);
  }

  static Flux<TopicMessageEventDTO> scanAndSortMessages(
      Flux<TopicMessageEventDTO> scan,
      Comparator<TopicMessageDTO> order,
      int resultLimit,
      @Nullable SortedTopicMessagePages.Writer pageWriter,
      @Nullable String clusterName,
      String topic,
      @Nullable String pageSignature,
      boolean descending) {
    return Flux.defer(() -> {
      PriorityQueue<TopicMessageDTO> top = pageWriter == null
          ? new PriorityQueue<>(resultLimit, order.reversed())
          : null;
      var done = new AtomicReference<TopicMessageEventDTO>();
      var messagesScanned = new AtomicLong();
      var latestRawRecordCount = new AtomicLong();
      var lastPreviewRawRecordCount = new AtomicLong();
      Flux<TopicMessageEventDTO> progress = scan.concatMap(event -> {
        if (event.getType() == TopicMessageEventDTO.TypeEnum.MESSAGE) {
          var message = event.getMessage();
          if (pageWriter != null) {
            pageWriter.append(message);
          } else if (top.size() < resultLimit) {
            top.add(message);
          } else if (order.compare(message, top.peek()) < 0) {
            top.poll();
            top.add(message);
          }
          long scanned = messagesScanned.incrementAndGet();
          if (scanned == SORTED_SCAN_FIRST_PREVIEW_SIZE
              || (scanned > SORTED_SCAN_FIRST_PREVIEW_SIZE
              && scanned % SORTED_SCAN_PREVIEW_INTERVAL == 0)) {
            lastPreviewRawRecordCount.set(latestRawRecordCount.get());
            return Flux.fromIterable(provisionalSortedResults(
                top, pageWriter, order, resultLimit, descending));
          }
          return Flux.empty();
        }
        if (event.getType() == TopicMessageEventDTO.TypeEnum.CONSUMING
            && event.getConsuming() != null) {
          int rawRecordCount =
              Optional.ofNullable(event.getConsuming().getMessagesConsumed()).orElse(0);
          latestRawRecordCount.set(rawRecordCount);
          long rawPreviewInterval = messagesScanned.get() < SORTED_SCAN_FIRST_PREVIEW_SIZE
              ? SORTED_SCAN_NARROW_FILTER_PREVIEW_INTERVAL
              : SORTED_SCAN_RAW_PREVIEW_INTERVAL;
          if (rawRecordCount - lastPreviewRawRecordCount.get()
                  >= rawPreviewInterval
              && hasSortedMessages(top, pageWriter)) {
            lastPreviewRawRecordCount.set(rawRecordCount);
            return Flux.concat(
                Flux.just(event),
                Flux.fromIterable(provisionalSortedResults(
                    top, pageWriter, order, resultLimit, descending)));
          }
          return Flux.just(event);
        }
        if (event.getType() == TopicMessageEventDTO.TypeEnum.DONE) {
          done.set(event);
          return Flux.empty();
        }
        return Flux.just(event);
      });
      return progress.concatWith(Flux.defer(() -> {
        var finish = done.get();
        if (finish == null || finish.getConsuming().getFilterApplyErrors() > 0) {
          return Flux.error(new ValidationException("Whole-topic scan did not complete successfully"));
        }
        List<TopicMessageEventDTO> finalRows;
        if (pageWriter != null) {
          SortedTopicMessagePages.Page page = pageWriter.finish(
              clusterName, topic, pageSignature, resultLimit, descending);
          if (page.nextCursor() != null) {
            finish.setCursor(new TopicMessageNextPageCursorDTO().id(page.nextCursor()));
          }
          finalRows = page.messages().stream()
              .map(MessagesService::sortedMessageEvent)
              .toList();
        } else {
          finalRows = sortedMessages(top, order, resultLimit);
        }
        return Flux.concat(
            Flux.just(sortedScanPhase(SORTED_SCAN_FINAL_PHASE)),
            Flux.fromIterable(finalRows),
            Flux.just(sortedScanPhase(SORTED_SCAN_FINAL_COMPLETE_PHASE)),
            Flux.just(finish));
      }));
    }).doFinally(signalType -> {
      if (pageWriter != null) {
        pageWriter.close();
      }
    });
  }

  private String sortedPageSignature(
      KafkaCluster cluster,
      String topic,
      @Nullable List<String> stringFilters,
      @Nullable String filterId,
      @Nullable Integer limit,
      @Nullable String keySerde,
      @Nullable String valueSerde,
      boolean matchAny,
      boolean headersOnly,
      String orderBy,
      String sortOrder) {
    try {
      String requestSignature = OBJECT_MAPPER.writeValueAsString(Arrays.asList(
          cluster.getName(),
          topic,
          stringFilters,
          filterId,
          fixPageSize(limit),
          keySerde,
          valueSerde,
          matchAny,
          headersOnly,
          orderBy,
          sortOrder));
      return Hashing.sha256().hashString(requestSignature, Charsets.UTF_8).toString();
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Failed to create sorted messages cursor signature", e);
    }
  }

  private static TopicMessageEventDTO sortedMessageEvent(TopicMessageDTO message) {
    return new TopicMessageEventDTO()
        .type(TopicMessageEventDTO.TypeEnum.MESSAGE)
        .message(message);
  }

  private static List<TopicMessageEventDTO> sortedMessages(
      PriorityQueue<TopicMessageDTO> messages, Comparator<TopicMessageDTO> order, int limit) {
    return messages.stream()
        .sorted(order)
        .limit(limit)
        .map(message -> new TopicMessageEventDTO()
            .type(TopicMessageEventDTO.TypeEnum.MESSAGE).message(message))
        .toList();
  }

  private static boolean hasSortedMessages(
      @Nullable PriorityQueue<TopicMessageDTO> messages,
      @Nullable SortedTopicMessagePages.Writer pageWriter) {
    return pageWriter == null ? messages != null && !messages.isEmpty() : pageWriter.hasMessages();
  }

  private static List<TopicMessageEventDTO> provisionalSortedResults(
      @Nullable PriorityQueue<TopicMessageDTO> messages,
      @Nullable SortedTopicMessagePages.Writer pageWriter,
      Comparator<TopicMessageDTO> order,
      int resultLimit,
      boolean descending) {
    List<TopicMessageEventDTO> previewRows = pageWriter == null
        ? sortedMessages(messages, order, Math.min(resultLimit, SORTED_SCAN_PREVIEW_LIMIT))
        : pageWriter.preview(
                Math.min(resultLimit, SORTED_SCAN_PREVIEW_LIMIT),
                SORTED_SCAN_PREVIEW_BYTES,
                descending).stream()
            .map(MessagesService::sortedMessageEvent)
            .toList();
    List<TopicMessageEventDTO> results = new ArrayList<>(previewRows.size() + 2);
    results.add(sortedScanPhase(SORTED_SCAN_PREVIEW_PHASE));
    results.addAll(previewRows);
    results.add(sortedScanPhase(SORTED_SCAN_PREVIEW_COMPLETE_PHASE));
    return results;
  }

  private static TopicMessageEventDTO sortedScanPhase(String name) {
    return new TopicMessageEventDTO()
        .type(TopicMessageEventDTO.TypeEnum.PHASE)
        .phase(new TopicMessagePhaseDTO().name(name));
  }

  static Comparator<TopicMessageDTO> topicMessageOrder(String column, String direction) {
    Comparator<TopicMessageDTO> order = switch (column) {
      case "id" -> Comparator.comparingInt(TopicMessageDTO::getPartition)
          .thenComparingLong(TopicMessageDTO::getOffset);
      case "offset" -> Comparator.comparingLong(TopicMessageDTO::getOffset);
      case "partition" -> Comparator.comparingInt(TopicMessageDTO::getPartition);
      case "timestamp" -> Comparator.comparing(TopicMessageDTO::getTimestamp,
          Comparator.nullsFirst(Comparator.naturalOrder()));
      case "size" -> Comparator.comparingLong(message ->
          Optional.ofNullable(message.getKeySize()).orElse(0L)
              + Optional.ofNullable(message.getValueSize()).orElse(0L)
              + Optional.ofNullable(message.getHeadersSize()).orElse(0L));
      case "key" -> Comparator.comparing(TopicMessageDTO::getKey,
          Comparator.nullsFirst(Comparator.naturalOrder()));
      case "value" -> Comparator.comparing(TopicMessageDTO::getValue,
          Comparator.nullsFirst(Comparator.naturalOrder()));
      case "headers" -> Comparator.comparing(message ->
          OBJECT_MAPPER.valueToTree(Optional.ofNullable(message.getHeaders()).orElse(Map.of())).toString());
      default -> throw new ValidationException("Unsupported sorting column: " + column);
    };
    order = order.thenComparingInt(TopicMessageDTO::getPartition).thenComparingLong(TopicMessageDTO::getOffset);
    return switch (direction) {
      case "ASC" -> order;
      case "DESC" -> order.reversed();
      default -> throw new ValidationException("Unsupported sort order: " + direction);
    };
  }

  private Flux<TopicMessageEventDTO> loadMessagesFromPosition(
      KafkaCluster cluster,
      String topic,
      ConsumerRecordDeserializer deserializer,
      ConsumerPosition consumerPosition,
      Predicate<TopicMessageDTO> filter,
      int limit) {
    return withExistingTopic(cluster, topic)
        .flux()
        .publishOn(Schedulers.boundedElastic())
        .flatMap(td -> loadMessagesImpl(cluster, deserializer, consumerPosition, filter, limit));
  }

  public Flux<TopicMessageEventDTO> filterMessagesByTimestampUpperBound(
      Flux<TopicMessageEventDTO> events, @Nullable Long timestampTo) {
    if (timestampTo == null) {
      return events;
    }
    return events.filter(event -> isEventWithinTimestampUpperBound(event, timestampTo));
  }

  static boolean isEventWithinTimestampUpperBound(
      TopicMessageEventDTO event, long timestampTo) {
    if (event.getType() != TopicMessageEventDTO.TypeEnum.MESSAGE) {
      return true;
    }
    return event.getMessage() != null && matchesTimestampUpperBound(event.getMessage(), timestampTo);
  }

  public Mono<byte[]> downloadLastMessagesAsZip(
      KafkaCluster cluster,
      String topic,
      int limit,
      List<Integer> partitions,
      @Nullable String containsStringFilter,
      @Nullable String smartFilterId,
      @Nullable String keySerde,
      @Nullable String valueSerde) {
    return downloadMessagesAsZip(
        cluster,
        topic,
        limit,
        partitions,
        containsStringFilter,
        smartFilterId,
        keySerde,
        valueSerde,
        PollingModeDTO.LATEST,
        null,
        null,
        null,
        DownloadFormat.TEXT);
  }

  public Mono<byte[]> downloadMessagesAsZip(
      KafkaCluster cluster,
      String topic,
      int limit,
      List<Integer> partitions,
      @Nullable String containsStringFilter,
      @Nullable String smartFilterId,
      @Nullable String keySerde,
      @Nullable String valueSerde,
      PollingModeDTO pollingMode,
      @Nullable Long offset,
      @Nullable Long timestamp,
      @Nullable Long timestampTo,
      DownloadFormat format) {
    return collectDownloadMessages(
            cluster,
            topic,
            limit,
            partitions,
            toStringFilters(containsStringFilter),
            smartFilterId,
            keySerde,
            valueSerde,
            pollingMode,
            offset,
            timestamp,
            timestampTo)
        .map(messages -> createMessagesZip(topic, messages, format));
  }

  public Mono<DownloadResult> downloadMessages(
      KafkaCluster cluster,
      String topic,
      int limit,
      List<Integer> partitions,
      @Nullable List<String> containsStringFilters,
      @Nullable String smartFilterId,
      @Nullable String keySerde,
      @Nullable String valueSerde,
      PollingModeDTO pollingMode,
      @Nullable Long offset,
      @Nullable Long timestamp,
      @Nullable Long timestampTo,
      DownloadFormat format) {
    return downloadMessages(cluster, topic, limit, partitions, containsStringFilters,
        smartFilterId, keySerde, valueSerde, pollingMode, offset, timestamp, timestampTo,
        format, false, false);
  }

  public Mono<DownloadResult> downloadMessages(
      KafkaCluster cluster, String topic, int limit, List<Integer> partitions,
      @Nullable List<String> containsStringFilters, @Nullable String smartFilterId,
      @Nullable String keySerde, @Nullable String valueSerde, PollingModeDTO pollingMode,
      @Nullable Long offset, @Nullable Long timestamp, @Nullable Long timestampTo,
      DownloadFormat format, boolean matchAny, boolean headersOnly) {
    String fileName = downloadFileName(topic, limit, pollingMode, format);
    return collectDownloadMessages(
            cluster,
            topic,
            limit,
            partitions,
            containsStringFilters,
            smartFilterId,
            keySerde,
            valueSerde,
            pollingMode,
            offset,
            timestamp,
            timestampTo, matchAny, headersOnly)
        .map(
            messages ->
                new DownloadResult(
                    serializeMessages(topic, messages, format), mediaTypeFor(format), fileName));
  }

  private Mono<List<TopicMessageDTO>> collectDownloadMessages(
      KafkaCluster cluster,
      String topic,
      int limit,
      List<Integer> partitions,
      @Nullable List<String> containsStringFilters,
      @Nullable String smartFilterId,
      @Nullable String keySerde,
      @Nullable String valueSerde,
      PollingModeDTO pollingMode,
      @Nullable Long offset,
      @Nullable Long timestamp,
      @Nullable Long timestampTo) {
    return collectDownloadMessages(cluster, topic, limit, partitions, containsStringFilters,
        smartFilterId, keySerde, valueSerde, pollingMode, offset, timestamp, timestampTo,
        false, false);
  }

  private Mono<List<TopicMessageDTO>> collectDownloadMessages(
      KafkaCluster cluster, String topic, int limit, List<Integer> partitions,
      @Nullable List<String> containsStringFilters, @Nullable String smartFilterId,
      @Nullable String keySerde, @Nullable String valueSerde, PollingModeDTO pollingMode,
      @Nullable Long offset, @Nullable Long timestamp, @Nullable Long timestampTo,
      boolean matchAny, boolean headersOnly) {
    if (limit < 1 || limit > maxPageSize) {
      return Mono.error(
          new ValidationException("Download limit must be between 1 and " + maxPageSize));
    }

    return loadMessages(
            cluster,
            topic,
            ConsumerPosition.create(pollingMode, topic, partitions, timestamp, offset),
            Optional.ofNullable(containsStringFilters).orElse(List.of()),
            smartFilterId,
            limit,
            keySerde,
            valueSerde, matchAny, headersOnly, timestampTo)
        .filter(event -> event.getType() == TopicMessageEventDTO.TypeEnum.MESSAGE)
        .map(TopicMessageEventDTO::getMessage)
        .collectList();
  }

  public Mono<UploadMessagesResult> uploadMessages(
      KafkaCluster cluster,
      String topic,
      List<UploadSourceFile> files,
      UploadMessagesOptions options) {
    if (files.isEmpty()) {
      return Mono.error(new ValidationException("At least one upload file is required"));
    }
    validateUploadSerdes(options);

    return withExistingTopic(cluster, topic)
        .publishOn(Schedulers.boundedElastic())
        .map(topicDescription -> uploadMessagesImpl(cluster, topicDescription, files, options));
  }

  public int resolveDownloadLimit(@Nullable Integer limit) {
    int resolvedLimit = Optional.ofNullable(limit).orElse(defaultDownloadLimit);
    if (resolvedLimit < 1 || resolvedLimit > maxPageSize) {
      throw new ValidationException("Download limit must be between 1 and " + maxPageSize);
    }
    return resolvedLimit;
  }

  public record DownloadSettings(int defaultLimit, int maxLimit) {
  }

  public DownloadSettings downloadSettings() {
    return new DownloadSettings(defaultDownloadLimit, maxPageSize);
  }

  public String downloadFileName(String topic, int limit) {
    return safeZipName(topic) + "-last-" + limit + "-messages.zip";
  }

  public String downloadFileName(
      String topic, int limit, PollingModeDTO mode, DownloadFormat format) {
    String base = safeZipName(topic) + "-" + mode.name().toLowerCase(Locale.ROOT) + "-" + limit;
    return switch (format) {
      case CSV -> base + "-messages.csv";
      case NDJSON -> base + "-messages.ndjson";
      case JSON -> base + "-json-messages.zip";
      default -> base + "-txt-messages.zip";
    };
  }

  private static String mediaTypeFor(DownloadFormat format) {
    return switch (format) {
      case CSV -> "text/csv";
      case NDJSON -> "application/x-ndjson";
      default -> "application/zip";
    };
  }

  static byte[] serializeMessages(
      String topic, List<TopicMessageDTO> messages, DownloadFormat format) {
    return switch (format) {
      case CSV -> messagesToCsv(topic, messages).getBytes(StandardCharsets.UTF_8);
      case NDJSON -> messagesToNdjson(topic, messages).getBytes(StandardCharsets.UTF_8);
      default -> createMessagesZip(topic, messages, format);
    };
  }

  private Flux<TopicMessageEventDTO> loadMessagesImpl(
      KafkaCluster cluster,
      ConsumerRecordDeserializer deserializer,
      ConsumerPosition consumerPosition,
      Predicate<TopicMessageDTO> filter,
      int limit) {
    var emitter =
        switch (consumerPosition.pollingMode()) {
          case TO_OFFSET, TO_TIMESTAMP, LATEST ->
              new BackwardEmitter(
                  () ->
                      consumerGroupService.createConsumer(
                          cluster, Map.of(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, limit)),
                  consumerPosition,
                  limit,
                  deserializer,
                  filter,
                  cluster.getPollingSettings(),
                  cursorsStorage.createNewCursor(deserializer, consumerPosition, filter, limit));
          case FROM_OFFSET, FROM_TIMESTAMP, EARLIEST ->
              new ForwardEmitter(
                  () ->
                      consumerGroupService.createConsumer(
                          cluster, Map.of(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, limit)),
                  consumerPosition,
                  limit,
                  deserializer,
                  filter,
                  cluster.getPollingSettings(),
                  cursorsStorage.createNewCursor(deserializer, consumerPosition, filter, limit));
          case TAILING ->
              new TailingEmitter(
                  () -> consumerGroupService.createConsumer(
                      cluster, Map.of(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, limit)),
                  consumerPosition,
                  deserializer,
                  filter,
                  cluster.getPollingSettings(),
                  limit);
        };
    return Flux.create(emitter);
  }

  private Predicate<TopicMessageDTO> getMsgFilter(
      @Nullable List<String> containsStrFilters, @Nullable String smartFilterId,
      boolean matchAny, boolean headersOnly) {
    Predicate<TopicMessageDTO> messageFilter =
        MessageFilters.search(containsStrFilters, matchAny, headersOnly);
    if (smartFilterId != null) {
      var registered = registeredFilters.getIfPresent(smartFilterId);
      if (registered == null) {
        throw new ValidationException("No filter was registered with id " + smartFilterId);
      }
      messageFilter = messageFilter.and(registered);
    }
    return messageFilter;
  }

  private static List<String> toStringFilters(@Nullable String containsStringFilter) {
    return containsStringFilter == null ? List.of() : List.of(containsStringFilter);
  }

  private int fixPageSize(@Nullable Integer pageSize) {
    return Optional.ofNullable(pageSize)
        .filter(ps -> ps > 0 && ps <= maxPageSize)
        .orElse(Math.min(defaultPageSize, maxPageSize));
  }

  public String registerMessageFilter(String celCode) {
    String saltedCode = celCode + SALT_FOR_HASHING;
    String filterId =
        Hashing.sha256().hashString(saltedCode, Charsets.UTF_8).toString().substring(0, 8);
    if (registeredFilters.getIfPresent(filterId) == null) {
      registeredFilters.put(filterId, MessageFilters.celScriptFilter(celCode));
    }
    return filterId;
  }

  private static boolean matchesTimestampUpperBound(TopicMessageDTO message, @Nullable Long timestampTo) {
    if (timestampTo == null || message.getTimestamp() == null) {
      return true;
    }
    return !message.getTimestamp().toInstant().isAfter(Instant.ofEpochMilli(timestampTo));
  }

  private static byte[] createMessagesZip(
      String topic, List<TopicMessageDTO> messages, DownloadFormat format) {
    try (ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
        ZipOutputStream zipOutputStream =
            new ZipOutputStream(outputStream, StandardCharsets.UTF_8)) {

      if (messages.isEmpty()) {
        zipOutputStream.putNextEntry(new ZipEntry("README.txt"));
        zipOutputStream.write(
            ("No messages were found for topic " + topic + ".").getBytes(StandardCharsets.UTF_8));
        zipOutputStream.closeEntry();
      }

      String safeTopic = safeZipName(topic);
      for (TopicMessageDTO message : messages) {
        zipOutputStream.putNextEntry(new ZipEntry(messageFileName(message, safeTopic, format)));
        zipOutputStream.write(
            messageContent(topic, message, format).getBytes(StandardCharsets.UTF_8));
        zipOutputStream.closeEntry();
      }

      zipOutputStream.finish();
      return outputStream.toByteArray();
    } catch (IOException e) {
      throw new IllegalStateException("Failed to create Kafka messages ZIP archive", e);
    }
  }

  private UploadMessagesResult uploadMessagesImpl(
      KafkaCluster cluster,
      TopicDescription topicDescription,
      List<UploadSourceFile> files,
      UploadMessagesOptions options) {
    ParsedUpload parsedUpload = parseUploadFiles(files, options);
    int messageLimit = resolveUploadMessageLimit(options.messageLimit());
    if (parsedUpload.candidates().size() > messageLimit) {
      throw new ValidationException(
          "Upload parsed "
              + parsedUpload.candidates().size()
              + " messages, which is above the configured limit of "
              + messageLimit);
    }

    List<String> errors = new ArrayList<>();
    List<UploadMessagePreview> previews =
        previews(topicDescription, parsedUpload.candidates(), options);
    int produced = 0;

    if (!options.dryRun()) {
      ProducerRecordCreator producerRecordCreator =
          deserializationService.producerRecordCreator(
              cluster,
              topicDescription.name(),
              options.keySerde(),
              options.valueSerde(),
              Map.of(),
              Map.of());

      try (KafkaProducer<byte[], byte[]> producer = createProducer(cluster, Map.of())) {
        int index = 0;
        for (UploadCandidate candidate : parsedUpload.candidates()) {
          try {
            Integer partition = resolveUploadPartition(topicDescription, options, index);
            producer
                .send(
                    producerRecordCreator.create(
                        topicDescription.name(),
                        partition,
                        candidate.key(),
                        candidate.value(),
                        uploadHeaders(candidate, options, index)))
                .get();
            produced++;
          } catch (Exception e) {
            errors.add(candidate.entryName() + ": " + e.getMessage());
          }
          index++;
        }
      }
    }

    return new UploadMessagesResult(
        options.dryRun(),
        files.size(),
        parsedUpload.entriesRead(),
        parsedUpload.candidates().size(),
        produced,
        errors.size(),
        parsedUpload.fileResults(),
        previews,
        errors);
  }

  private record ParsedUpload(
      List<UploadCandidate> candidates,
      List<UploadMessagesFileResult> fileResults,
      int entriesRead) {}

  private ParsedUpload parseUploadFiles(
      List<UploadSourceFile> files, UploadMessagesOptions options) {
    List<UploadCandidate> candidates = new ArrayList<>();
    List<UploadMessagesFileResult> fileResults = new ArrayList<>();
    int entriesRead = 0;

    for (UploadSourceFile file : files) {
      int before = candidates.size();
      List<UploadSourceFile> extractedFiles = extractFiles(file);
      entriesRead += extractedFiles.size();
      for (UploadSourceFile extractedFile : extractedFiles) {
        candidates.addAll(
            parseUploadContent(
                file.fileName(), extractedFile.fileName(), extractedFile.content(), options));
      }
      fileResults.add(
          new UploadMessagesFileResult(
              file.fileName(), extractedFiles.size(), candidates.size() - before));
    }

    return new ParsedUpload(candidates, fileResults, entriesRead);
  }

  private List<UploadSourceFile> extractFiles(UploadSourceFile file) {
    if (!isZip(file)) {
      return List.of(file);
    }

    List<UploadSourceFile> entries = new ArrayList<>();
    try (ZipInputStream zipInputStream =
        new ZipInputStream(new ByteArrayInputStream(file.content()), StandardCharsets.UTF_8)) {
      for (ZipEntry entry = zipInputStream.getNextEntry();
          entry != null;
          entry = zipInputStream.getNextEntry()) {
        if (!entry.isDirectory()) {
          entries.add(new UploadSourceFile(entry.getName(), zipInputStream.readAllBytes()));
        }
        zipInputStream.closeEntry();
      }
    } catch (IOException e) {
      throw new ValidationException(
          "Failed to read ZIP file " + file.fileName() + ": " + e.getMessage());
    }
    return entries;
  }

  private boolean isZip(UploadSourceFile file) {
    String lowerFileName = file.fileName().toLowerCase(Locale.ROOT);
    byte[] content = file.content();
    return lowerFileName.endsWith(".zip")
        || (content.length > 3 && content[0] == 'P' && content[1] == 'K');
  }

  private List<UploadCandidate> parseUploadContent(
      String sourceFile, String entryName, byte[] content, UploadMessagesOptions options) {
    String text = new String(content, StandardCharsets.UTF_8);
    String key = keyFor(sourceFile, entryName, options.keyMode());
    List<String> values =
        switch (options.parseMode()) {
          case FILE_PER_MESSAGE -> text.isEmpty() ? List.of() : List.of(text);
          case TEXT_LINES -> text.lines().filter(line -> !line.isBlank()).toList();
          case NDJSON -> parseNdjson(entryName, text);
          case JSON_ARRAY -> parseJsonArray(entryName, text);
        };

    List<UploadCandidate> candidates = new ArrayList<>();
    for (int i = 0; i < values.size(); i++) {
      candidates.add(new UploadCandidate(sourceFile, entryName, key, values.get(i), i));
    }
    return candidates;
  }

  private List<String> parseNdjson(String entryName, String text) {
    List<String> values = new ArrayList<>();
    text.lines()
        .filter(line -> !line.isBlank())
        .forEach(line -> values.add(compactJson(entryName, line)));
    return values;
  }

  private List<String> parseJsonArray(String entryName, String text) {
    try {
      JsonNode json = OBJECT_MAPPER.readTree(text);
      if (!json.isArray()) {
        return List.of(OBJECT_MAPPER.writeValueAsString(json));
      }
      List<String> values = new ArrayList<>();
      json.forEach(item -> values.add(jsonToString(entryName, item)));
      return values;
    } catch (IOException e) {
      throw new ValidationException(entryName + " is not valid JSON: " + e.getMessage());
    }
  }

  private String compactJson(String entryName, String jsonLine) {
    try {
      return OBJECT_MAPPER.writeValueAsString(OBJECT_MAPPER.readTree(jsonLine));
    } catch (IOException e) {
      throw new ValidationException(entryName + " contains invalid NDJSON: " + e.getMessage());
    }
  }

  private String jsonToString(String entryName, JsonNode json) {
    try {
      return OBJECT_MAPPER.writeValueAsString(json);
    } catch (JsonProcessingException e) {
      throw new ValidationException(entryName + " contains invalid JSON: " + e.getMessage());
    }
  }

  private List<UploadMessagePreview> previews(
      TopicDescription topicDescription,
      List<UploadCandidate> candidates,
      UploadMessagesOptions options) {
    List<UploadMessagePreview> previews = new ArrayList<>();
    int previewCount = Math.min(10, candidates.size());
    for (int i = 0; i < previewCount; i++) {
      UploadCandidate candidate = candidates.get(i);
      previews.add(
          new UploadMessagePreview(
              candidate.sourceFile(),
              candidate.entryName(),
              resolveUploadPartition(topicDescription, options, i),
              candidate.key(),
              candidate.value().getBytes(StandardCharsets.UTF_8).length,
              preview(candidate.value())));
    }
    return previews;
  }

  private String preview(String value) {
    String normalized = value.replaceAll("\\s+", " ").trim();
    return normalized.length() <= 240 ? normalized : normalized.substring(0, 240) + "…";
  }

  private String keyFor(String sourceFile, String entryName, UploadKeyMode keyMode) {
    return switch (keyMode) {
      case NONE -> null;
      case FILE_NAME -> sourceFile;
      case ENTRY_NAME -> entryName;
    };
  }

  private Map<String, String> uploadHeaders(
      UploadCandidate candidate, UploadMessagesOptions options, int index) {
    Map<String, String> headers = new LinkedHashMap<>(parseUploadHeaders(options.headersJson()));
    if (options.includeMetadataHeaders()) {
      headers.put("kafbat-upload-file", candidate.sourceFile());
      headers.put("kafbat-upload-entry", candidate.entryName());
      headers.put("kafbat-upload-source-index", Integer.toString(candidate.sourceIndex()));
      headers.put("kafbat-upload-index", Integer.toString(index));
    }
    return headers;
  }

  private Map<String, String> parseUploadHeaders(@Nullable String headersJson) {
    if (headersJson == null || headersJson.isBlank()) {
      return Map.of();
    }
    try {
      JsonNode root = OBJECT_MAPPER.readTree(headersJson);
      if (!root.isObject()) {
        throw new ValidationException("Headers must be a JSON object");
      }
      Map<String, String> headers = new LinkedHashMap<>();
      root.properties().forEach(entry -> headers.put(entry.getKey(), entry.getValue().asText()));
      return headers;
    } catch (IOException e) {
      throw new ValidationException("Headers JSON is invalid: " + e.getMessage());
    }
  }

  private Integer resolveUploadPartition(
      TopicDescription topicDescription, UploadMessagesOptions options, int messageIndex) {
    List<Integer> partitions = uploadTargetPartitions(topicDescription, options);
    return switch (options.partitionStrategy()) {
      case ANY -> null;
      case SELECTED -> options.selectedPartition();
      case RANDOM -> partitions.get(ThreadLocalRandom.current().nextInt(partitions.size()));
      case EVEN -> partitions.get(messageIndex % partitions.size());
    };
  }

  private List<Integer> uploadTargetPartitions(
      TopicDescription topicDescription, UploadMessagesOptions options) {
    Set<Integer> actualPartitions =
        topicDescription.partitions().stream()
            .map(partition -> partition.partition())
            .collect(Collectors.toSet());
    if (actualPartitions.isEmpty()) {
      throw new ValidationException("Topic has no partitions");
    }

    List<Integer> requested =
        options.partitionStrategy() == UploadPartitionStrategy.SELECTED
            ? List.of(
                Optional.ofNullable(options.selectedPartition())
                    .orElseThrow(() -> new ValidationException("Selected partition is required")))
            : options.targetPartitions();

    List<Integer> partitions =
        requested == null || requested.isEmpty()
            ? actualPartitions.stream().sorted().toList()
            : requested.stream().distinct().sorted().toList();

    if (!actualPartitions.containsAll(partitions)) {
      throw new ValidationException("One or more requested partitions do not exist");
    }
    return partitions;
  }

  private int resolveUploadMessageLimit(@Nullable Integer messageLimit) {
    int resolved = Optional.ofNullable(messageLimit).orElse(DEFAULT_UPLOAD_MESSAGE_LIMIT);
    if (resolved < 1 || resolved > MAX_UPLOAD_MESSAGE_LIMIT) {
      throw new ValidationException(
          "Upload message limit must be between 1 and " + MAX_UPLOAD_MESSAGE_LIMIT);
    }
    return resolved;
  }

  private void validateUploadSerdes(UploadMessagesOptions options) {
    if (options.keySerde() == null || options.keySerde().isBlank()) {
      throw new ValidationException("Key serde is required");
    }
    if (options.valueSerde() == null || options.valueSerde().isBlank()) {
      throw new ValidationException("Value serde is required");
    }
  }

  private static String messageFileName(
      TopicMessageDTO message, String safeTopic, DownloadFormat format) {
    String extension = format == DownloadFormat.JSON ? ".json" : ".txt";
    return message.getOffset()
        + "Offset-"
        + message.getPartition()
        + "Partition-"
        + safeTopic
        + "-Topic"
        + extension;
  }

  private static String messageContent(
      String topic, TopicMessageDTO message, DownloadFormat format) {
    return switch (format) {
      case JSON -> messageJson(topic, message);
      case VALUE_ONLY -> nullToEmpty(message.getValue());
      default -> messageText(topic, message);
    };
  }

  private static Map<String, Object> messageToMap(String topic, TopicMessageDTO message) {
    Map<String, Object> exportedMessage = new LinkedHashMap<>();
    exportedMessage.put("topic", topic);
    exportedMessage.put("partition", message.getPartition());
    exportedMessage.put("offset", message.getOffset());
    exportedMessage.put(
        "timestamp", message.getTimestamp() == null ? null : message.getTimestamp().toString());
    exportedMessage.put("timestampType", message.getTimestampType());
    exportedMessage.put("key", message.getKey());
    exportedMessage.put("headers", Optional.ofNullable(message.getHeaders()).orElse(Map.of()));
    exportedMessage.put("keySize", message.getKeySize());
    exportedMessage.put("valueSize", message.getValueSize());
    exportedMessage.put("keySerde", message.getKeySerde());
    exportedMessage.put("valueSerde", message.getValueSerde());
    exportedMessage.put("value", message.getValue());
    return exportedMessage;
  }

  private static String messageJson(String topic, TopicMessageDTO message) {
    try {
      return OBJECT_MAPPER
          .writerWithDefaultPrettyPrinter()
          .writeValueAsString(messageToMap(topic, message));
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Failed to serialize Kafka message", e);
    }
  }

  private static String messagesToNdjson(String topic, List<TopicMessageDTO> messages) {
    StringBuilder builder = new StringBuilder();
    for (TopicMessageDTO message : messages) {
      try {
        builder.append(OBJECT_MAPPER.writeValueAsString(messageToMap(topic, message)));
      } catch (JsonProcessingException e) {
        throw new IllegalStateException("Failed to serialize Kafka message", e);
      }
      builder.append('\n');
    }
    return builder.toString();
  }

  private static final List<String> CSV_COLUMNS =
      List.of(
          "topic",
          "partition",
          "offset",
          "timestamp",
          "timestampType",
          "key",
          "value",
          "headers",
          "keySize",
          "valueSize",
          "keySerde",
          "valueSerde");

  private static String messagesToCsv(String topic, List<TopicMessageDTO> messages) {
    StringBuilder builder = new StringBuilder();
    builder.append(String.join(",", CSV_COLUMNS)).append("\r\n");
    for (TopicMessageDTO message : messages) {
      Map<String, Object> row = messageToMap(topic, message);
      List<String> cells = new ArrayList<>(CSV_COLUMNS.size());
      for (String column : CSV_COLUMNS) {
        Object cell = row.get(column);
        cells.add(csvEscape(csvCellToString(cell)));
      }
      builder.append(String.join(",", cells)).append("\r\n");
    }
    return builder.toString();
  }

  private static String csvCellToString(@Nullable Object cell) {
    if (cell == null) {
      return "";
    }
    if (cell instanceof Map<?, ?> || cell instanceof List<?>) {
      try {
        return OBJECT_MAPPER.writeValueAsString(cell);
      } catch (JsonProcessingException e) {
        return String.valueOf(cell);
      }
    }
    return String.valueOf(cell);
  }

  private static String csvEscape(String value) {
    boolean mustQuote =
        value.contains(",") || value.contains("\"") || value.contains("\n") || value.contains("\r");
    if (!mustQuote) {
      return value;
    }
    return "\"" + value.replace("\"", "\"\"") + "\"";
  }

  private static String messageText(String topic, TopicMessageDTO message) {
    StringBuilder text = new StringBuilder();
    text.append("Topic: ").append(topic).append(System.lineSeparator());
    text.append("Partition: ").append(message.getPartition()).append(System.lineSeparator());
    text.append("Offset: ").append(message.getOffset()).append(System.lineSeparator());
    text.append("Timestamp: ").append(message.getTimestamp()).append(System.lineSeparator());
    text.append("Timestamp type: ")
        .append(message.getTimestampType())
        .append(System.lineSeparator());
    text.append("Key: ").append(nullToEmpty(message.getKey())).append(System.lineSeparator());
    text.append("Headers: ")
        .append(Optional.ofNullable(message.getHeaders()).orElse(Map.of()))
        .append(System.lineSeparator());
    text.append("Key size: ").append(message.getKeySize()).append(System.lineSeparator());
    text.append("Value size: ").append(message.getValueSize()).append(System.lineSeparator());
    text.append(System.lineSeparator()).append("Payload:").append(System.lineSeparator());
    text.append(nullToEmpty(message.getValue()));
    return text.toString();
  }

  private static String nullToEmpty(@Nullable String value) {
    return value == null ? "" : value;
  }

  private static String safeZipName(String value) {
    String safe = value.replaceAll(INVALID_ZIP_ENTRY_CHARS, "_").replace("..", "_").trim();
    return safe.isEmpty() ? "topic" : safe;
  }
}
