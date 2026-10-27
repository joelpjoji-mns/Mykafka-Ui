package io.kafbat.ui.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.kafbat.ui.exception.ValidationException;
import io.kafbat.ui.model.TopicMessageDTO;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;

class SortedTopicMessagePagesTest {

  @Test
  void pagesAllSizeSortedMessagesAndRejectsMismatchedCursors() {
    var pages = new SortedTopicMessagePages();
    var writer = pages.newWriter();
    writer.append(message(0, 1, "small", 10));
    writer.append(message(0, 2, "large", 30));
    writer.append(message(1, 3, "medium", 20));

    var firstPage = writer.finish("cluster", "topic", "filters", 2, true);
    assertThat(firstPage.messages()).extracting(TopicMessageDTO::getValue)
        .containsExactly("large", "medium");
    assertThat(firstPage.nextCursor()).isNotNull();

    var secondPage =
        pages.readPage(firstPage.nextCursor(), "cluster", "topic", "filters", 2);
    assertThat(secondPage.pageNumber()).isEqualTo(2);
    assertThat(secondPage.totalMessages()).isEqualTo(3);
    assertThat(secondPage.messages())
        .extracting(TopicMessageDTO::getValue)
        .containsExactly("small");
    assertThat(secondPage.messages().getFirst().getTimestamp())
        .isEqualTo(OffsetDateTime.parse("2024-01-01T00:00:00Z"));
    assertThat(secondPage.nextCursor()).isNull();

    assertThatThrownBy(() ->
        pages.readPage(firstPage.nextCursor(), "other-cluster", "topic", "filters", 2))
        .isInstanceOf(ValidationException.class);
    pages.close();
  }

  @Test
  void doesNotCreateAPageCursorWhenAllResultsFitTheFirstPage() {
    var pages = new SortedTopicMessagePages();
    var writer = pages.newWriter();
    writer.append(message(0, 1, "first", 10));

    var page = writer.finish("cluster", "topic", "filters", 2, true);
    assertThat(page.nextCursor()).isNull();
    assertThat(page.messages()).extracting(TopicMessageDTO::getValue).containsExactly("first");
    pages.close();
  }

  @Test
  void splitsLargeMessagesAcrossByteBoundedPages() {
    var pages = new SortedTopicMessagePages();
    var writer = pages.newWriter();
    writer.append(message(0, 1, "large", 20_000_000));
    writer.append(message(0, 2, "medium", 10_000_000));
    writer.append(message(0, 3, "small", 5_000_000));

    var firstPage = writer.finish("cluster", "topic", "filters", 10, true);
    assertThat(firstPage.messages()).extracting(TopicMessageDTO::getValue)
        .containsExactly("large");

    var secondPage =
        pages.readPage(firstPage.nextCursor(), "cluster", "topic", "filters", 10);
    assertThat(secondPage.messages()).extracting(TopicMessageDTO::getValue)
        .containsExactly("medium", "small");
    assertThat(secondPage.nextCursor()).isNull();
    pages.close();
  }

  @Test
  void keepsTheBestBoundedPreviewAsTheScanGrows() {
    var pages = new SortedTopicMessagePages();
    var writer = pages.newWriter(true, 3);
    writer.append(message(0, 1, "small", 10));
    writer.append(message(0, 2, "largest", 50));
    writer.append(message(0, 3, "medium", 30));
    writer.append(message(0, 4, "large", 40));

    assertThat(writer.preview(3, Long.MAX_VALUE, true))
        .extracting(TopicMessageDTO::getValue)
        .containsExactly("largest", "large", "medium");

    writer.append(message(0, 5, "new-largest", 60));

    assertThat(writer.preview(3, Long.MAX_VALUE, true))
        .extracting(TopicMessageDTO::getValue)
        .containsExactly("new-largest", "largest", "large");
    writer.close();
    pages.close();
  }

  private static TopicMessageDTO message(int partition, long offset, String value, long size) {
    return new TopicMessageDTO()
        .partition(partition)
        .offset(offset)
        .timestamp(OffsetDateTime.parse("2024-01-01T00:00:00Z"))
        .value(value)
        .valueSize(size);
  }
}
