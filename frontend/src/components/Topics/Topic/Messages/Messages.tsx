import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTopicMessages } from 'lib/hooks/api/topicMessages';
import useAppParams from 'lib/hooks/useAppParams';
import { RouteParamsClusterTopic } from 'lib/paths';
import { MessagesFilterKeys } from 'lib/constants';
import { saveMessageViewFilterSnapshot } from 'lib/messageViewFilterSnapshot';
import PageLoader from 'components/common/PageLoader/PageLoader';

import MessagesTable from './MessagesTable';
import Filters from './Filters/Filters';
import SearchControls, { getSearchQueryKey } from './SearchControls';

const MessageResults: React.FC<{
  searchPage?: boolean;
  enabled?: boolean;
  pending?: boolean;
}> = ({ searchPage = false, enabled = true, pending = false }) => {
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
    isProvisionalRanking,
    phase,
    isLiveStreamReady,
    isLivePaused,
    pausedArrivals,
    pauseLive,
    resumeLive,
    abortFetchData,
  } = useTopicMessages({
    clusterName,
    topicName,
    stringFilters,
    enabled,
  });

  const filters = (
    <Filters
      consumptionStats={consumptionStats}
      isFetching={pending || isFetching}
      phaseMessage={phase}
      abortFetchData={abortFetchData}
      stringFilters={stringFilters}
      setStringFilter={setStringFilter}
      hideSearch={searchPage}
    />
  );

  return (
    <>
      {searchPage ? (
        <details style={{ margin: '12px 16px' }}>
          <summary>Advanced filters</summary>
          {filters}
        </details>
      ) : (
        filters
      )}
      <MessagesTable
        messages={messages}
        isFetching={pending || isFetching}
        isProvisionalRanking={isProvisionalRanking}
        animateLiveArrivals={isLiveStreamReady}
        abortFetchData={abortFetchData}
        consumptionStats={consumptionStats}
        isLivePaused={isLivePaused}
        pausedArrivals={pausedArrivals}
        onPauseLive={pauseLive}
        onResumeLive={resumeLive}
      />
    </>
  );
};

const SearchPage: React.FC = () => {
  const [queryKey, setQueryKey] = React.useState<string | null>(null);
  const [hasStarted, setHasStarted] = React.useState(false);
  const [hasResults, setHasResults] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const onSearch = React.useCallback((key: string | null, updating = false) => {
    setQueryKey(key);
    setPending(updating);
    if (key !== null) setHasStarted(true);
  }, []);
  const [params] = useSearchParams();
  const hasSearched =
    queryKey !== null && queryKey === getSearchQueryKey(params);
  const updating = pending || (queryKey !== null && !hasSearched);
  React.useEffect(() => {
    if (hasSearched) setHasResults(true);
  }, [hasSearched]);
  return (
    <>
      <SearchControls
        hasSearched={hasStarted}
        resultsAvailable={hasSearched}
        onSearch={onSearch}
      />
      {(hasSearched || hasResults) && (
        <div hidden={!hasSearched && !updating}>
          <MessageResults searchPage enabled={hasSearched} pending={updating} />
        </div>
      )}
      {!hasSearched && !hasResults && updating && <PageLoader />}
      {!hasSearched && !updating && (
        <p style={{ padding: '24px 16px', textAlign: 'center' }}>
          Enter search terms above. Matching messages appear automatically.
        </p>
      )}
    </>
  );
};

const Messages: React.FC<{ searchPage?: boolean; enabled?: boolean }> = ({
  searchPage = false,
  enabled = true,
}) => {
  const { clusterName, topicName } = useAppParams<RouteParamsClusterTopic>();
  return searchPage ? (
    <SearchPage key={`${clusterName}/${topicName}`} />
  ) : (
    <MessageResults enabled={enabled} />
  );
};

export default Messages;
