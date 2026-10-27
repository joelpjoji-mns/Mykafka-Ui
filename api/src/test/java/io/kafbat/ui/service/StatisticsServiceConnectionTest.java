package io.kafbat.ui.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.kafbat.ui.model.KafkaCluster;
import io.kafbat.ui.model.ServerStatusDTO;
import io.kafbat.ui.service.ReactiveAdminClient.ClusterDescription;
import java.util.List;
import java.util.Set;
import org.apache.kafka.common.errors.TimeoutException;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

class StatisticsServiceConnectionTest {

  @Test
  void marksTheClusterConnectedBeforeTheFullStatisticsScrapeCompletes() {
    KafkaCluster cluster = KafkaCluster.builder().name("test-cluster").build();
    ClustersStorage clustersStorage = mock(ClustersStorage.class);
    when(clustersStorage.getKafkaClusters()).thenReturn(List.of(cluster));
    StatisticsCache cache = new StatisticsCache(clustersStorage);
    AdminClientService adminClientService = mock(AdminClientService.class);
    ReactiveAdminClient adminClient = mock(ReactiveAdminClient.class);
    KafkaConnectService kafkaConnectService = mock(KafkaConnectService.class);
    FeatureService featureService = mock(FeatureService.class);
    ClusterDescription description = new ClusterDescription(null, "cluster-id", List.of(), Set.of());

    when(adminClientService.get(cluster)).thenReturn(Mono.just(adminClient));
    when(adminClient.describeCluster()).thenReturn(Mono.just(description));
    doReturn(Mono.empty()).when(adminClient).updateInternalStats(null);
    when(featureService.getAvailableFeatures(adminClient, cluster, description))
        .thenReturn(Mono.just(List.of()));
    when(adminClient.describeLogDirs(anyCollection())).thenReturn(Mono.never());
    when(adminClient.listConsumerGroups()).thenReturn(Mono.never());
    when(adminClient.describeTopics()).thenReturn(Mono.never());
    when(adminClient.getTopicsConfig()).thenReturn(Mono.never());
    when(adminClient.describeMetadataQuorum()).thenReturn(Mono.never());
    when(kafkaConnectService.scrapeAllConnects(any())).thenReturn(Flux.never());

    StatisticsService service = new StatisticsService(
        adminClientService,
        kafkaConnectService,
        featureService,
        cache,
        new io.kafbat.ui.config.ClustersProperties(),
        mock(io.kafbat.ui.mapper.QuorumInfoMapper.class)
    );
    var update = service.updateCache(cluster).subscribe();
    try {
      assertThat(cache.get(cluster).getConnectionStatus()).isEqualTo(ServerStatusDTO.ONLINE);
      assertThat(cache.get(cluster).getStatus()).isEqualTo(ServerStatusDTO.INITIALIZING);
    } finally {
      update.dispose();
    }
  }

  @Test
  void keepsConnectionOnlineWhenStatisticsFailAfterDescribeClusterSucceeds() {
    KafkaCluster cluster = KafkaCluster.builder().name("test-cluster").build();
    ClustersStorage clustersStorage = mock(ClustersStorage.class);
    when(clustersStorage.getKafkaClusters()).thenReturn(List.of(cluster));
    StatisticsCache cache = new StatisticsCache(clustersStorage);
    AdminClientService adminClientService = mock(AdminClientService.class);
    ReactiveAdminClient adminClient = mock(ReactiveAdminClient.class);
    KafkaConnectService kafkaConnectService = mock(KafkaConnectService.class);
    FeatureService featureService = mock(FeatureService.class);
    ClusterDescription description = new ClusterDescription(null, "cluster-id", List.of(), Set.of());

    when(adminClientService.get(cluster)).thenReturn(Mono.just(adminClient));
    when(adminClient.describeCluster()).thenReturn(Mono.just(description));
    doReturn(Mono.empty()).when(adminClient).updateInternalStats(null);
    when(featureService.getAvailableFeatures(adminClient, cluster, description))
        .thenReturn(Mono.just(List.of()));
    when(adminClient.describeLogDirs(anyCollection())).thenReturn(Mono.never());
    when(adminClient.listConsumerGroups()).thenReturn(Mono.never());
    when(adminClient.describeTopics()).thenReturn(Mono.never());
    when(adminClient.getTopicsConfig()).thenReturn(Mono.never());
    when(adminClient.describeMetadataQuorum()).thenReturn(Mono.error(
        new TimeoutException("Timed out waiting for a node assignment")));
    when(kafkaConnectService.scrapeAllConnects(any())).thenReturn(Flux.never());

    StatisticsService service = new StatisticsService(
        adminClientService,
        kafkaConnectService,
        featureService,
        cache,
        new io.kafbat.ui.config.ClustersProperties(),
        mock(io.kafbat.ui.mapper.QuorumInfoMapper.class)
    );

    var result = service.updateCache(cluster).block(java.time.Duration.ofSeconds(2));

    assertThat(result).isNotNull();
    assertThat(result.getStatus()).isEqualTo(ServerStatusDTO.OFFLINE);
    assertThat(result.getConnectionStatus()).isEqualTo(ServerStatusDTO.ONLINE);
    assertThat(cache.get(cluster).getConnectionStatus()).isEqualTo(ServerStatusDTO.ONLINE);
  }

  @Test
  void marksConnectionOfflineWhenDescribeClusterCannotConnect() {
    KafkaCluster cluster = KafkaCluster.builder().name("test-cluster").build();
    ClustersStorage clustersStorage = mock(ClustersStorage.class);
    when(clustersStorage.getKafkaClusters()).thenReturn(List.of(cluster));
    StatisticsCache cache = new StatisticsCache(clustersStorage);
    AdminClientService adminClientService = mock(AdminClientService.class);
    ReactiveAdminClient adminClient = mock(ReactiveAdminClient.class);
    KafkaConnectService kafkaConnectService = mock(KafkaConnectService.class);
    FeatureService featureService = mock(FeatureService.class);

    when(adminClientService.get(cluster)).thenReturn(Mono.just(adminClient));
    when(adminClient.describeCluster()).thenReturn(Mono.error(
        new TimeoutException("Timed out waiting for a node assignment")));

    StatisticsService service = new StatisticsService(
        adminClientService,
        kafkaConnectService,
        featureService,
        cache,
        new io.kafbat.ui.config.ClustersProperties(),
        mock(io.kafbat.ui.mapper.QuorumInfoMapper.class)
    );

    var result = service.updateCache(cluster).block(java.time.Duration.ofSeconds(2));

    assertThat(result).isNotNull();
    assertThat(result.getStatus()).isEqualTo(ServerStatusDTO.OFFLINE);
    assertThat(result.getConnectionStatus()).isEqualTo(ServerStatusDTO.OFFLINE);
    assertThat(cache.get(cluster).getConnectionStatus()).isEqualTo(ServerStatusDTO.OFFLINE);
  }
}
