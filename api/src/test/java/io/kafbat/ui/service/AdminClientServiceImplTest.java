package io.kafbat.ui.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.kafbat.ui.config.ClustersProperties;
import io.kafbat.ui.model.KafkaCluster;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import org.apache.kafka.common.errors.TimeoutException;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

class AdminClientServiceImplTest {

  @Test
  void sharesAnInFlightAdminClientCreation() {
    ReactiveAdminClient client = Mockito.mock(ReactiveAdminClient.class);
    AtomicInteger creations = new AtomicInteger();
    AdminClientServiceImpl service = new AdminClientServiceImpl(new ClustersProperties()) {
      @Override
      Mono<ReactiveAdminClient> createAdminClient(KafkaCluster cluster) {
        creations.incrementAndGet();
        return Mono.delay(Duration.ofMillis(50)).thenReturn(client);
      }
    };
    KafkaCluster cluster = KafkaCluster.builder().name("test-cluster").build();

    var clients = Flux.merge(service.get(cluster), service.get(cluster))
        .collectList()
        .block(Duration.ofSeconds(2));

    assertThat(clients).containsExactly(client, client);
    assertThat(creations).hasValue(1);
    assertThat(service.get(cluster).block()).isSameAs(client);
    assertThat(creations).hasValue(1);
  }

  @Test
  void retriesAdminClientCreationAfterAFailure() {
    ReactiveAdminClient client = Mockito.mock(ReactiveAdminClient.class);
    AtomicInteger attempts = new AtomicInteger();
    AdminClientServiceImpl service = new AdminClientServiceImpl(new ClustersProperties()) {
      @Override
      Mono<ReactiveAdminClient> createAdminClient(KafkaCluster cluster) {
        return Mono.defer(() -> attempts.incrementAndGet() == 1
            ? Mono.error(new IllegalStateException("connection failed"))
            : Mono.just(client));
      }
    };
    KafkaCluster cluster = KafkaCluster.builder().name("test-cluster").build();

    assertThatThrownBy(() -> service.get(cluster).block())
        .hasMessage("connection failed");

    assertThat(service.get(cluster).block()).isSameAs(client);
    assertThat(attempts).hasValue(2);
  }

  @Test
  void keepsTheSharedAdminClientAfterARequestTimeout() {
    ReactiveAdminClient client = Mockito.mock(ReactiveAdminClient.class);
    AtomicInteger creations = new AtomicInteger();
    AdminClientServiceImpl service = new AdminClientServiceImpl(new ClustersProperties()) {
      @Override
      Mono<ReactiveAdminClient> createAdminClient(KafkaCluster cluster) {
        creations.incrementAndGet();
        return Mono.just(client);
      }
    };
    KafkaCluster cluster = KafkaCluster.builder().name("test-cluster").build();

    service.get(cluster).block();
    service.invalidate(
        cluster,
        client,
        new TimeoutException("Timed out waiting for a node assignment"));

    assertThat(service.get(cluster).block()).isSameAs(client);
    assertThat(creations).hasValue(1);
    Mockito.verify(client, Mockito.never()).close();
  }

  @Test
  void replacesOnlyTheAdminClientWhoseThreadHasExited() {
    ReactiveAdminClient failedClient = Mockito.mock(ReactiveAdminClient.class);
    ReactiveAdminClient replacementClient = Mockito.mock(ReactiveAdminClient.class);
    AtomicInteger creations = new AtomicInteger();
    AdminClientServiceImpl service = new AdminClientServiceImpl(new ClustersProperties()) {
      @Override
      Mono<ReactiveAdminClient> createAdminClient(KafkaCluster cluster) {
        return Mono.just(creations.getAndIncrement() == 0 ? failedClient : replacementClient);
      }
    };
    KafkaCluster cluster = KafkaCluster.builder().name("test-cluster").build();

    assertThat(service.get(cluster).block()).isSameAs(failedClient);
    service.invalidate(
        cluster,
        failedClient,
        new TimeoutException("The AdminClient thread has exited. Call: describeMetadataQuorum"));

    assertThat(service.get(cluster).block()).isSameAs(replacementClient);
    Mockito.verify(failedClient).close();

    service.invalidate(
        cluster,
        failedClient,
        new TimeoutException("The AdminClient thread has exited. Call: describeMetadataQuorum"));

    assertThat(service.get(cluster).block()).isSameAs(replacementClient);
    Mockito.verify(replacementClient, Mockito.never()).close();
  }
}
