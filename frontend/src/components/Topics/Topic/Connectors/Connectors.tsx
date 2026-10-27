import React from 'react';
import { ConnectorsTable } from 'components/Connect/List/ConnectorsTable/ConnectorsTable';
import { FilteredConnectorsProvider } from 'components/Connect/model/FilteredConnectorsProvider';
import { useTopicConnectors } from 'lib/hooks/api/topics';
import useAppParams from 'lib/hooks/useAppParams';
import { RouteParamsClusterTopic } from 'lib/paths';

const Connectors: React.FC = () => {
  const { clusterName, topicName } = useAppParams<RouteParamsClusterTopic>();
  const { data: connectors = [] } = useTopicConnectors({
    clusterName,
    topicName,
  });

  return (
    <FilteredConnectorsProvider>
      <ConnectorsTable
        columnVisibility={{ topics: false }}
        connectors={connectors}
        columnSizingPersistKey="topic-connectors"
      />
    </FilteredConnectorsProvider>
  );
};

export default Connectors;
