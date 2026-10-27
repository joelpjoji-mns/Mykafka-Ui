import React from 'react';
import { useConnects } from 'lib/hooks/api/kafkaConnect';
import useAppParams from 'lib/hooks/useAppParams';
import { ClusterNameRoute } from 'lib/paths';
import PageLoader from 'components/common/PageLoader/PageLoader';
import ErrorPage from 'components/ErrorPage/ErrorPage';

import ClustersStatistics from './ui/Statistics/Statistics';
import List from './ui/List/List';

const KafkaConnectClustersPage = () => {
  const { clusterName } = useAppParams<ClusterNameRoute>();
  const connects = useConnects(clusterName, true);
  const hasData = connects.data !== undefined;
  const isInitialLoading = connects.isLoading && !hasData;

  return (
    <>
      {isInitialLoading && <PageLoader offsetY={300} />}

      {connects.error && !hasData && (
        <ErrorPage
          offsetY={300}
          status={connects.error.status}
          onClick={connects.refetch}
          text={connects.error.message}
        />
      )}

      {hasData && (
        <>
          <ClustersStatistics
            connects={connects.data ?? []}
            isLoading={isInitialLoading}
          />
          <List connects={connects.data ?? []} />
        </>
      )}
    </>
  );
};

export default KafkaConnectClustersPage;
