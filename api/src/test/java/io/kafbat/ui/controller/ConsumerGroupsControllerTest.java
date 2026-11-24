package io.kafbat.ui.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.kafbat.ui.exception.ValidationException;
import io.kafbat.ui.model.PartitionOffsetDTO;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ConsumerGroupsControllerTest {

  @Test
  void mapsOffsetsAndDefaultsMissingOffsetsToZero() {
    var offsets = ConsumerGroupsController.toResetOffsets(
        List.of(
            new PartitionOffsetDTO().partition(2).offset(12L),
            new PartitionOffsetDTO().partition(5)));

    assertThat(offsets).containsExactly(Map.entry(2, 12L), Map.entry(5, 0L));
  }

  @Test
  void rejectsDuplicatePartitionOffsets() {
    assertThatThrownBy(() -> ConsumerGroupsController.toResetOffsets(
        List.of(
            new PartitionOffsetDTO().partition(3).offset(4L),
            new PartitionOffsetDTO().partition(3).offset(8L))))
        .isInstanceOf(ValidationException.class)
        .hasMessage("Duplicate partition offset for partition 3");
  }

  @Test
  void rejectsNegativePartitionNumbers() {
    assertThatThrownBy(() -> ConsumerGroupsController.toResetOffsets(
        List.of(new PartitionOffsetDTO().partition(-1).offset(0L))))
        .isInstanceOf(ValidationException.class)
        .hasMessage("Partition must be non-negative");
  }

  @Test
  void rejectsMissingPartitionNumbers() {
    assertThatThrownBy(() -> ConsumerGroupsController.toResetOffsets(
        List.of(new PartitionOffsetDTO().offset(0L))))
        .isInstanceOf(ValidationException.class)
        .hasMessage("Each partition offset must include a partition");
  }
}
