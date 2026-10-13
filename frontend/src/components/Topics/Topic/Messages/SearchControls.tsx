import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { PollingMode } from 'generated-sources';
import { MessagesFilterKeys } from 'lib/constants';
import {
  useDownloadMessagesZip,
  useDownloadSettings,
} from 'lib/hooks/api/topicMessages';
import useAppParams from 'lib/hooks/useAppParams';
import { RouteParamsClusterTopic } from 'lib/paths';
import Input from 'components/common/Input/Input';
import Select from 'components/common/Select/Select';
import { Button } from 'components/common/Button/Button';
import FlexBox from 'components/common/FlexBox/FlexBox';
import { useLocalStorage } from 'lib/hooks/useLocalStorage';

import * as S from './SearchControls.styled';

export const SEARCH_TERM_LIMIT = 500;

export const getSearchQueryKey = (params: URLSearchParams) =>
  JSON.stringify([
    params.getAll(MessagesFilterKeys.stringFilter),
    params.get('searchMatch'),
    params.get('searchScope'),
  ]);

const SearchControls: React.FC<{
  hasSearched: boolean;
  resultsAvailable?: boolean;
  onSearch: (queryKey: string | null, pending?: boolean) => void;
}> = ({ hasSearched, resultsAvailable = hasSearched, onSearch }) => {
  const [params, setParams] = useSearchParams();
  const { clusterName, topicName } = useAppParams<RouteParamsClusterTopic>();
  const { data: settings } = useDownloadSettings(clusterName, topicName);
  const download = useDownloadMessagesZip();
  const [draft, setDraft] = useLocalStorage(
    `topic-search-${JSON.stringify([clusterName, topicName])}`,
    {
      terms: params.getAll(MessagesFilterKeys.stringFilter).join(', '),
      match: params.get('searchMatch') || 'ANY',
      scope: params.get('searchScope') || 'ALL',
    }
  );
  const { terms, match, scope } = draft;
  const searchTerms = React.useMemo(
    () => [
      ...new Set(
        terms
          .split(/[,\n]/)
          .map((term) => term.trim())
          .filter(Boolean)
      ),
    ],
    [terms]
  );
  const tooManyTerms = searchTerms.length > SEARCH_TERM_LIMIT;
  const paramsRef = React.useRef(params);
  paramsRef.current = params;
  const setParamsRef = React.useRef(setParams);
  setParamsRef.current = setParams;
  const onSearchRef = React.useRef(onSearch);
  onSearchRef.current = onSearch;
  const [exportLimit, setExportLimit] = React.useState(
    settings.defaultLimit.toString()
  );
  React.useEffect(() => {
    if (tooManyTerms) {
      onSearchRef.current(null);
      return undefined;
    }
    onSearchRef.current(null, searchTerms.length > 0);
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(paramsRef.current);
      next.delete(MessagesFilterKeys.stringFilter);
      searchTerms.forEach((term) =>
        next.append(MessagesFilterKeys.stringFilter, term)
      );
      if (!next.has(MessagesFilterKeys.mode))
        next.set(MessagesFilterKeys.mode, PollingMode.EARLIEST);
      next.set('searchMatch', match);
      next.set('searchScope', scope);
      next.delete(MessagesFilterKeys.cursor);
      if (next.toString() !== paramsRef.current.toString()) {
        setParamsRef.current(next, { replace: true });
      }
      onSearchRef.current(
        searchTerms.length > 0 ? getSearchQueryKey(next) : null
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchTerms, tooManyTerms, match, scope]);
  const updateDraft = (changes: Partial<typeof draft>) => {
    const nextDraft = { ...draft, ...changes };
    const count = new Set(
      nextDraft.terms
        .split(/[,\n]/)
        .map((term) => term.trim())
        .filter(Boolean)
    ).size;
    onSearch(null, count > 0 && count <= SEARCH_TERM_LIMIT);
    setDraft((current) => ({ ...current, ...changes }));
  };
  const exportResults = () => {
    const mode = params.get(MessagesFilterKeys.mode);
    download.mutate({
      clusterName,
      topicName,
      limit: Number(exportLimit),
      stringFilters: params.getAll(MessagesFilterKeys.stringFilter),
      searchMatch: params.get('searchMatch') || 'ALL',
      searchScope: params.get('searchScope') || 'ALL',
      downloadMode:
        !mode || mode === PollingMode.TAILING ? PollingMode.LATEST : mode,
      partitions: params
        .get(MessagesFilterKeys.partitions)
        ?.split(',')
        .filter(Boolean),
      smartFilterId: params.get(MessagesFilterKeys.smartFilterId) || undefined,
      keySerde: params.get(MessagesFilterKeys.keySerde) || undefined,
      valueSerde: params.get(MessagesFilterKeys.valueSerde) || undefined,
      offset: params.get(MessagesFilterKeys.offset) || undefined,
      timestamp: params.get(MessagesFilterKeys.timestamp) || undefined,
      timestampTo: params.get(MessagesFilterKeys.timestampTo) || undefined,
      format: 'NDJSON',
    });
  };
  return (
    <S.Container>
      <h2>Search messages</h2>
      <p>
        Search keys, values or headers. Separate multiple terms with commas.
      </p>
      <form
        onSubmit={(event) => event.preventDefault()}
        aria-label="Message search"
      >
        <S.SearchRow>
          <S.SearchField>
            <S.SearchInput
              aria-label="Search terms"
              placeholder="e.g. order-123, customer-456, trace-id"
              value={terms}
              onChange={(event) => updateDraft({ terms: event.target.value })}
              aria-invalid={tooManyTerms}
              aria-describedby={
                tooManyTerms ? 'search-terms-error' : 'search-terms-count'
              }
            />
          </S.SearchField>
        </S.SearchRow>
        {tooManyTerms ? (
          <S.SearchError id="search-terms-error" role="alert">
            You entered {searchTerms.length} distinct terms. Search supports up
            to {SEARCH_TERM_LIMIT}; remove some terms to continue.
          </S.SearchError>
        ) : (
          <p id="search-terms-count">
            {searchTerms.length} / {SEARCH_TERM_LIMIT} search terms
          </p>
        )}
        <FlexBox gap="12px" flexWrap="wrap" alignItems="center">
          <Select
            id="searchMatch"
            aria-label="Search matching"
            value={match}
            onChange={(value) => updateDraft({ match: value })}
            options={[
              { label: 'Match ANY term (OR)', value: 'ANY' },
              { label: 'Match ALL terms (AND)', value: 'ALL' },
            ]}
          />
          <Select
            id="searchScope"
            aria-label="Search scope"
            value={scope}
            onChange={(value) => updateDraft({ scope: value })}
            options={[
              { label: 'Key, value and headers', value: 'ALL' },
              { label: 'Headers only', value: 'HEADERS' },
            ]}
          />
        </FlexBox>
      </form>
      {hasSearched && (
        <>
          <p>
            Each comma-separated term is searched independently in ANY mode.
            Results are combined without duplicates. Expand Advanced filters for
            partitions, time ranges, offsets, serdes and smart filters. Live
            search examines recent messages and new arrivals, not the full
            history; select Oldest to scan from the beginning.
          </p>
          <FlexBox gap="12px" alignItems="center" flexWrap="wrap">
            <Input
              aria-label="Export result limit"
              type="number"
              positiveOnly
              integerOnly
              min={1}
              max={settings.maxLimit}
              value={exportLimit}
              onChange={(event) => setExportLimit(event.target.value)}
            />
            <Button
              buttonSize="M"
              buttonType="secondary"
              disabled={
                download.isPending ||
                !resultsAvailable ||
                !Number.isInteger(Number(exportLimit)) ||
                Number(exportLimit) < 1 ||
                Number(exportLimit) > settings.maxLimit
              }
              onClick={exportResults}
            >
              {download.isPending
                ? 'Preparing results...'
                : 'Download matching results (NDJSON)'}
            </Button>
            <span>
              Up to {settings.maxLimit} matches; export scans beyond the
              displayed page.
            </span>
          </FlexBox>
        </>
      )}
    </S.Container>
  );
};

export default SearchControls;
