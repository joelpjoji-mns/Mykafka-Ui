package io.kafbat.ui.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.kafbat.ui.model.KafkaCluster;
import io.kafbat.ui.model.Statistics;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import reactor.core.publisher.Mono;

class ClustersStatisticsSchedulerTest {

  @Test
  void limitsConcurrentClusterRefreshes() {
    var clustersStorage = Mockito.mock(ClustersStorage.class);
    var statisticsService = Mockito.mock(StatisticsService.class);
    var scheduler = new ClustersStatisticsScheduler(
        clustersStorage,
        statisticsService,
        2
    );
    var clusters = List.of(
        KafkaCluster.builder().name("one").build(),
        KafkaCluster.builder().name("two").build(),
        KafkaCluster.builder().name("three").build(),
        KafkaCluster.builder().name("four").build()
    );
    var inFlight = new AtomicInteger();
    var maximumInFlight = new AtomicInteger();

    when(clustersStorage.getKafkaClusters()).thenReturn(clusters);
    when(statisticsService.updateCache(Mockito.any())).thenAnswer(invocation -> {
      int currentInFlight = inFlight.incrementAndGet();
      maximumInFlight.accumulateAndGet(currentInFlight, Math::max);
      return Mono.delay(Duration.ofMillis(10))
          .then(Mono.<Statistics>empty())
          .doOnTerminate(inFlight::decrementAndGet);
    });

    scheduler.updateStatistics();

    verify(statisticsService, times(clusters.size())).updateCache(Mockito.any());
    assertThat(maximumInFlight).hasValue(2);
  }
}