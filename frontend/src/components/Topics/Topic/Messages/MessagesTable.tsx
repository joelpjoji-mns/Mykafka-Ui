import TableHeaderCell from 'components/common/table/TableHeaderCell/TableHeaderCell';
import {
  PollingMode,
  SortOrder,
  TopicMessage,
  TopicMessageConsuming,
} from 'generated-sources';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from 'components/common/Button/Button';
import { usePaginateTopics, useIsLiveMode } from 'lib/hooks/useMessagesFilters';
import { useMessageFiltersStore } from 'lib/hooks/useMessageFiltersStore';
import useAppParams from 'lib/hooks/useAppParams';
import { RouteParamsClusterTopic } from 'lib/paths';
import { useLocalStorage } from 'lib/hooks/useLocalStorage';
import { useSearchParams } from 'react-router-dom';
import { MessagesFilterKeys } from 'lib/constants';
import { uniqueKeys } from 'lib/utils/uniqueKeys';

import Message, { PreviewFilter } from './Message';
import PreviewModal from './PreviewModal';
import * as TableS from './MessagesTable.styled';

export interface MessagesTableProps {
  messages: TopicMessage[];
  isFetching: boolean;
  isProvisionalRanking?: boolean;
  animateLiveArrivals?: boolean;
  abortFetchData?: () => void;
  consumptionStats?: TopicMessageConsuming;
  isLivePaused?: boolean;
  pausedArrivals?: number;
  onPauseLive?: () => void;
  onResumeLive?: () => void;
}

type PreviewTarget = 'key' | 'headers' | 'content';

type MessageColumnId =
  | 'toggle'
  | 'id'
  | 'offset'
  | 'partition'
  | 'timestamp'
  | 'size'
  | 'key'
  | 'headers'
  | 'value'
  | 'actions';

type ResizableMessageColumnId = Exclude<MessageColumnId, 'toggle' | 'actions'>;

type MessageColumnWidths = Record<MessageColumnId, number>;

type StoredMessageColumnWidths = Record<string, Partial<MessageColumnWidths>>;

const MESSAGE_COLUMN_IDS: MessageColumnId[] = [
  'toggle',
  'id',
  'offset',
  'partition',
  'timestamp',
  'size',
  'key',
  'headers',
  'value',
  'actions',
];

const DEFAULT_COLUMN_WIDTHS: MessageColumnWidths = {
  toggle: 48,
  id: 132,
  offset: 96,
  partition: 112,
  timestamp: 220,
  size: 96,
  key: 280,
  headers: 260,
  value: 320,
  actions: 56,
};

const MINIMUM_COLUMN_WIDTHS: MessageColumnWidths = {
  toggle: 48,
  id: 96,
  offset: 72,
  partition: 88,
  timestamp: 160,
  size: 80,
  key: 160,
  headers: 160,
  value: 200,
  actions: 56,
};

const scheduleAnimationFrame = (callback: FrameRequestCallback) =>
  window.requestAnimationFrame
    ? window.requestAnimationFrame(callback)
    : window.setTimeout(() => callback(Date.now()), 0);

const cancelScheduledAnimationFrame = (frameId: number) => {
  if (window.cancelAnimationFrame) {
    window.cancelAnimationFrame(frameId);
  } else {
    window.clearTimeout(frameId);
  }
};

interface MessagePreviewProps {
  [key: string]: {
    keyFilters: PreviewFilter[];
    headersFilters?: PreviewFilter[];
    contentFilters: PreviewFilter[];
  };
}

const MessagesTable: React.FC<MessagesTableProps> = ({
  messages,
  isFetching,
  isProvisionalRanking = false,
  animateLiveArrivals = false,
  abortFetchData,
  consumptionStats,
  isLivePaused = false,
  pausedArrivals = 0,
  onPauseLive,
  onResumeLive,
}) => {
  const [params, setParams] = useSearchParams();
  // Keep the same array across URL changes that don't touch the search so
  // memoized rows don't re-render.
  const searchTermsKey = JSON.stringify(
    params.getAll(MessagesFilterKeys.stringFilter)
  );
  const searchTerms = useMemo<string[]>(
    () => JSON.parse(searchTermsKey),
    [searchTermsKey]
  );
  // Partition and offset identify a record without relying on its content.
  const messageRowKeys = useMemo(
    () =>
      uniqueKeys(
        messages.map(({ partition, offset }) => `${partition}-${offset}`)
      ),
    [messages]
  );
  const wholeTopic = params.has('orderBy');
  const [cancelled, setCancelled] = useState(false);
  const scanning =
    wholeTopic && params.has('orderBy') && isFetching && !cancelled;
  const sortedPageLoading =
    wholeTopic &&
    params.has(MessagesFilterKeys.cursor) &&
    isFetching &&
    !cancelled;
  useEffect(() => {
    if (isFetching) setCancelled(false);
  }, [isFetching]);
  const paginate = usePaginateTopics();
  const orderBy = params.get('orderBy');
  const sortOrder =
    params.get('sortOrder') === 'DESC' ? SortOrder.DESC : SortOrder.ASC;
  let scanStatus =
    'Click a heading to rank all retained matching records across all partitions. Time/offset bounds are ignored; new arrivals require another scan.';
  if (cancelled) {
    scanStatus = 'Scan cancelled. No partial ranking is shown.';
  } else if (sortedPageLoading) {
    scanStatus = `Loading sorted page ${
      Number(params.get(MessagesFilterKeys.cursor) || 0) + 1
    }...`;
  } else if (scanning) {
    scanStatus = isProvisionalRanking
      ? `Scanning whole topic: ${
          consumptionStats?.messagesConsumed || 0
        } records read. Showing ${messages.length} provisional sorted results.`
      : `Scanning whole topic: ${
          consumptionStats?.messagesConsumed || 0
        } records read...`;
  } else if (wholeTopic && !isFetching && messages.length > 0) {
    scanStatus = `Whole-topic sort complete. Page ${
      Number(params.get(MessagesFilterKeys.cursor) || 0) + 1
    }: showing ${messages.length} matching records.`;
  } else if (isProvisionalRanking) {
    scanStatus =
      'Scan ended before final ranking completed. Showing provisional results.';
  }
  let emptyMessagesText = 'Loading messages...';
  if (wholeTopic) {
    emptyMessagesText =
      'Waiting for matching messages while the full-topic scan continues...';
  }
  if (sortedPageLoading) {
    emptyMessagesText = 'Loading the next sorted page...';
  }
  const getSortProps = (columnId: ResizableMessageColumnId) => ({
    orderBy,
    sortOrder,
    orderValue: columnId,
    handleOrderBy: (column: string | null) => {
      if (column) {
        setCancelled(false);
        setParams((current) => {
          const next = new URLSearchParams(current);
          next.delete('sortScope');
          next.set('orderBy', column);
          next.set(
            'sortOrder',
            column === orderBy && sortOrder === SortOrder.ASC ? 'DESC' : 'ASC'
          );
          next.set(MessagesFilterKeys.mode, PollingMode.EARLIEST);
          [
            MessagesFilterKeys.cursor,
            MessagesFilterKeys.partitions,
            MessagesFilterKeys.offset,
            MessagesFilterKeys.timestamp,
            MessagesFilterKeys.timestampTo,
          ].forEach((key) => next.delete(key));
          return next;
        });
      }
    },
  });
  const [previewFor, setPreviewFor] = useState<PreviewTarget | null>(null);
  const [keyFilters, setKeyFilters] = useState<PreviewFilter[]>([]);
  const [headersFilters, setHeadersFilters] = useState<PreviewFilter[]>([]);
  const [contentFilters, setContentFilters] = useState<PreviewFilter[]>([]);
  const nextCursor = useMessageFiltersStore((state) => state.nextCursor);
  const isLive = useIsLiveMode();
  const { clusterName, topicName } = useAppParams<RouteParamsClusterTopic>();
  const previewStorageKey = `${clusterName}:${topicName}`;
  const [messagesPreview, setMessagesPreview] =
    useLocalStorage<MessagePreviewProps>('message-preview', {});
  const [storedColumnWidths, setStoredColumnWidths] =
    useLocalStorage<StoredMessageColumnWidths>('message-table-widths', {});
  const [draggedColumnWidths, setDraggedColumnWidths] = useState<
    Partial<MessageColumnWidths>
  >({});
  const activeResizeCleanup = useRef<(() => void) | undefined>(undefined);
  const tableStorageKey = `${clusterName}:${topicName}`;
  const columnWidths = {
    ...DEFAULT_COLUMN_WIDTHS,
    ...(storedColumnWidths[tableStorageKey] || {}),
    ...draggedColumnWidths,
  };
  const tableWidth = MESSAGE_COLUMN_IDS.reduce(
    (totalWidth, columnId) => totalWidth + columnWidths[columnId],
    0
  );

  useEffect(() => {
    setDraggedColumnWidths({});
  }, [tableStorageKey]);

  useEffect(
    () => () => {
      activeResizeCleanup.current?.();
    },
    []
  );

  useEffect(() => {
    setKeyFilters(messagesPreview[previewStorageKey]?.keyFilters || []);
    setHeadersFilters(messagesPreview[previewStorageKey]?.headersFilters || []);
    setContentFilters(messagesPreview[previewStorageKey]?.contentFilters || []);
  }, [messagesPreview, previewStorageKey]);

  const getPreviewFilters = () => {
    if (previewFor === 'key') return keyFilters;
    if (previewFor === 'headers') return headersFilters;
    return contentFilters;
  };

  const setFilters = useCallback(
    (payload: PreviewFilter[]) => {
      if (previewFor === 'key') {
        setKeyFilters(payload);
        setMessagesPreview((currentPreviews) => {
          const currentPreview = currentPreviews[previewStorageKey] || {
            keyFilters: [],
            headersFilters: [],
            contentFilters: [],
          };

          return {
            ...currentPreviews,
            [previewStorageKey]: {
              ...currentPreview,
              keyFilters: payload,
            },
          };
        });
      } else if (previewFor === 'headers') {
        setHeadersFilters(payload);
        setMessagesPreview((currentPreviews) => {
          const currentPreview = currentPreviews[previewStorageKey] || {
            keyFilters: [],
            headersFilters: [],
            contentFilters: [],
          };

          return {
            ...currentPreviews,
            [previewStorageKey]: {
              ...currentPreview,
              headersFilters: payload,
            },
          };
        });
      } else {
        setContentFilters(payload);
        setMessagesPreview((currentPreviews) => {
          const currentPreview = currentPreviews[previewStorageKey] || {
            keyFilters: [],
            headersFilters: [],
            contentFilters: [],
          };

          return {
            ...currentPreviews,
            [previewStorageKey]: {
              ...currentPreview,
              contentFilters: payload,
            },
          };
        });
      }
    },
    [previewFor, previewStorageKey]
  );

  const persistColumnWidth = (
    columnId: ResizableMessageColumnId,
    width: number
  ) => {
    setStoredColumnWidths((currentWidths) => ({
      ...currentWidths,
      [tableStorageKey]: {
        ...(currentWidths[tableStorageKey] || {}),
        [columnId]: width,
      },
    }));
  };

  const startColumnResize =
    (columnId: ResizableMessageColumnId) =>
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      activeResizeCleanup.current?.();
      const initialWidth = columnWidths[columnId];
      const initialX = event.clientX;
      let resizedWidth = initialWidth;
      let scheduledFrame: number | undefined;

      const updateDraggedWidth = () => {
        scheduledFrame = undefined;
        setDraggedColumnWidths((currentWidths) => ({
          ...currentWidths,
          [columnId]: resizedWidth,
        }));
      };

      const handlePointerMove = (pointerEvent: PointerEvent) => {
        resizedWidth = Math.max(
          MINIMUM_COLUMN_WIDTHS[columnId],
          initialWidth + pointerEvent.clientX - initialX
        );
        if (scheduledFrame === undefined) {
          scheduledFrame = scheduleAnimationFrame(updateDraggedWidth);
        }
      };

      let cleanupResize: () => void = () => undefined;

      const finishResize = () => {
        cleanupResize();
        persistColumnWidth(columnId, resizedWidth);
        setDraggedColumnWidths({});
      };

      cleanupResize = () => {
        if (scheduledFrame !== undefined) {
          cancelScheduledAnimationFrame(scheduledFrame);
          scheduledFrame = undefined;
        }
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', finishResize);
        if (activeResizeCleanup.current === cleanupResize) {
          activeResizeCleanup.current = undefined;
        }
      };

      activeResizeCleanup.current = cleanupResize;
      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', finishResize);
    };

  const resizeColumnBy =
    (columnId: ResizableMessageColumnId) => (delta: number) => {
      persistColumnWidth(
        columnId,
        Math.max(
          MINIMUM_COLUMN_WIDTHS[columnId],
          columnWidths[columnId] + delta
        )
      );
    };

  const resetColumnWidth = (columnId: ResizableMessageColumnId) => {
    setStoredColumnWidths((currentWidths) => {
      const topicWidths = { ...(currentWidths[tableStorageKey] || {}) };
      delete topicWidths[columnId];
      return {
        ...currentWidths,
        [tableStorageKey]: topicWidths,
      };
    });
  };

  const getResizeProps = (columnId: ResizableMessageColumnId) => ({
    onResizeStart: startColumnResize(columnId),
    onResizeBy: resizeColumnBy(columnId),
    onResizeReset: () => resetColumnWidth(columnId),
  });

  return (
    <div style={{ position: 'relative' }}>
      <TableS.ScanToolbar>
        <TableS.ScanStatus role="status">{scanStatus}</TableS.ScanStatus>
        <TableS.ScanActions>
          {scanning && (
            <Button
              buttonType="secondary"
              buttonSize="M"
              onClick={() => {
                abortFetchData?.();
                setCancelled(true);
              }}
            >
              Cancel topic scan
            </Button>
          )}
          {isLive && animateLiveArrivals && onPauseLive && onResumeLive && (
            <Button
              buttonType="secondary"
              buttonSize="M"
              aria-pressed={isLivePaused}
              title={
                isLivePaused
                  ? 'Show messages that arrived while paused and continue tailing'
                  : 'Freeze the table so rows can be inspected; new arrivals are buffered'
              }
              onClick={isLivePaused ? onResumeLive : onPauseLive}
            >
              {isLivePaused
                ? `Resume live${pausedArrivals > 0 ? ` (${pausedArrivals} new)` : ''}`
                : 'Pause live'}
            </Button>
          )}
          <Button
            disabled={isLive || isFetching || !nextCursor}
            title={
              wholeTopic && isFetching
                ? 'Next page is available after the full-topic ranking completes.'
                : undefined
            }
            buttonType="secondary"
            buttonSize="M"
            onClick={paginate}
          >
            Next →
          </Button>
        </TableS.ScanActions>
      </TableS.ScanToolbar>
      {previewFor !== null && (
        <PreviewModal
          values={getPreviewFilters()}
          toggleIsOpen={() => setPreviewFor(null)}
          setFilters={setFilters}
        />
      )}
      <TableS.TableViewport>
        <TableS.ResizableTable isFullwidth $width={tableWidth}>
          <colgroup>
            {MESSAGE_COLUMN_IDS.map((columnId) => (
              <col
                key={columnId}
                style={{ width: `${columnWidths[columnId]}px` }}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              <TableHeaderCell> </TableHeaderCell>
              <TableHeaderCell
                title="Message ID"
                {...getSortProps('id')}
                {...getResizeProps('id')}
              />
              <TableHeaderCell
                title="Offset"
                {...getSortProps('offset')}
                {...getResizeProps('offset')}
              />
              <TableHeaderCell
                title="Partition"
                {...getSortProps('partition')}
                {...getResizeProps('partition')}
              />
              <TableHeaderCell
                title="Timestamp"
                {...getSortProps('timestamp')}
                {...getResizeProps('timestamp')}
              />
              <TableHeaderCell
                title="Size"
                {...getSortProps('size')}
                {...getResizeProps('size')}
              />
              <TableHeaderCell
                title="Key"
                {...getSortProps('key')}
                previewText={`Preview ${
                  keyFilters.length ? `(${keyFilters.length} selected)` : ''
                }`}
                onPreview={() => setPreviewFor('key')}
                {...getResizeProps('key')}
              />
              <TableHeaderCell
                title="Headers"
                {...getSortProps('headers')}
                previewText={`Preview ${
                  headersFilters.length
                    ? `(${headersFilters.length} selected)`
                    : ''
                }`}
                onPreview={() => setPreviewFor('headers')}
                {...getResizeProps('headers')}
              />
              <TableHeaderCell
                title="Value"
                {...getSortProps('value')}
                previewText={`Preview ${
                  contentFilters.length
                    ? `(${contentFilters.length} selected)`
                    : ''
                }`}
                onPreview={() => setPreviewFor('content')}
                {...getResizeProps('value')}
              />
              <TableHeaderCell> </TableHeaderCell>
            </tr>
          </thead>
          <tbody>
            {!cancelled &&
              messages.map((message: TopicMessage, index) => (
                <Message
                  key={messageRowKeys[index]}
                  message={message}
                  keyFilters={keyFilters}
                  headersFilters={headersFilters}
                  contentFilters={contentFilters}
                  isLiveArrival={isLive && animateLiveArrivals}
                  searchTerms={searchTerms}
                />
              ))}
            {!cancelled && isFetching && !messages.length && (
              <tr>
                <td colSpan={10}>
                  <span role="status">{emptyMessagesText}</span>
                </td>
              </tr>
            )}
            {!cancelled && messages.length === 0 && !isFetching && (
              <tr>
                <td colSpan={10}>No messages found</td>
              </tr>
            )}
          </tbody>
        </TableS.ResizableTable>
      </TableS.TableViewport>
    </div>
  );
};

export default MessagesTable;
