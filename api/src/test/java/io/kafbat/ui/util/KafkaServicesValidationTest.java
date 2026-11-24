package io.kafbat.ui.util;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.kafbat.ui.model.ApplicationPropertyValidationDTO;
import io.kafbat.ui.sr.api.KafkaSrClientApi;
import java.util.function.Supplier;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

class KafkaServicesValidationTest {

  @Test
  void validatorsDoNotExposeRemoteErrorDetails() {
    Stream.of(
            KafkaServicesValidation.validateSchemaRegistry(this::failingClient),
            KafkaServicesValidation.validateConnect(this::failingClient),
            KafkaServicesValidation.validateKsql(this::failingClient),
            KafkaServicesValidation.validatePrometheusStore(this::failingClient))
        .forEach(result -> assertFixedError(result, "Error validating service. See logs for details."));
  }

  @Test
  void validatorDoesNotExposeClientCreationErrorDetails() {
    Supplier<ReactiveFailover<KafkaSrClientApi>> failingSupplier = () -> {
      throw new IllegalStateException("sensitive remote details");
    };

    assertFixedError(
        KafkaServicesValidation.validateSchemaRegistry(failingSupplier),
        "Error creating Schema Registry client. See logs for details.");
  }

  @SuppressWarnings("unchecked")
  private <T> ReactiveFailover<T> failingClient() {
    ReactiveFailover<T> client = mock(ReactiveFailover.class);
    when(client.mono(any())).thenReturn(Mono.error(new RuntimeException("sensitive remote details")));
    when(client.flux(any())).thenReturn(Flux.error(new RuntimeException("sensitive remote details")));
    return client;
  }

  private static void assertFixedError(Mono<ApplicationPropertyValidationDTO> result, String expectedMessage) {
    StepVerifier.create(result)
        .assertNext(dto -> {
          assertThat(dto.getError()).isTrue();
          assertThat(dto.getErrorMessage()).isEqualTo(expectedMessage);
        })
        .verifyComplete();
  }
}
