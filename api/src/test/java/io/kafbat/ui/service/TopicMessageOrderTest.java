package io.kafbat.ui.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.kafbat.ui.exception.ValidationException;
import io.kafbat.ui.model.TopicMessageDTO;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

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
}
