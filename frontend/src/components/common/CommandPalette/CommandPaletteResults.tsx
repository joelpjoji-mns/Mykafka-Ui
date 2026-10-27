import React, { useEffect, useMemo } from 'react';
import { useTopics } from 'lib/hooks/api/topics';
import { useConsumerGroups } from 'lib/hooks/api/consumers';
import { useGetSchemas } from 'lib/hooks/api/schemas';
import { useConnectors } from 'lib/hooks/api/kafkaConnect';
import {
  clusterConnectConnectorPath,
  clusterConsumerGroupDetailsPath,
  clusterSchemaPath,
  clusterTopicPath,
} from 'lib/paths';

import * as S from './CommandPalette.styled';
import CommandPaletteList, { PaletteItem } from './CommandPaletteList';

interface CommandPaletteResultsProps {
  clusterName: string;
  query: string;
  hasSchemaRegistry: boolean;
  hasKafkaConnect: boolean;
  highlightIndex: number;
  onItems: (items: PaletteItem[]) => void;
  onSelect: (to: string) => void;
}

const PAGE = 1;
const PER_PAGE = 15;

const CommandPaletteResults: React.FC<CommandPaletteResultsProps> = ({
  clusterName,
  query,
  hasSchemaRegistry,
  hasKafkaConnect,
  highlightIndex,
  onItems,
  onSelect,
}) => {
  const topics = useTopics({
    clusterName,
    search: query,
    page: PAGE,
    perPage: PER_PAGE,
  });
  const groups = useConsumerGroups({
    clusterName,
    search: query,
    page: PAGE,
    perPage: PER_PAGE,
  });
  const schemas = useGetSchemas(
    { clusterName, search: query, page: PAGE, perPage: PER_PAGE },
    { enabled: hasSchemaRegistry }
  );
  const connectors = useConnectors(clusterName, query, undefined, {
    enabled: hasKafkaConnect,
  });

  const items = useMemo<PaletteItem[]>(() => {
    const lowerQuery = query.toLowerCase();
    const list: PaletteItem[] = [];

    (topics.data?.topics ?? []).forEach((topic) =>
      list.push({
        type: 'Topic',
        label: topic.name,
        to: clusterTopicPath(clusterName, topic.name),
      })
    );
    (groups.data?.consumerGroups ?? []).forEach((group) =>
      list.push({
        type: 'Consumer group',
        label: group.groupId,
        to: clusterConsumerGroupDetailsPath(clusterName, group.groupId),
      })
    );
    (schemas.data?.schemas ?? []).forEach((schema) =>
      list.push({
        type: 'Schema',
        label: schema.subject,
        to: clusterSchemaPath(clusterName, schema.subject),
      })
    );
    (connectors.data ?? [])
      .filter((connector) => connector.name.toLowerCase().includes(lowerQuery))
      .forEach((connector) =>
        list.push({
          type: 'Connector',
          label: connector.name,
          to: clusterConnectConnectorPath(
            clusterName,
            connector.connect,
            connector.name
          ),
        })
      );

    return list;
  }, [
    topics.data,
    groups.data,
    schemas.data,
    connectors.data,
    clusterName,
    query,
  ]);

  useEffect(() => {
    onItems(items);
  }, [items, onItems]);

  const isFetching =
    topics.isFetching ||
    groups.isFetching ||
    (hasSchemaRegistry && schemas.isFetching) ||
    (hasKafkaConnect && connectors.isFetching);

  if (items.length === 0) {
    return (
      <S.Message>{isFetching ? 'Searching…' : 'No matches found'}</S.Message>
    );
  }

  return (
    <CommandPaletteList
      label="Command palette results"
      sections={[{ items }]}
      highlightIndex={highlightIndex}
      onSelect={onSelect}
    />
  );
};

export default CommandPaletteResults;
