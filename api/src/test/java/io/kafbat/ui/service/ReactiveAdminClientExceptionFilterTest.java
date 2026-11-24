package io.kafbat.ui.service;

import static io.kafbat.ui.service.ReactiveAdminClient.toMonoWithExceptionFilter;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.apache.kafka.common.KafkaException;
import org.apache.kafka.common.errors.UnknownTopicOrPartitionException;
import org.apache.kafka.common.internals.KafkaFutureImpl;
import org.junit.jupiter.api.Test;
import reactor.test.StepVerifier;

class ReactiveAdminClientExceptionFilterTest {

  @Test
  void suppressesErrorsThatAreSubtypesOfConfiguredException() {
    KafkaFutureImpl<String> failedFuture = new KafkaFutureImpl<>();
    failedFuture.completeExceptionally(new UnknownTopicOrPartitionException());

    StepVerifier.create(toMonoWithExceptionFilter(Map.of("missing", failedFuture), KafkaException.class))
        .assertNext(result -> assertThat(result).isEmpty())
        .verifyComplete();
  }
}
