import React, { Suspense } from 'react';
import { Routes, Navigate, Route, Outlet } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import useAppParams from 'lib/hooks/useAppParams';
import { ClusterFeaturesEnum, ServerStatus } from 'generated-sources';
import {
  clusterBrokerRelativePath,
  clusterConsumerGroupsRelativePath,
  clusterOperationsRelativePath,
  clusterTopicGovernanceRelativePath,
  clusterAuditRelativePath,
  clusterRecordExplorerRelativePath,
  clusterKsqlDbRelativePath,
  ClusterNameRoute,
  clusterSchemasRelativePath,
  clusterTopicsRelativePath,
  clusterConfigRelativePath,
  getNonExactPath,
  clusterAclRelativePath,
  kafkaConnectRelativePath,
  clusterConnectorNewRelativePath,
  clusterConnectConnectorRelativePath,
} from 'lib/paths';
import ClusterContext from 'components/contexts/ClusterContext';
import PageLoader from 'components/common/PageLoader/PageLoader';
import { Button } from 'components/common/Button/Button';
import { clusterStatsQueryOptions, useClusters } from 'lib/hooks/api/clusters';
import { topicsQueryOptions } from 'lib/hooks/api/topics';
import { GlobalSettingsContext } from 'components/contexts/GlobalSettingsContext';
import { showServerError } from 'lib/errorHandling';
import { PER_PAGE } from 'lib/constants';
import { scheduleIdleTask } from 'lib/utils/scheduleIdleTask';
import New from 'components/Connect/New/New';
import SuspenseQueryComponent from 'components/common/SuspenseQueryComponent/SuspenseQueryComponent';
import DetailsPage from 'components/Connect/Details/DetailsPage';
import CommandPalette from 'components/common/CommandPalette/CommandPalette';

import * as S from './ClusterPage.styled';

const loadBrokers = () => import('components/Brokers/Brokers');
const loadTopics = () => import('components/Topics/Topics');
const loadSchemas = () => import('components/Schemas/Schemas');
const loadKafkaConnect = () => import('components/Connect/Connect');
const loadKsqlDb = () => import('components/KsqlDb/KsqlDb');
const loadClusterConfigPage = () =>
  import('components/ClusterPage/ClusterConfigPage');
const loadConsumerGroups = () =>
  import('components/ConsumerGroups/ConsumerGroups');
const loadOperationsCenter = () =>
  import('components/OperationsCenter/OperationsCenter');
const loadTopicGovernance = () =>
  import('components/TopicGovernance/TopicGovernance');
const loadAuditExplorer = () =>
  import('components/AuditExplorer/AuditExplorer');
const loadRecordExplorer = () =>
  import('components/RecordExplorer/RecordExplorer');
const loadAclPage = () => import('components/ACLPage/ACLPage');

const Brokers = React.lazy(loadBrokers);
const Topics = React.lazy(loadTopics);
const Schemas = React.lazy(loadSchemas);
const KafkaConnect = React.lazy(loadKafkaConnect);

const KsqlDb = React.lazy(loadKsqlDb);
const ClusterConfigPage = React.lazy(loadClusterConfigPage);
const ConsumerGroups = React.lazy(loadConsumerGroups);
const OperationsCenter = React.lazy(loadOperationsCenter);
const TopicGovernance = React.lazy(loadTopicGovernance);
const AuditExplorer = React.lazy(loadAuditExplorer);
const RecordExplorer = React.lazy(loadRecordExplorer);
const AclPage = React.lazy(loadAclPage);

const ClusterPage: React.FC = () => {
  const { clusterName } = useAppParams<ClusterNameRoute>();
  const appInfo = React.useContext(GlobalSettingsContext);
  const queryClient = useQueryClient();

  const { data, isFetched, isFetchedAfterMount, error, refetch } = useClusters({
    waitForCluster: clusterName,
  });
  const cluster = data?.find(({ name }) => name === clusterName);
  const connectionStatus = cluster?.connectionStatus ?? cluster?.status;
  const contextValue = React.useMemo(() => {
    const features = cluster?.features || [];
    return {
      isReadOnly: cluster?.readOnly || false,
      hasKafkaConnectConfigured: features.includes(
        ClusterFeaturesEnum.KAFKA_CONNECT
      ),
      hasSchemaRegistryConfigured: features.includes(
        ClusterFeaturesEnum.SCHEMA_REGISTRY
      ),
      isTopicDeletionAllowed: features.includes(
        ClusterFeaturesEnum.TOPIC_DELETION
      ),
      hasKsqlDbConfigured: features.includes(ClusterFeaturesEnum.KSQL_DB),
      hasAclViewConfigured:
        features.includes(ClusterFeaturesEnum.KAFKA_ACL_VIEW) ||
        features.includes(ClusterFeaturesEnum.KAFKA_ACL_EDIT),
      ftsEnabled: features.includes(ClusterFeaturesEnum.FTS_ENABLED),
      ftsDefaultEnabled: features.includes(
        ClusterFeaturesEnum.FTS_DEFAULT_ENABLED
      ),
      messageRelativeTimestamp: features.includes(
        ClusterFeaturesEnum.MESSAGE_RELATIVE_TIMESTAMP
      ),
    };
  }, [cluster]);
  const {
    ftsEnabled,
    ftsDefaultEnabled,
    hasSchemaRegistryConfigured,
    hasKafkaConnectConfigured,
    hasKsqlDbConfigured,
    hasAclViewConfigured,
  } = contextValue;

  React.useEffect(() => {
    if (connectionStatus !== ServerStatus.ONLINE) return undefined;

    return scheduleIdleTask(() => {
      const storedFts = localStorage.getItem('kafbat-ui_fts:topics');
      const ftsPreference =
        storedFts === null ? ftsDefaultEnabled : storedFts === 'true';
      const fts = ftsEnabled && ftsPreference;
      const topicListRequest = {
        clusterName,
        showInternal: !localStorage.getItem('hideInternalTopics'),
        page: 1,
        perPage: PER_PAGE,
        fts,
      };
      const routePreloads = [
        loadBrokers(),
        loadTopics().then(({ preloadTopicsRoutes }) => preloadTopicsRoutes()),
        loadConsumerGroups(),
        loadOperationsCenter(),
        loadTopicGovernance(),
        loadAuditExplorer(),
        loadRecordExplorer(),
        ...(hasSchemaRegistryConfigured ? [loadSchemas()] : []),
        ...(hasKafkaConnectConfigured ? [loadKafkaConnect()] : []),
        ...(hasKsqlDbConfigured ? [loadKsqlDb()] : []),
        ...(hasAclViewConfigured ? [loadAclPage()] : []),
        ...(appInfo.hasDynamicConfig ? [loadClusterConfigPage()] : []),
      ];

      Promise.all([
        Promise.all(routePreloads),
        queryClient.prefetchQuery(topicsQueryOptions(topicListRequest)),
        queryClient.prefetchQuery(clusterStatsQueryOptions(clusterName)),
      ]).catch(showServerError);
    });
  }, [
    appInfo.hasDynamicConfig,
    clusterName,
    connectionStatus,
    ftsDefaultEnabled,
    ftsEnabled,
    hasAclViewConfigured,
    hasKafkaConnectConfigured,
    hasKsqlDbConfigured,
    hasSchemaRegistryConfigured,
    queryClient,
  ]);

  if (
    !error &&
    connectionStatus !== ServerStatus.ONLINE &&
    (!(isFetchedAfterMount ?? isFetched) ||
      connectionStatus === ServerStatus.INITIALIZING)
  ) {
    return (
      <S.ConnectionPage role="status">
        <h2>Connecting to Kafka cluster {clusterName}...</h2>
        <p>Cluster pages will open when the connection is ready.</p>
      </S.ConnectionPage>
    );
  }

  if (!cluster || connectionStatus !== ServerStatus.ONLINE) {
    return (
      <S.ConnectionPage role="alert">
        <h2>Kafka cluster is not connected</h2>
        <p>
          Cluster pages will open after {clusterName} is reachable. The
          connection status is checked automatically.
        </p>
        <Button buttonType="secondary" buttonSize="M" onClick={() => refetch()}>
          Check connection
        </Button>
      </S.ConnectionPage>
    );
  }

  let clusterConfigPage: React.ReactNode = (
    <Navigate to={clusterBrokerRelativePath} replace />
  );
  if (appInfo.isLoading) {
    clusterConfigPage = <PageLoader />;
  } else if (appInfo.hasDynamicConfig) {
    clusterConfigPage = <ClusterConfigPage />;
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <ClusterContext.Provider value={contextValue}>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route
              path={getNonExactPath(clusterBrokerRelativePath)}
              element={<Brokers />}
            />
            <Route
              path={getNonExactPath(clusterTopicsRelativePath)}
              element={<Topics />}
            />
            <Route
              path={getNonExactPath(clusterConsumerGroupsRelativePath)}
              element={<ConsumerGroups />}
            />
            <Route
              path={clusterOperationsRelativePath}
              element={<OperationsCenter />}
            />
            <Route
              path={clusterTopicGovernanceRelativePath}
              element={<TopicGovernance />}
            />
            <Route
              path={clusterAuditRelativePath}
              element={<AuditExplorer />}
            />
            <Route
              path={clusterRecordExplorerRelativePath}
              element={<RecordExplorer />}
            />
            {contextValue.hasSchemaRegistryConfigured && (
              <Route
                path={getNonExactPath(clusterSchemasRelativePath)}
                element={<Schemas />}
              />
            )}
            {contextValue.hasKafkaConnectConfigured && (
              <Route path={clusterConnectorNewRelativePath} element={<New />} />
            )}
            {contextValue.hasKafkaConnectConfigured && (
              <Route
                path={getNonExactPath(clusterConnectConnectorRelativePath)}
                element={
                  <SuspenseQueryComponent>
                    <DetailsPage />
                  </SuspenseQueryComponent>
                }
              />
            )}
            {contextValue.hasKafkaConnectConfigured && (
              <Route
                path={getNonExactPath(kafkaConnectRelativePath)}
                element={<KafkaConnect />}
              />
            )}
            {contextValue.hasKsqlDbConfigured && (
              <Route
                path={getNonExactPath(clusterKsqlDbRelativePath)}
                element={<KsqlDb />}
              />
            )}
            {contextValue.hasAclViewConfigured && (
              <Route
                path={getNonExactPath(clusterAclRelativePath)}
                element={<AclPage />}
              />
            )}
            <Route
              path={getNonExactPath(clusterConfigRelativePath)}
              element={clusterConfigPage}
            />
            <Route
              path="/"
              element={<Navigate to={clusterBrokerRelativePath} replace />}
            />
          </Routes>
          <Outlet />
          <CommandPalette />
        </Suspense>
      </ClusterContext.Provider>
    </Suspense>
  );
};

export default ClusterPage;
