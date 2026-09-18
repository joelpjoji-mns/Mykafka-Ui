import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTopicMessages } from 'lib/hooks/api/topicMessages';
import useAppParams from 'lib/hooks/useAppParams';
import { RouteParamsClusterTopic } from 'lib/paths';
import { MessagesFilterKeys } from 'lib/constants';
import { saveMessageViewFilterSnapshot } from 'lib/messageViewFilterSnapshot';

import MessagesTable from './MessagesTable';
import Filters from './Filters/Filters';

const Messages: React.FC = () => {
  const { clusterName, topicName } = useAppParams<RouteParamsClusterTopic>();
  const [searchParams, setSearchParams] = useSearchParams();
  const stringFilters = React.useMemo(() => {
    const filters = searchParams.getAll(MessagesFilterKeys.stringFilter);
    return filters[0] ? filters.slice(1).filter(Boolean) : [];
  }, [searchParams]);

  React.useEffect(() => {
    saveMessageViewFilterSnapshot(clusterName, topicName, searchParams);
  }, [clusterName, topicName, searchParams]);

  const setStringFilter = React.useCallback(
    (index: number, value: string) => {
      setSearchParams((params) => {
        const filters = params.getAll(MessagesFilterKeys.stringFilter);
        const primaryFilter = filters[0];

        if (!primaryFilter) {
          return params;
        }

        params.delete(MessagesFilterKeys.cursor);
        const nextStringFilters = value
          ? filters.slice(1)
          : filters.slice(1, index + 1);
        if (value) {
          nextStringFilters[index] = value;
        }

        params.delete(MessagesFilterKeys.stringFilter);
        params.append(MessagesFilterKeys.stringFilter, primaryFilter);
        nextStringFilters.filter(Boolean).forEach((stringFilter) => {
          params.append(MessagesFilterKeys.stringFilter, stringFilter);
        });

        return params;
      });
    },
    [setSearchParams]
  );

  const {
    messages,
    isFetching,
    consumptionStats,
    phase,
    isLiveStreamReady,
    abortFetchData,
  } = useTopicMessages({
    clusterName,
    topicName,
    stringFilters,
  });

  return (
    <>
      <Filters
        consumptionStats={consumptionStats}
        isFetching={isFetching}
        phaseMessage={phase}
        abortFetchData={abortFetchData}
        stringFilters={stringFilters}
        setStringFilter={setStringFilter}
      />
      <MessagesTable
        messages={messages}
        isFetching={isFetching}
        animateLiveArrivals={isLiveStreamReady}
      />
    </>
  );
};

export default Messages;
