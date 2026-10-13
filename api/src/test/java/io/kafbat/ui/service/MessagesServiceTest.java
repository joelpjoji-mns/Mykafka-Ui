package io.kafbat.ui.service;

import static io.kafbat.ui.service.MessagesService.execSmartFilterTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.confluent.kafka.schemaregistry.avro.AvroSchema;
import io.kafbat.ui.AbstractIntegrationTest;
import io.kafbat.ui.exception.TopicNotFoundException;
import io.kafbat.ui.exception.ValidationException;
import io.kafbat.ui.model.ConsumerPosition;
import io.kafbat.ui.model.CreateTopicMessageDTO;
import io.kafbat.ui.model.KafkaCluster;
import io.kafbat.ui.model.MessageValidationStatusDTO;
import io.kafbat.ui.model.PollingModeDTO;
import io.kafbat.ui.model.SmartFilterTestExecutionDTO;
import io.kafbat.ui.model.TopicMessageDTO;
import io.kafbat.ui.model.TopicMessageEventDTO;
import io.kafbat.ui.producer.KafkaTestProducer;
import io.kafbat.ui.serdes.builtin.ProtobufFileSerde;
import io.kafbat.ui.serdes.builtin.StringSerde;
import io.kafbat.ui.serdes.builtin.sr.SchemaRegistrySerde;
import io.kafbat.ui.service.MessagesService.DownloadFormat;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import java.util.zip.ZipInputStream;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

class MessagesServiceTest extends AbstractIntegrationTest {

  private static final String MASKED_TOPICS_PREFIX = "masking-test-";
  private static final String NON_EXISTING_TOPIC = UUID.randomUUID().toString();

  @Autowired MessagesService messagesService;

  KafkaCluster cluster;

  Set<String> createdTopics = new HashSet<>();

  @BeforeEach
  void init() {
    cluster =
        applicationContext.getBean(ClustersStorage.class).getClusterByName(LOCAL).orElseThrow();
  }

  @AfterEach
  void deleteCreatedTopics() {
    createdTopics.forEach(MessagesServiceTest::deleteTopic);
  }

  @Test
  void wholeTopicSortingFindsExtremesBeyondTheRequestedPageAndAcrossPartitions() {
    String topic = "whole-topic-sort-" + UUID.randomUUID();
    createTopicWithCleanup(new NewTopic(topic, 2, (short) 1));
    try (var producer = KafkaTestProducer.forKafka(kafka)) {
      for (int index = 0; index < 1_100; index++) {
        producer.send(new ProducerRecord<>(topic, index % 2, "key", "middle-" + index));
      }
    }
    messagesService.sendMessage(cluster, topic, new CreateTopicMessageDTO()
        .partition(1).key("key").value("z".repeat(2_000))
        .keySerde(StringSerde.NAME).valueSerde(StringSerde.NAME)).block();
    var sorted = messagesService.loadSortedTopicMessages(cluster, topic, List.of(), null, 1,
        StringSerde.NAME, StringSerde.NAME, false, false, "size", "DESC")
        .filter(event -> event.getType() == TopicMessageEventDTO.TypeEnum.MESSAGE)
        .map(TopicMessageEventDTO::getMessage).collectList().block(Duration.ofSeconds(30));
    assertThat(sorted).hasSize(1);
    assertThat(sorted.getFirst().getPartition()).isEqualTo(1);
    assertThat(sorted.getFirst().getValue()).isEqualTo("z".repeat(2_000));
    messagesService.sendMessage(cluster, topic, new CreateTopicMessageDTO()
        .partition(0).key("key").value("a")
        .keySerde(StringSerde.NAME).valueSerde(StringSerde.NAME)).block();
    var smallest = messagesService.loadSortedTopicMessages(cluster, topic, List.of(), null, 1,
        StringSerde.NAME, StringSerde.NAME, false, false, "size", "ASC")
        .filter(event -> event.getType() == TopicMessageEventDTO.TypeEnum.MESSAGE)
        .map(TopicMessageEventDTO::getMessage).collectList().block(Duration.ofSeconds(30));
    assertThat(smallest).hasSize(1);
    assertThat(smallest.getFirst().getValue()).isEqualTo("a");
    var filtered = messagesService.loadSortedTopicMessages(cluster, topic, List.of("middle-"), null, 1,
        StringSerde.NAME, StringSerde.NAME, false, false, "offset", "DESC")
        .filter(event -> event.getType() == TopicMessageEventDTO.TypeEnum.MESSAGE)
        .map(TopicMessageEventDTO::getMessage).collectList().block(Duration.ofSeconds(30));
    assertThat(filtered).hasSize(1);
    assertThat(filtered.getFirst().getOffset()).isEqualTo(549L);
    assertThat(filtered.getFirst().getValue()).startsWith("middle-");
  }

  @Test
  void deleteTopicMessagesReturnsExceptionWhenTopicNotFound() {
    StepVerifier.create(messagesService.deleteTopicMessages(cluster, NON_EXISTING_TOPIC, List.of()))
        .expectError(TopicNotFoundException.class)
        .verify();
  }

  @Test
  void sendMessageReturnsExceptionWhenTopicNotFound() {
    StepVerifier.create(
            messagesService.sendMessage(cluster, NON_EXISTING_TOPIC, new CreateTopicMessageDTO()))
        .expectError(TopicNotFoundException.class)
        .verify();
  }

  @Test
  void previewMessageSerializesWithoutProducing() {
    String testTopic = MessagesServiceTest.class.getSimpleName() + UUID.randomUUID();
    createTopicWithCleanup(new NewTopic(testTopic, 1, (short) 1));

    var preview =
        messagesService
            .previewMessage(
                cluster,
                testTopic,
                new CreateTopicMessageDTO()
                    .partition(0)
                    .key("preview-key")
                    .value("preview-value")
                    .keySerde(StringSerde.NAME)
                    .valueSerde(StringSerde.NAME))
            .block();

    assertThat(preview).isNotNull();
    assertThat(preview.getCanSerialize()).isTrue();
    assertThat(preview.getKey().getStatus()).isEqualTo(MessageValidationStatusDTO.SERIALIZED);
    assertThat(preview.getValue().getStatus()).isEqualTo(MessageValidationStatusDTO.SERIALIZED);
    assertThat(preview.getValue().getSerializedBytes()).isEqualTo((long) "preview-value".length());
    assertThat(topicRecords(testTopic)).isEmpty();
  }

  @Test
  void previewMessageReportsSchemaValidationForSchemaRegistrySerde() throws Exception {
    String testTopic = MessagesServiceTest.class.getSimpleName() + UUID.randomUUID();
    createTopicWithCleanup(new NewTopic(testTopic, 1, (short) 1));
    AvroSchema schema =
        new AvroSchema(
            """
            {"type":"record","name":"Preview","fields":[{"name":"value","type":"string"}]}
            """);
    String keySubject = testTopic + "-key";
    String valueSubject = testTopic + "-value";

    try {
      schemaRegistry.schemaRegistryClient().register(keySubject, schema);
      schemaRegistry.schemaRegistryClient().register(valueSubject, schema);

      var preview =
          messagesService
              .previewMessage(
                  cluster,
                  testTopic,
                  new CreateTopicMessageDTO()
                      .partition(0)
                      .key("{\"value\":\"key\"}")
                      .value("{\"value\":\"value\"}")
                      .keySerde(SchemaRegistrySerde.NAME)
                      .valueSerde(SchemaRegistrySerde.NAME))
              .block();

      assertThat(preview).isNotNull();
      assertThat(preview.getCanSerialize()).isTrue();
      assertThat(preview.getKey().getStatus()).isEqualTo(MessageValidationStatusDTO.VALIDATED);
      assertThat(preview.getValue().getStatus()).isEqualTo(MessageValidationStatusDTO.VALIDATED);
      assertThat(preview.getValue().getSchema().getSubject()).isEqualTo(valueSubject);
      assertThat(preview.getValue().getSchema().getId()).isNotNull();
    } finally {
      schemaRegistry.schemaRegistryClient().deleteSubject(keySubject);
      schemaRegistry.schemaRegistryClient().deleteSubject(valueSubject);
    }
  }

  @Test
  void loadMessagesReturnsExceptionWhenTopicNotFound() {
    StepVerifier.create(
            messagesService.loadMessages(
                cluster,
                NON_EXISTING_TOPIC,
                new ConsumerPosition(
                    PollingModeDTO.TAILING, NON_EXISTING_TOPIC, List.of(), null, null),
                null,
                null,
                1,
                "String",
                "String"))
        .expectError(TopicNotFoundException.class)
        .verify();
  }

  @Test
  void downloadLastMessagesAsZipReturnsOneTextFilePerMessage() throws Exception {
    String testTopic = MessagesServiceTest.class.getSimpleName() + UUID.randomUUID();
    createTopicWithCleanup(new NewTopic(testTopic, 1, (short) 1));

    try (var producer = KafkaTestProducer.forKafka(kafka)) {
      producer.send(testTopic, "download-message-0");
      producer.send(testTopic, "download-message-1");
      producer.send(testTopic, "download-message-2").get();
    }

    byte[] zip =
        messagesService
            .downloadLastMessagesAsZip(
                cluster, testTopic, 2, List.of(), null, null, StringSerde.NAME, StringSerde.NAME)
            .block();

    Map<String, String> entries = unzip(zip);
    assertThat(entries).hasSize(2);
    assertThat(entries)
        .containsKeys(
            "2Offset-0Partition-" + testTopic + "-Topic.txt",
            "1Offset-0Partition-" + testTopic + "-Topic.txt");
    assertThat(entries.get("2Offset-0Partition-" + testTopic + "-Topic.txt"))
        .contains("Topic: " + testTopic)
        .contains("Partition: 0")
        .contains("Offset: 2")
        .contains("Payload:")
        .contains("download-message-2");
  }

  @Test
  void downloadLastMessagesAsZipReturnsReadmeForEmptyTopic() throws Exception {
    String testTopic = MessagesServiceTest.class.getSimpleName() + UUID.randomUUID();
    createTopicWithCleanup(new NewTopic(testTopic, 1, (short) 1));

    byte[] zip =
        messagesService
            .downloadLastMessagesAsZip(
                cluster, testTopic, 10, List.of(), null, null, StringSerde.NAME, StringSerde.NAME)
            .block();

    assertThat(unzip(zip))
        .containsEntry("README.txt", "No messages were found for topic " + testTopic + ".");
  }

  @Test
  void downloadLastMessagesAsZipRejectsInvalidLimit() {
    StepVerifier.create(
            messagesService.downloadLastMessagesAsZip(
                cluster, "topic", 0, List.of(), null, null, StringSerde.NAME, StringSerde.NAME))
        .expectErrorMatches(e -> e.getMessage().contains("Download limit must be between 1 and"))
        .verify();
  }

  @Test
  void downloadLimitUsesTheNewDefaultAndMaximum() {
    assertThat(messagesService.resolveDownloadLimit(null)).isEqualTo(5_000);
    assertThat(messagesService.resolveDownloadLimit(5_000)).isEqualTo(5_000);
    assertThatThrownBy(() -> messagesService.resolveDownloadLimit(5_001))
        .isInstanceOf(ValidationException.class)
        .hasMessage("Download limit must be between 1 and 5000");
  }

  @Test
  void downloadMessagesAppliesAllStringFilters() throws Exception {
    String testTopic = MessagesServiceTest.class.getSimpleName() + UUID.randomUUID();
    createTopicWithCleanup(new NewTopic(testTopic, 1, (short) 1));

    try (var producer = KafkaTestProducer.forKafka(kafka)) {
      producer.send(testTopic, "payment complete");
      producer.send(testTopic, "payment pending");
      producer.send(testTopic, "invoice complete").get();
    }

    var result =
        messagesService
            .downloadMessages(
                cluster,
                testTopic,
                10,
                List.of(),
                List.of("payment", "complete"),
                null,
                StringSerde.NAME,
                StringSerde.NAME,
                PollingModeDTO.EARLIEST,
                null,
                null,
                null,
                DownloadFormat.NDJSON)
            .block();

    assertThat(result).isNotNull();
    String content = new String(result.content(), StandardCharsets.UTF_8);
    assertThat(content).contains("payment complete");
    assertThat(content).doesNotContain("payment pending").doesNotContain("invoice complete");
  }

  @Test
  void downloadTimeWindowFiltersBeforeApplyingTheResultLimit() throws Exception {
    String topic = "search-window-" + UUID.randomUUID();
    createTopicWithCleanup(new NewTopic(topic, 1, (short) 1));
    long timestamp = System.currentTimeMillis();
    try (var producer = KafkaTestProducer.forKafka(kafka)) {
      producer.send(new ProducerRecord<>(topic, 0, timestamp + 1000, "key", "outside-window"));
      producer.send(new ProducerRecord<>(topic, 0, timestamp, "key", "inside-window")).get();
    }
    var result = messagesService.downloadMessages(
        cluster, topic, 1, List.of(), List.of(), null,
        StringSerde.NAME, StringSerde.NAME, PollingModeDTO.EARLIEST,
        null, null, timestamp, DownloadFormat.NDJSON).block(Duration.ofSeconds(10));
    assertThat(result).isNotNull();
    String content = new String(result.content(), StandardCharsets.UTF_8);
    assertThat(content.lines().count()).isEqualTo(1);
    assertThat(content).contains("inside-window").doesNotContain("outside-window");
  }

  @Test
  void downloadsTheUnionOfHeaderMatchesWithoutDuplicateMessages() throws Exception {
    String topic = "search-union-" + UUID.randomUUID();
    createTopicWithCleanup(new NewTopic(topic, 1, (short) 1));
    try (var producer = KafkaTestProducer.forKafka(kafka)) {
      var first = new ProducerRecord<String, String>(topic, "first");
      first.headers().add("trace", "request".getBytes(StandardCharsets.UTF_8));
      producer.send(first);
      var second = new ProducerRecord<String, String>(topic, "second");
      second.headers().add("request", "other".getBytes(StandardCharsets.UTF_8));
      producer.send(second);
      producer.send(topic, "trace request payload only").get();
    }
    var result = messagesService.downloadMessages(
        cluster, topic, 10, List.of(), List.of("trace", "request"), null,
        StringSerde.NAME, StringSerde.NAME, PollingModeDTO.EARLIEST,
        null, null, null, DownloadFormat.NDJSON, true, true).block();
    assertThat(result).isNotNull();
    String content = new String(result.content(), StandardCharsets.UTF_8);
    assertThat(content.lines().count()).isEqualTo(2);
    assertThat(content).contains("first", "second").doesNotContain("payload only");
  }

  @Test
  void deliversFiveHundredLiveSnapshotMatchesWithoutTheOldTwentyPerSecondThrottle() throws Exception {
    String topic = "live-speed-" + UUID.randomUUID();
    createTopicWithCleanup(new NewTopic(topic, 1, (short) 1));
    try (var producer = KafkaTestProducer.forKafka(kafka)) {
      for (int index = 0; index < 500; index++) {
        producer.send(topic, "match-" + index);
      }
    }
    var messages = messagesService.loadMessages(
        cluster, topic, ConsumerPosition.create(PollingModeDTO.TAILING, topic, List.of(), null, null),
        List.of("match"), null, 500, StringSerde.NAME, StringSerde.NAME)
        .filter(event -> event.getType() == TopicMessageEventDTO.TypeEnum.MESSAGE)
        .take(500)
        .collectList()
        .block(Duration.ofSeconds(5));
    assertThat(messages).hasSize(500);
  }

  @Test
  void maskingAppliedOnConfiguredClusters() throws Exception {
    String testTopic = MASKED_TOPICS_PREFIX + UUID.randomUUID();
    createTopicWithCleanup(new NewTopic(testTopic, 1, (short) 1));

    try (var producer = KafkaTestProducer.forKafka(kafka)) {
      producer.send(testTopic, "message1");
      producer.send(testTopic, "message2").get();
    }

    Flux<TopicMessageDTO> msgsFlux =
        messagesService
            .loadMessages(
                cluster,
                testTopic,
                new ConsumerPosition(PollingModeDTO.EARLIEST, testTopic, List.of(), null, null),
                null,
                null,
                100,
                StringSerde.NAME,
                StringSerde.NAME)
            .filter(evt -> evt.getType() == TopicMessageEventDTO.TypeEnum.MESSAGE)
            .map(TopicMessageEventDTO::getMessage);

    // both messages should be masked
    StepVerifier.create(msgsFlux)
        .expectNextMatches(msg -> msg.getValue().equals("***"))
        .expectNextMatches(msg -> msg.getValue().equals("***"))
        .verifyComplete();
  }

  @ParameterizedTest
  @CsvSource({"EARLIEST", "LATEST"})
  void cursorIsRegisteredAfterPollingIsDoneAndCanBeUsedForNextPagePolling(PollingModeDTO mode)
      throws Exception {
    String testTopic = MessagesServiceTest.class.getSimpleName() + UUID.randomUUID();
    int partitions = 5;
    createTopicWithCleanup(new NewTopic(testTopic, partitions, (short) 1));

    int msgsToGenerate = 100;
    int pageSize = (msgsToGenerate / 2) + 1;

    try (var producer = KafkaTestProducer.forKafka(kafka)) {
      for (int i = 0; i < msgsToGenerate; i++) {
        producer.send(new ProducerRecord<>(
            testTopic,
            i % partitions,
            null,
            "message_" + i)).get();
      }
    }

    var cursorIdCatcher = new AtomicReference<String>();
    Flux<String> msgsFlux =
        messagesService
            .loadMessages(
                cluster,
                testTopic,
                new ConsumerPosition(mode, testTopic, List.of(), null, null),
                null,
                null,
                pageSize,
                StringSerde.NAME,
                StringSerde.NAME)
            .doOnNext(
                evt -> {
                  if (evt.getType() == TopicMessageEventDTO.TypeEnum.DONE) {
                    assertThat(evt.getCursor()).isNotNull();
                    cursorIdCatcher.set(evt.getCursor().getId());
                  }
                })
            .filter(evt -> evt.getType() == TopicMessageEventDTO.TypeEnum.MESSAGE)
            .map(evt -> evt.getMessage().getValue());

    StepVerifier.create(msgsFlux).expectNextCount(pageSize).verifyComplete();

    assertThat(cursorIdCatcher.get()).isNotNull();

    Flux<String> remainingMsgs =
        messagesService
            .loadMessages(cluster, testTopic, cursorIdCatcher.get())
            .doOnNext(
                evt -> {
                  if (evt.getType() == TopicMessageEventDTO.TypeEnum.DONE) {
                    assertThat(evt.getCursor()).isNull();
                  }
                })
            .filter(evt -> evt.getType() == TopicMessageEventDTO.TypeEnum.MESSAGE)
            .map(evt -> evt.getMessage().getValue());

    StepVerifier.create(remainingMsgs).expectNextCount(msgsToGenerate - pageSize).verifyComplete();
  }

  private void createTopicWithCleanup(NewTopic newTopic) {
    createTopic(newTopic);
    createdTopics.add(newTopic.name());
  }

  private List<String> topicRecords(String topic) {
    Properties properties = new Properties();
    properties.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, kafka.getBootstrapServers());
    properties.put(ConsumerConfig.GROUP_ID_CONFIG, "preview-check-" + UUID.randomUUID());
    properties.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
    properties.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
    properties.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);

    try (KafkaConsumer<String, String> consumer = new KafkaConsumer<>(properties)) {
      TopicPartition partition = new TopicPartition(topic, 0);
      consumer.assign(List.of(partition));
      consumer.seekToBeginning(List.of(partition));
      return consumer.poll(Duration.ofSeconds(1)).records(partition).stream()
          .map(record -> record.value())
          .toList();
    }
  }

  private Map<String, String> unzip(byte[] zip) throws IOException {
    Map<String, String> entries = new LinkedHashMap<>();
    try (ZipInputStream zipInputStream =
        new ZipInputStream(new ByteArrayInputStream(zip), StandardCharsets.UTF_8)) {
      for (var entry = zipInputStream.getNextEntry();
          entry != null;
          entry = zipInputStream.getNextEntry()) {
        entries.put(
            entry.getName(), new String(zipInputStream.readAllBytes(), StandardCharsets.UTF_8));
        zipInputStream.closeEntry();
      }
    }
    return entries;
  }

  @Test
  void execSmartFilterTestReturnsExecutionResult() {
    var params =
        new SmartFilterTestExecutionDTO()
            .filterCode(
                "has(record.key) && has(record.value) && record.headers.size() != 0 "
                    + "&& has(record.timestampMs) && has(record.offset)")
            .key("1234")
            .value("{ \"some\" : \"value\" } ")
            .headers(Map.of("h1", "hv1"))
            .offset(12345L)
            .timestampMs(System.currentTimeMillis())
            .partition(1);

    var actual = execSmartFilterTest(params);
    assertThat(actual.getError()).isNull();
    assertThat(actual.getResult()).isTrue();

    params.setFilterCode("false");
    actual = execSmartFilterTest(params);
    assertThat(actual.getError()).isNull();
    assertThat(actual.getResult()).isFalse();
  }

  @Test
  void execSmartFilterTestCompilesToNonBooleanExpression() {
    var result = execSmartFilterTest(new SmartFilterTestExecutionDTO().filterCode("1/0"));
    assertThat(result.getResult()).isNull();
    assertThat(result.getError()).containsIgnoringCase("Compilation error");
  }

  @Test
  void execSmartFilterTestReturnsErrorOnFilterApplyError() {
    var result = execSmartFilterTest(new SmartFilterTestExecutionDTO().filterCode("1/0 == 1"));
    assertThat(result.getResult()).isNull();
    assertThat(result.getError()).containsIgnoringCase("execution error");
  }

  @Test
  void execSmartFilterTestReturnsErrorOnFilterCompilationError() {
    var result =
        execSmartFilterTest(
            new SmartFilterTestExecutionDTO().filterCode("this is invalid CEL syntax = 1"));
    assertThat(result.getResult()).isNull();
    assertThat(result.getError()).containsIgnoringCase("Compilation error");
  }

  @Test
  void sendMessageWithProtobufAnyType() {
    String jsonContent =
        """
        {
          "name": "testName",
          "payload": {
            "@type": "type.googleapis.com/test.PayloadMessage",
            "id": "123"
          }
        }
        """;

    CreateTopicMessageDTO testMessage =
        new CreateTopicMessageDTO()
            .key(null)
            .partition(0)
            .keySerde(StringSerde.NAME)
            .value(jsonContent)
            .valueSerde(ProtobufFileSerde.NAME);

    String testTopic = MASKED_TOPICS_PREFIX + UUID.randomUUID();
    createTopicWithCleanup(new NewTopic(testTopic, 5, (short) 1));

    StepVerifier.create(messagesService.sendMessage(cluster, testTopic, testMessage))
        .expectNextMatches(
            metadata ->
                metadata.topic().equals(testTopic)
                    && metadata.partition() == 0
                    && metadata.offset() >= 0)
        .verifyComplete();
  }
}
