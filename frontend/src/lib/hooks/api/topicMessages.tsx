import React, { startTransition, useCallback, useRef } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import {
  BASE_PARAMS,
  MESSAGES_PER_PAGE,
  MessagesFilterKeys,
} from 'lib/constants';
import {
  GetSerdesRequest,
  PollingMode,
  TopicMessage,
  TopicMessageConsuming,
  TopicMessageEvent,
  TopicMessageEventTypeEnum,
} from 'generated-sources';
import { showServerError } from 'lib/errorHandling';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { messagesApiClient } from 'lib/api';
import { useSearchParams } from 'react-router-dom';
import { getCursorValue } from 'lib/hooks/useMessagesFilters';
import { convertStrToPollingMode } from 'lib/hooks/filterUtils';
import { useMessageFiltersStore } from 'lib/hooks/useMessageFiltersStore';
import { TopicName } from 'lib/interfaces/topic';
import { ClusterName } from 'lib/interfaces/cluster';

interface UseTopicMessagesProps {
  clusterName: ClusterName;
  topicName: TopicName;
  stringFilters?: string[];
  enabled?: boolean;
}

const EMPTY_STRING_FILTERS: string[] = [];
type PendingMessage = {
  message: TopicMessage;
  shouldPrepend: boolean;
};

const scheduleMessageFlush = (callback: FrameRequestCallback) => {
  if (typeof window !== 'undefined' && window.requestAnimationFrame) {
    return window.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(
    () => callback(Date.now()),
    0
  ) as unknown as number;
};

const cancelMessageFlush = (frameId: number) => {
  if (typeof window !== 'undefined' && window.cancelAnimationFrame) {
    window.cancelAnimationFrame(frameId);
    return;
  }
  globalThis.clearTimeout(frameId);
};

interface DownloadMessagesZipProps {
  clusterName: ClusterName;
  topicName: TopicName;
  limit: number;
  partitions?: Array<number | string>;
  stringFilters?: string[];
  smartFilterId?: string;
  keySerde?: string;
  valueSerde?: string;
  downloadMode?: string;
  offset?: string;
  timestamp?: string;
  timestampTo?: string;
  format?: string;
  searchMatch?: string;
  searchScope?: string;
}

export interface DownloadSettings {
  defaultLimit: number;
  maxLimit: number;
}

export function useDownloadSettings(
  clusterName: ClusterName,
  topicName: TopicName
) {
  return useSuspenseQuery<DownloadSettings>({
    queryKey: [
      'clusters',
      clusterName,
      'topics',
      topicName,
      'downloadSettings',
    ],
    queryFn: async () => {
      const response = await fetch(
        `${BASE_PARAMS.basePath}/api/clusters/${encodeURIComponent(clusterName)}/topics/${encodeURIComponent(topicName)}/messages/download/settings`,
        { credentials: BASE_PARAMS.credentials as RequestCredentials }
      );
      if (!response.ok) {
        await showServerError(response);
        throw new Error('Failed to load download limits');
      }
      return response.json();
    },
    refetchOnWindowFocus: false,
  });
}

export interface UploadMessagesFileResult {
  fileName: string;
  extractedEntries: number;
  parsedMessages: number;
}

export interface UploadMessagePreview {
  sourceFile: string;
  entryName: string;
  partition?: number | null;
  key?: string | null;
  valueBytes: number;
  valuePreview: string;
}

export interface UploadMessagesResult {
  dryRun: boolean;
  filesReceived: number;
  entriesRead: number;
  messagesParsed: number;
  messagesProduced: number;
  failures: number;
  files: UploadMessagesFileResult[];
  previews: UploadMessagePreview[];
  errors: string[];
}

interface UploadMessagesProps {
  clusterName: ClusterName;
  topicName: TopicName;
  files: File[];
  parseMode: string;
  partitionStrategy: string;
  keyMode: string;
  partition?: string;
  partitions?: Array<number | string>;
  keySerde?: string;
  valueSerde?: string;
  headersJson?: string;
  includeMetadataHeaders: boolean;
  dryRun: boolean;
  messageLimit?: string;
}

const zipFileNameFromHeader = (contentDisposition: string | null) => {
  if (!contentDisposition) return undefined;

  const utf8FileName = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
  const fileName = /filename="?([^";]+)"?/i.exec(contentDisposition);
  const encodedFileName = utf8FileName?.[1] || fileName?.[1];

  if (!encodedFileName) return undefined;

  try {
    return decodeURIComponent(encodedFileName.replace(/"/g, ''));
  } catch {
    return encodedFileName.replace(/"/g, '');
  }
};

export const appendStringFilters = (
  requestParams: URLSearchParams,
  primaryStringFilter: string | null,
  stringFilters: string[] = EMPTY_STRING_FILTERS
) => {
  [primaryStringFilter, ...stringFilters].forEach((stringFilter) => {
    if (stringFilter) {
      requestParams.append(MessagesFilterKeys.stringFilter, stringFilter);
    }
  });
};

export const useTopicMessages = ({
  clusterName,
  topicName,
  stringFilters = EMPTY_STRING_FILTERS,
  enabled = true,
}: UseTopicMessagesProps) => {
  const [searchParams] = useSearchParams();
  const requestIdentity = JSON.stringify([
    clusterName,
    topicName,
    searchParams.toString(),
    stringFilters,
    enabled,
  ]);
  const currentIdentity = useRef(requestIdentity);
  currentIdentity.current = requestIdentity;
  const [activeIdentity, setActiveIdentity] = React.useState<string>();
  const [messages, setMessages] = React.useState<TopicMessage[]>([]);
  const [phase, setPhase] = React.useState<string>();
  const [consumptionStats, setConsumptionStats] =
    React.useState<TopicMessageConsuming>();
  const [isFetching, setIsFetching] = React.useState(false);
  const [isLiveStreamReady, setIsLiveStreamReady] = React.useState(false);
  const liveStreamReadyRef = useRef(false);
  const abortController = useRef<AbortController | undefined>(undefined);
  const pendingMessages = useRef<PendingMessage[]>([]);
  const scheduledMessageFlush = useRef<number | undefined>(undefined);
  const prevCursor = useRef(0);
  const prevRequestKey = useRef('');

  // get initial properties

  const clearPendingMessages = useCallback(() => {
    if (scheduledMessageFlush.current !== undefined) {
      cancelMessageFlush(scheduledMessageFlush.current);
      scheduledMessageFlush.current = undefined;
    }
    pendingMessages.current = [];
  }, []);

  const abortFetchData = useCallback(() => {
    const controller = abortController.current;
    if (!controller || controller.signal.aborted) return;

    clearPendingMessages();
    setIsFetching(false);
    controller.abort();
  }, [clearPendingMessages]);

  React.useEffect(() => {
    clearPendingMessages();
    const controller = new AbortController();
    abortController.current?.abort();
    abortController.current = controller;

    setMessages([]);
    setPhase(undefined);
    setConsumptionStats(undefined);
    setActiveIdentity(requestIdentity);
    setIsFetching(enabled);
    setIsLiveStreamReady(false);
    liveStreamReadyRef.current = false;
    if (!enabled) {
      controller.abort();
      return undefined;
    }

    const isCurrentRequest = () =>
      currentIdentity.current === requestIdentity &&
      abortController.current === controller &&
      !controller.signal.aborted;

    const mode = searchParams.has('orderBy')
      ? PollingMode.EARLIEST
      : convertStrToPollingMode(
          searchParams.get(MessagesFilterKeys.mode) || ''
        ) || PollingMode.TAILING;
    setIsLiveStreamReady(false);
    liveStreamReadyRef.current = false;

    const flushPendingMessages = () => {
      scheduledMessageFlush.current = undefined;
      if (!isCurrentRequest()) {
        pendingMessages.current = [];
        return;
      }

      const messagesToFlush = pendingMessages.current;
      pendingMessages.current = [];
      if (messagesToFlush.length === 0) return;

      const updateMessages = () => {
        setMessages((previousMessages) => {
          if (!isCurrentRequest()) return previousMessages;
          const prepended = messagesToFlush
            .filter(({ shouldPrepend }) => shouldPrepend)
            .map(({ message }) => message)
            .reverse();
          const appended = messagesToFlush
            .filter(({ shouldPrepend }) => !shouldPrepend)
            .map(({ message }) => message);
          const nextMessages = [...prepended, ...previousMessages, ...appended];
          return mode === PollingMode.TAILING
            ? nextMessages.slice(
                0,
                Number(
                  searchParams.get(MessagesFilterKeys.limit) ||
                    MESSAGES_PER_PAGE
                )
              )
            : nextMessages;
        });
      };
      if (mode === PollingMode.TAILING) {
        startTransition(updateMessages);
      } else {
        updateMessages();
      }
    };

    const queueMessage = (message: TopicMessage, shouldPrepend: boolean) => {
      pendingMessages.current.push({ message, shouldPrepend });
      if (shouldPrepend) {
        const limit = Number(
          searchParams.get(MessagesFilterKeys.limit) || MESSAGES_PER_PAGE
        );
        if (pendingMessages.current.length > limit) {
          pendingMessages.current = pendingMessages.current.slice(-limit);
        }
      }
      if (scheduledMessageFlush.current === undefined) {
        scheduledMessageFlush.current =
          scheduleMessageFlush(flushPendingMessages);
      }
    };

    const timestampToRaw = searchParams.has('orderBy')
      ? null
      : searchParams.get(MessagesFilterKeys.timestampTo);

    const fetchData = async () => {
      setIsFetching(true);
      setPhase(undefined);
      setConsumptionStats(undefined);

      const url = `${BASE_PARAMS.basePath}/api/clusters/${encodeURIComponent(
        clusterName
      )}/topics/${encodeURIComponent(topicName)}/messages/v2`;

      const requestParams = new URLSearchParams({
        limit: searchParams.get(MessagesFilterKeys.limit) || MESSAGES_PER_PAGE,
        mode,
      });

      [
        MessagesFilterKeys.keySerde,
        MessagesFilterKeys.smartFilterId,
        MessagesFilterKeys.valueSerde,
        'searchMatch',
        'searchScope',
        'orderBy',
        'sortOrder',
      ].forEach((item) => {
        const value = searchParams.get(item);
        if (value) {
          requestParams.set(item, value);
        }
      });

      appendStringFilters(
        requestParams,
        searchParams.get(MessagesFilterKeys.stringFilter),
        stringFilters
      );

      switch (mode) {
        case PollingMode.TO_TIMESTAMP:
        case PollingMode.FROM_TIMESTAMP:
          requestParams.set(
            MessagesFilterKeys.timestamp,
            searchParams.get(MessagesFilterKeys.timestamp) || '0'
          );
          break;
        case PollingMode.TO_OFFSET:
        case PollingMode.FROM_OFFSET:
          requestParams.set(
            MessagesFilterKeys.offset,
            searchParams.get(MessagesFilterKeys.offset) || '0'
          );
          break;
        default:
      }

      if (timestampToRaw) {
        requestParams.set(MessagesFilterKeys.timestampTo, timestampToRaw);
      }

      const partitions = searchParams.get(MessagesFilterKeys.partitions);
      if (partitions !== null) {
        requestParams.append(MessagesFilterKeys.partitions, partitions);
      }
      const { nextCursor, setNextCursor } = useMessageFiltersStore.getState();

      const currentCursor = getCursorValue(searchParams);
      const requestKey = requestParams.toString();

      // filters stay the same and we have cursor set cursor
      if (
        !searchParams.has('orderBy') &&
        requestKey === prevRequestKey.current &&
        nextCursor &&
        prevCursor.current < currentCursor
      ) {
        requestParams.set(MessagesFilterKeys.cursor, nextCursor);
      } else if (requestKey !== prevRequestKey.current) {
        setNextCursor(undefined);
      }

      prevRequestKey.current = requestKey;
      prevCursor.current = currentCursor;

      let errorReported = false;
      const reportError = (error: unknown) => {
        if (!isCurrentRequest() || errorReported) return;
        errorReported = true;
        setNextCursor(undefined);
        setIsFetching(false);
        showServerError(error);
      };

      try {
        await fetchEventSource(`${url}?${requestParams.toString()}`, {
          method: 'GET',
          signal: controller.signal,
          openWhenHidden: true,
          async onopen(response) {
            const { ok, status } = response;
            if (ok && status === 200 && isCurrentRequest()) {
              // Reset list of messages.
              clearPendingMessages();
              setMessages([]);
            } else if (isCurrentRequest()) {
              reportError(response);
              throw new Error(`Message stream request failed (${status})`);
            }
          },
          onmessage(event) {
            if (!isCurrentRequest()) return;

            if (!event.data) return;
            const parsedData: TopicMessageEvent = JSON.parse(event.data);
            const { message, consuming, cursor } = parsedData;
            if (message?.timestamp) {
              message.timestamp = new Date(message.timestamp);
            }

            if (
              cursor &&
              useMessageFiltersStore.getState().nextCursor !== cursor.id
            ) {
              setNextCursor(cursor.id || undefined);
            }

            switch (parsedData.type) {
              case TopicMessageEventTypeEnum.MESSAGE:
                if (message) {
                  const shouldPrependLiveMessage =
                    mode === PollingMode.TAILING && liveStreamReadyRef.current;
                  queueMessage(message, shouldPrependLiveMessage);
                }
                break;
              case TopicMessageEventTypeEnum.PHASE:
                if (parsedData.phase?.name) {
                  setPhase(parsedData.phase.name);
                  if (
                    mode === PollingMode.TAILING &&
                    parsedData.phase.name === 'Live polling'
                  ) {
                    liveStreamReadyRef.current = true;
                    setIsLiveStreamReady(true);
                  }
                }
                break;
              case TopicMessageEventTypeEnum.CONSUMING:
                if (consuming) setConsumptionStats(consuming);
                break;
              default:
            }
          },
          onclose() {
            if (isCurrentRequest()) {
              if (scheduledMessageFlush.current !== undefined) {
                cancelMessageFlush(scheduledMessageFlush.current);
              }
              flushPendingMessages();
              setIsFetching(false);
            }
          },
          onerror(err) {
            if (!isCurrentRequest()) {
              throw err;
            }

            reportError(err);
            throw err;
          },
        });
      } catch (error) {
        reportError(error);
      }
    };

    fetchData();

    return () => {
      controller.abort();
      clearPendingMessages();
      if (abortController.current === controller) {
        abortController.current = undefined;
      }
    };
  }, [
    clusterName,
    clearPendingMessages,
    enabled,
    requestIdentity,
    searchParams,
    stringFilters,
    topicName,
  ]);

  return {
    phase: activeIdentity === requestIdentity && enabled ? phase : undefined,
    messages: activeIdentity === requestIdentity && enabled ? messages : [],
    consumptionStats:
      activeIdentity === requestIdentity && enabled
        ? consumptionStats
        : undefined,
    isFetching: enabled && (activeIdentity !== requestIdentity || isFetching),
    isLiveStreamReady:
      activeIdentity === requestIdentity && enabled && isLiveStreamReady,
    abortFetchData,
  };
};

export function useSerdes(props: GetSerdesRequest) {
  const { clusterName, topicName, use } = props;

  return useSuspenseQuery({
    queryKey: ['clusters', clusterName, 'topics', topicName, 'serdes', use],
    queryFn: () => messagesApiClient.getSerdes(props),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
  });
}

export function useDownloadMessagesZip() {
  return useMutation({
    mutationFn: async ({
      clusterName,
      topicName,
      limit,
      partitions,
      stringFilters,
      smartFilterId,
      keySerde,
      valueSerde,
      downloadMode,
      offset,
      timestamp,
      timestampTo,
      format,
      searchMatch,
      searchScope,
    }: DownloadMessagesZipProps) => {
      const requestParams = new URLSearchParams({
        limit: limit.toString(),
      });

      if (partitions?.length) {
        requestParams.set('partitions', partitions.join(','));
      }

      appendStringFilters(
        requestParams,
        stringFilters?.[0] || null,
        stringFilters?.slice(1)
      );

      const optionalParams: Array<[string, string | undefined]> = [
        ['smartFilterId', smartFilterId],
        ['keySerde', keySerde],
        ['valueSerde', valueSerde],
        ['downloadMode', downloadMode],
        ['offset', offset],
        ['timestamp', timestamp],
        ['timestampTo', timestampTo],
        ['format', format],
        ['searchMatch', searchMatch],
        ['searchScope', searchScope],
      ];

      optionalParams.forEach(([key, value]) => {
        if (value) requestParams.set(key, value);
      });

      const url = `${BASE_PARAMS.basePath}/api/clusters/${encodeURIComponent(
        clusterName
      )}/topics/${encodeURIComponent(
        topicName
      )}/messages/download?${requestParams.toString()}`;

      const response = await fetch(url, {
        method: 'GET',
        credentials: BASE_PARAMS.credentials as RequestCredentials,
      });

      if (!response.ok) {
        await showServerError(response);
        throw new Error('Failed to download messages ZIP');
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const fallbackFileName = `${topicName}-last-${limit}-messages.zip`;

      anchor.href = downloadUrl;
      anchor.download =
        zipFileNameFromHeader(response.headers.get('content-disposition')) ||
        fallbackFileName;

      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(downloadUrl);
    },
  });
}

export function useUploadMessages() {
  return useMutation({
    mutationFn: async ({
      clusterName,
      topicName,
      files,
      parseMode,
      partitionStrategy,
      keyMode,
      partition,
      partitions,
      keySerde,
      valueSerde,
      headersJson,
      includeMetadataHeaders,
      dryRun,
      messageLimit,
    }: UploadMessagesProps): Promise<UploadMessagesResult> => {
      const formData = new FormData();

      files.forEach((file) => formData.append('files', file));
      formData.set('parseMode', parseMode);
      formData.set('partitionStrategy', partitionStrategy);
      formData.set('keyMode', keyMode);
      formData.set('includeMetadataHeaders', includeMetadataHeaders.toString());
      formData.set('dryRun', dryRun.toString());

      if (partition) formData.set('partition', partition);
      if (keySerde) formData.set('keySerde', keySerde);
      if (valueSerde) formData.set('valueSerde', valueSerde);
      if (headersJson) formData.set('headersJson', headersJson);
      if (messageLimit) formData.set('messageLimit', messageLimit);
      partitions?.forEach((item) =>
        formData.append('partitions', item.toString())
      );

      const response = await fetch(
        `${BASE_PARAMS.basePath}/api/clusters/${encodeURIComponent(
          clusterName
        )}/topics/${encodeURIComponent(topicName)}/messages/upload`,
        {
          method: 'POST',
          credentials: BASE_PARAMS.credentials as RequestCredentials,
          body: formData,
        }
      );

      if (!response.ok) {
        await showServerError(response);
        throw new Error('Failed to upload messages');
      }

      return response.json();
    },
  });
}

export function useRegisterSmartFilter({
  clusterName,
  topicName,
}: {
  clusterName: ClusterName;
  topicName: TopicName;
}) {
  return useMutation({
    mutationFn: (payload: { filterCode: string }) => {
      return messagesApiClient.registerFilter({
        clusterName,
        topicName,
        messageFilterRegistration: { filterCode: payload.filterCode },
      });
    },
  });
}
