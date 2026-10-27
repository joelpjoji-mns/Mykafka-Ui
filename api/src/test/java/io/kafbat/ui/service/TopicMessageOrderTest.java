package io.kafbat.ui.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.kafbat.ui.exception.ValidationException;
import io.kafbat.ui.model.TopicMessageConsumingDTO;
import io.kafbat.ui.model.TopicMessageDTO;
import io.kafbat.ui.model.TopicMessageEventDTO;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Flux;

class TopicMessageOrderTest {
  @Test
  void sortsAllColumnsAndUsesPartitionOffsetForTies() {
    var small = new TopicMessageDTO().partition(0).offset(1L).key("a").value("a")
        .keySize(1L).valueSize(2L).headersSize(3L).headers(Map.of("id", "a"))
        .timestamp(OffsetDateTime.parse("2024-01-01T00:00:00Z"));
    var large = new TopicMessageDTO().partition(1).offset(2L).key("z").value("z")
        .keySize(10L).valueSize(20L).headersSize(30L).headers(Map.of("id", "z"))
        .timestamp(OffsetDateTime.parse("2024-02-01T00:00:00Z"));
    for (String column : List.of("id", "offset", "partition", "timestamp", "size", "key", "value", "headers")) {
      assertThat(List.of(large, small).stream().sorted(MessagesService.topicMessageOrder(column, "ASC")))
          .containsExactly(small, large);
      assertThat(List.of(small, large).stream().sorted(MessagesService.topicMessageOrder(column, "DESC")))
          .containsExactly(large, small);
    }
    var tied = new TopicMessageDTO().partition(1).offset(10L).key("a");
    assertThat(MessagesService.topicMessageOrder("key", "ASC").compare(small, tied)).isNegative();
  }

  @Test
  void handlesNullFieldsAndRejectsInvalidSorting() {
    var empty = new TopicMessageDTO().partition(0).offset(0L);
    var text = new TopicMessageDTO().partition(0).offset(1L).key("text").valueSize(1L);
    assertThat(MessagesService.topicMessageOrder("key", "ASC").compare(empty, text)).isNegative();
    assertThat(MessagesService.topicMessageOrder("size", "ASC").compare(empty, text)).isNegative();
    assertThatThrownBy(() -> MessagesService.topicMessageOrder("unknown", "ASC"))
        .isInstanceOf(ValidationException.class);
    assertThatThrownBy(() -> MessagesService.topicMessageOrder("size", "unknown"))
        .isInstanceOf(ValidationException.class);
  }

  @Test
  void emitsProvisionalTopResultsAndReplacesThemWithTheFinalRanking() {
    var scanEvents = new ArrayList<TopicMessageEventDTO>();
    for (int size = 0; size < 1_000; size++) {
      scanEvents.add(messageEvent(size));
    }
    scanEvents.add(messageEvent(5_000));
    scanEvents.add(new TopicMessageEventDTO()
        .type(TopicMessageEventDTO.TypeEnum.DONE)
        .consuming(new TopicMessageConsumingDTO().filterApplyErrors(0)));

    var events = MessagesService.sortScannedMessages(
        Flux.fromIterable(scanEvents), MessagesService.topicMessageOrder("size", "DESC"), 2)
        .collectList()
        .block();

    int provisionalIndex = phaseIndex(events, "Provisional sort results");
    assertThat(provisionalIndex).isGreaterThanOrEqualTo(0);
    assertThat(messageSizes(events.subList(provisionalIndex + 1, provisionalIndex + 3)))
        .containsExactly(999L, 998L);

    int finalIndex = phaseIndex(events, "Final sort results");
    assertThat(finalIndex).isGreaterThan(provisionalIndex);
    assertThat(messageSizes(events.subList(finalIndex + 1, finalIndex + 3)))
        .containsExactly(5_000L, 999L);
  }

  @Test
  void emitsProvisionalRowsForNarrowFiltersAsTheFullScanProgresses() {
    var scanEvents = List.of(
        consumingEvent(1_000),
        messageEvent(10),
        consumingEvent(11_000),
        new TopicMessageEventDTO()
            .type(TopicMessageEventDTO.TypeEnum.DONE)
            .consuming(new TopicMessageConsumingDTO().filterApplyErrors(0)));

    var events = MessagesService.sortScannedMessages(
        Flux.fromIterable(scanEvents), MessagesService.topicMessageOrder("size", "DESC"), 1)
        .collectList()
        .block();

    int provisionalIndex = phaseIndex(events, "Provisional sort results");
    assertThat(provisionalIndex).isGreaterThanOrEqualTo(0);
    assertThat(events.get(provisionalIndex + 1).getType())
        .isEqualTo(TopicMessageEventDTO.TypeEnum.MESSAGE);
    assertThat(events.get(provisionalIndex + 1).getMessage().getValue()).isEqualTo("value-10");
  }

  @Test
  void returnsANextPageCursorForTheRemainingSizeSortedMessages() {
    var pages = new SortedTopicMessagePages();
    var writer = pages.newWriter();
    var scanEvents = List.of(
        messageEvent(10),
        messageEvent(30),
        messageEvent(20),
        new TopicMessageEventDTO()
            .type(TopicMessageEventDTO.TypeEnum.DONE)
            .consuming(new TopicMessageConsumingDTO().filterApplyErrors(0)));

    var events = MessagesService.scanAndSortMessages(
        Flux.fromIterable(scanEvents),
        MessagesService.topicMessageOrder("size", "DESC"),
        2,
        writer,
        "cluster",
        "topic",
        "signature",
        true).collectList().block();

    var done = events.stream()
        .filter(event -> event.getType() == TopicMessageEventDTO.TypeEnum.DONE)
        .findFirst()
        .orElseThrow();
    assertThat(done.getCursor()).isNotNull();

    var nextPage = pages.readPage(done.getCursor().getId(), "cluster", "topic", "signature", 2);
    assertThat(nextPage.messages()).extracting(TopicMessageDTO::getValue)
        .containsExactly("value-10");
    assertThat(nextPage.nextCursor()).isNull();
    pages.close();
  }

  private TopicMessageEventDTO messageEvent(long size) {
    return new TopicMessageEventDTO()
        .type(TopicMessageEventDTO.TypeEnum.MESSAGE)
        .message(new TopicMessageDTO()
            .partition(0)
            .offset(size)
            .value("value-" + size)
            .valueSize(size));
  }

  private TopicMessageEventDTO consumingEvent(int messagesConsumed) {
    return new TopicMessageEventDTO()
        .type(TopicMessageEventDTO.TypeEnum.CONSUMING)
        .consuming(new TopicMessageConsumingDTO()
            .messagesConsumed(messagesConsumed)
            .filterApplyErrors(0));
  }

  private int phaseIndex(List<TopicMessageEventDTO> events, String phaseName) {
    for (int index = 0; index < events.size(); index++) {
      var event = events.get(index);
      if (event.getType() == TopicMessageEventDTO.TypeEnum.PHASE
          && phaseName.equals(event.getPhase().getName())) {
        return index;
      }
    }
    return -1;
  }

  private List<Long> messageSizes(List<TopicMessageEventDTO> events) {
    return events.stream()
        .filter(event -> event.getType() == TopicMessageEventDTO.TypeEnum.MESSAGE)
        .map(event -> event.getMessage().getValueSize())
        .toList();
  }
}
