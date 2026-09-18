import { useSearchParams } from 'react-router-dom';
import { PollingMode } from 'generated-sources';
import { useEffect } from 'react';
import { Option } from 'react-multi-select-component';
import {
  MAX_MESSAGES_PER_PAGE,
  MESSAGES_PER_PAGE,
  MessagesFilterKeys,
} from 'lib/constants';
import { ClusterName } from 'lib/interfaces/cluster';

import { convertStrToPollingMode } from './filterUtils';
import {
  AdvancedFilter,
  selectFilter,
  useMessageFiltersStore,
} from './useMessageFiltersStore';
import { useMessagesFiltersFields } from './useMessagesFiltersFields';
import useAppParams from './useAppParams';

const defaultModeValue = PollingMode.TAILING;

const normalizeMessageLimit = (value: string) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return MESSAGES_PER_PAGE;
  }

  return Math.min(parsed, MAX_MESSAGES_PER_PAGE).toString();
};

export function useRefreshData(initSearchParams?: URLSearchParams) {
  const [, setSearchParams] = useSearchParams(initSearchParams);
  return () => {
    setSearchParams((params) => {
      if (params.get(MessagesFilterKeys.r)) {
        params.delete(MessagesFilterKeys.r);
      } else {
        params.set(MessagesFilterKeys.r, 'r');
      }

      return params;
    });
  };
}

export function getCursorValue(urlSearchParam: URLSearchParams) {
  const cursor = parseInt(
    urlSearchParam.get(MessagesFilterKeys.cursor) || '0',
    10
  );

  if (Number.isNaN(cursor)) {
    return 0;
  }

  return cursor;
}

export function usePaginateTopics(initSearchParams?: URLSearchParams) {
  const [, setSearchParams] = useSearchParams(initSearchParams);
  return () => {
    setSearchParams((params) => {
      const cursor = getCursorValue(params) + 1;

      if (cursor) {
        params.set(MessagesFilterKeys.cursor, cursor.toString());
      }

      return params;
    });
  };
}

export function useMessagesFilters(topicName: string) {
  const [searchParams, setSearchParams] = useSearchParams();
  const refreshData = useRefreshData(searchParams);
  const { clusterName } = useAppParams<{ clusterName: ClusterName }>();

  const storageKey = `${topicName}:${clusterName}`;
  const {
    initMessagesFiltersFields,
    setMessagesFiltersField,
    removeMessagesFiltersField,
  } = useMessagesFiltersFields(storageKey);

  useEffect(() => {
    setSearchParams((params) => {
      initMessagesFiltersFields(params);
      params.set(
        MessagesFilterKeys.limit,
        normalizeMessageLimit(
          params.get(MessagesFilterKeys.limit) || MESSAGES_PER_PAGE
        )
      );

      if (!params.get(MessagesFilterKeys.mode)) {
        params.set(MessagesFilterKeys.mode, defaultModeValue);
      }

      params.delete(MessagesFilterKeys.cursor);

      return params;
    });
  }, []);

  /**
   * @description
   * Params getter
   * */
  const mode =
    convertStrToPollingMode(searchParams.get(MessagesFilterKeys.mode) || '') ||
    defaultModeValue;

  const dateParams = searchParams.get(MessagesFilterKeys.timestamp);

  const date = dateParams ? new Date(parseFloat(dateParams)) : null;

  const timestampToParam = searchParams.get(MessagesFilterKeys.timestampTo);
  const timestampTo = timestampToParam
    ? new Date(parseFloat(timestampToParam))
    : null;

  const keySerde = searchParams.get(MessagesFilterKeys.keySerde) || undefined;
  const valueSerde =
    searchParams.get(MessagesFilterKeys.valueSerde) || undefined;

  const offset = searchParams.get(MessagesFilterKeys.offset) || undefined;

  const limit = normalizeMessageLimit(
    searchParams.get(MessagesFilterKeys.limit) || MESSAGES_PER_PAGE
  );

  const search = searchParams.get(MessagesFilterKeys.stringFilter) || '';

  const partitions = (searchParams.get(MessagesFilterKeys.partitions) || '')
    .split(',')
    .filter((v) => v);

  const smartFilterId =
    searchParams.get(MessagesFilterKeys.activeFilterId) || '';

  const smartFilter = useMessageFiltersStore(selectFilter(smartFilterId));

  /**
   * @description
   * Params setters
   * */
  const setMode = (newMode: PollingMode) => {
    setSearchParams((params) => {
      removeMessagesFiltersField(MessagesFilterKeys.offset);
      removeMessagesFiltersField(MessagesFilterKeys.timestamp);
      removeMessagesFiltersField(MessagesFilterKeys.timestampTo);
      setMessagesFiltersField(MessagesFilterKeys.mode, newMode);
      params.delete(MessagesFilterKeys.cursor);
      params.set(MessagesFilterKeys.mode, newMode);
      params.delete(MessagesFilterKeys.offset);
      params.delete(MessagesFilterKeys.timestamp);
      params.delete(MessagesFilterKeys.timestampTo);
      return params;
    });
  };

  const setTimeStamp = (newDate: Date | null) => {
    if (newDate === null) {
      setSearchParams((params) => {
        removeMessagesFiltersField(MessagesFilterKeys.timestamp);
        params.delete(MessagesFilterKeys.cursor);
        params.delete(MessagesFilterKeys.timestamp);
        return params;
      });
      return;
    }

    setSearchParams((params) => {
      params.delete(MessagesFilterKeys.cursor);
      setMessagesFiltersField(
        MessagesFilterKeys.timestamp,
        newDate.getTime().toString()
      );
      params.set(MessagesFilterKeys.timestamp, newDate.getTime().toString());
      return params;
    });
  };

  /**
   * @description Sets a time range on the Messages tab.
   * - both dates set → mode=FROM_TIMESTAMP with `timestamp=start` and a
   *   client-side upper cap in `timestampTo=end`
   * - only start set → mode=FROM_TIMESTAMP
   * - only end set   → mode=TO_TIMESTAMP with `timestamp=end`
   * - both null      → clears range and resets to LATEST
   */
  const setTimeRange = (start: Date | null, end: Date | null) => {
    setSearchParams((params) => {
      params.delete(MessagesFilterKeys.cursor);
      removeMessagesFiltersField(MessagesFilterKeys.offset);
      params.delete(MessagesFilterKeys.offset);
      params.delete(MessagesFilterKeys.timestamp);
      params.delete(MessagesFilterKeys.timestampTo);
      removeMessagesFiltersField(MessagesFilterKeys.timestamp);
      removeMessagesFiltersField(MessagesFilterKeys.timestampTo);

      if (!start && !end) {
        setMessagesFiltersField(MessagesFilterKeys.mode, PollingMode.LATEST);
        params.set(MessagesFilterKeys.mode, PollingMode.LATEST);
        return params;
      }

      if (start && !end) {
        setMessagesFiltersField(
          MessagesFilterKeys.mode,
          PollingMode.FROM_TIMESTAMP
        );
        params.set(MessagesFilterKeys.mode, PollingMode.FROM_TIMESTAMP);
        setMessagesFiltersField(
          MessagesFilterKeys.timestamp,
          start.getTime().toString()
        );
        params.set(MessagesFilterKeys.timestamp, start.getTime().toString());
        return params;
      }

      if (!start && end) {
        setMessagesFiltersField(
          MessagesFilterKeys.mode,
          PollingMode.TO_TIMESTAMP
        );
        params.set(MessagesFilterKeys.mode, PollingMode.TO_TIMESTAMP);
        setMessagesFiltersField(
          MessagesFilterKeys.timestamp,
          end.getTime().toString()
        );
        params.set(MessagesFilterKeys.timestamp, end.getTime().toString());
        return params;
      }

      // both start and end set
      setMessagesFiltersField(
        MessagesFilterKeys.mode,
        PollingMode.FROM_TIMESTAMP
      );
      params.set(MessagesFilterKeys.mode, PollingMode.FROM_TIMESTAMP);
      setMessagesFiltersField(
        MessagesFilterKeys.timestamp,
        (start as Date).getTime().toString()
      );
      params.set(
        MessagesFilterKeys.timestamp,
        (start as Date).getTime().toString()
      );
      setMessagesFiltersField(
        MessagesFilterKeys.timestampTo,
        (end as Date).getTime().toString()
      );
      params.set(
        MessagesFilterKeys.timestampTo,
        (end as Date).getTime().toString()
      );
      return params;
    });
  };

  const setKeySerde = (newKeySerde: string) => {
    setSearchParams((params) => {
      params.delete(MessagesFilterKeys.cursor);
      params.set(MessagesFilterKeys.keySerde, newKeySerde);
      setMessagesFiltersField(MessagesFilterKeys.keySerde, newKeySerde);
      return params;
    });
  };

  const setValueSerde = (newValueSerde: string) => {
    setSearchParams((params) => {
      params.delete(MessagesFilterKeys.cursor);
      setMessagesFiltersField(MessagesFilterKeys.valueSerde, newValueSerde);
      params.set(MessagesFilterKeys.valueSerde, newValueSerde);
      return params;
    });
  };

  const setOffsetValue = (newOffsetValue: string) => {
    setSearchParams((params) => {
      params.delete(MessagesFilterKeys.cursor);
      setMessagesFiltersField(MessagesFilterKeys.offset, newOffsetValue);
      params.set(MessagesFilterKeys.offset, newOffsetValue);
      return params;
    });
  };

  const setLimit = (newLimit: string) => {
    setSearchParams((params) => {
      params.set(MessagesFilterKeys.limit, normalizeMessageLimit(newLimit));
      params.delete(MessagesFilterKeys.cursor);
      return params;
    });
  };

  const setSearch = (value: string) => {
    setSearchParams((params) => {
      const refinementFilters = params
        .getAll(MessagesFilterKeys.stringFilter)
        .slice(1)
        .filter(Boolean);

      params.delete(MessagesFilterKeys.cursor);

      if (value) {
        setMessagesFiltersField(MessagesFilterKeys.stringFilter, value);
        params.delete(MessagesFilterKeys.stringFilter);
        params.append(MessagesFilterKeys.stringFilter, value);
        refinementFilters.forEach((refinementFilter) => {
          params.append(MessagesFilterKeys.stringFilter, refinementFilter);
        });
      } else {
        removeMessagesFiltersField(MessagesFilterKeys.stringFilter);
        params.delete(MessagesFilterKeys.stringFilter);
      }
      return params;
    });
  };

  const setPartition = (values: Option[]) => {
    setSearchParams((params) => {
      params.delete(MessagesFilterKeys.cursor);
      params.delete(MessagesFilterKeys.partitions);

      if (values.length) {
        setMessagesFiltersField(
          MessagesFilterKeys.partitions,
          values.map((v) => v.value).join(',')
        );
        params.append(
          MessagesFilterKeys.partitions,
          values.map((v) => v.value).join(',')
        );
      } else {
        removeMessagesFiltersField(MessagesFilterKeys.partitions);
      }

      return params;
    });
  };

  const setSmartFilter = (newFilter: AdvancedFilter | null) => {
    if (newFilter === null) {
      setSearchParams((params) => {
        params.delete(MessagesFilterKeys.cursor);
        params.delete(MessagesFilterKeys.smartFilterId);
        params.delete(MessagesFilterKeys.activeFilterId);
        return params;
      });

      removeMessagesFiltersField(MessagesFilterKeys.smartFilterId);
      removeMessagesFiltersField(MessagesFilterKeys.activeFilterId);

      return;
    }

    const { id } = newFilter;
    // callback should always capture the latest states not rely on rendering

    const filter = selectFilter(newFilter.id)(
      useMessageFiltersStore.getState()
    );

    // setting something that is not in the state
    if (!filter) return;

    setMessagesFiltersField(MessagesFilterKeys.activeFilterId, filter.id);
    setMessagesFiltersField(
      MessagesFilterKeys.smartFilterId,
      filter.filterCode
    );

    setSearchParams((params) => {
      params.delete(MessagesFilterKeys.cursor);
      params.set(MessagesFilterKeys.smartFilterId, filter.filterCode); // hash code, i.e. 3de77452
      params.set(MessagesFilterKeys.activeFilterId, id); // sllug name, i.e. MyFancyFilter
      return params;
    });
  };

  return {
    mode,
    setMode,
    date,
    setTimeStamp,
    timestampTo,
    setTimeRange,
    keySerde,
    setKeySerde,
    valueSerde,
    setValueSerde,
    offset,
    setOffsetValue,
    limit,
    setLimit,
    search,
    setSearch,
    partitions,
    setPartition,
    smartFilter,
    setSmartFilter,
    refreshData,
  };
}

export function useIsMessagesSmartFilterPersisted(
  initSearchParams?: URLSearchParams
) {
  const [searchParams] = useSearchParams(initSearchParams);

  return !!searchParams.get(MessagesFilterKeys.activeFilterId);
}

export function useIsLiveMode(initSearchParams?: URLSearchParams) {
  const [searchParams] = useSearchParams(initSearchParams);
  const mode =
    convertStrToPollingMode(searchParams.get(MessagesFilterKeys.mode) || '') ||
    PollingMode.TAILING;

  return mode === PollingMode.TAILING;
}
