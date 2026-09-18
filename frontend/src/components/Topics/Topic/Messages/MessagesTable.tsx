import PageLoader from 'components/common/PageLoader/PageLoader';
import TableHeaderCell from 'components/common/table/TableHeaderCell/TableHeaderCell';
import { TopicMessage } from 'generated-sources';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from 'components/common/Button/Button';
import * as S from 'components/common/NewTable/Table.styled';
import { usePaginateTopics, useIsLiveMode } from 'lib/hooks/useMessagesFilters';
import { useMessageFiltersStore } from 'lib/hooks/useMessageFiltersStore';
import useAppParams from 'lib/hooks/useAppParams';
import { RouteParamsClusterTopic } from 'lib/paths';
import { useLocalStorage } from 'lib/hooks/useLocalStorage';

import Message, { PreviewFilter } from './Message';
import PreviewModal from './PreviewModal';
import * as TableS from './MessagesTable.styled';

export interface MessagesTableProps {
  messages: TopicMessage[];
  isFetching: boolean;
  animateLiveArrivals?: boolean;
}

type PreviewTarget = 'key' | 'headers' | 'content';

type MessageColumnId =
  | 'toggle'
  | 'offset'
  | 'partition'
  | 'timestamp'
  | 'key'
  | 'headers'
  | 'value'
  | 'actions';

type ResizableMessageColumnId = Exclude<MessageColumnId, 'toggle' | 'actions'>;

type MessageColumnWidths = Record<MessageColumnId, number>;

type StoredMessageColumnWidths = Record<string, Partial<MessageColumnWidths>>;

const MESSAGE_COLUMN_IDS: MessageColumnId[] = [
  'toggle',
  'offset',
  'partition',
  'timestamp',
  'key',
  'headers',
  'value',
  'actions',
];

const DEFAULT_COLUMN_WIDTHS: MessageColumnWidths = {
  toggle: 48,
  offset: 96,
  partition: 112,
  timestamp: 220,
  key: 280,
  headers: 260,
  value: 320,
  actions: 56,
};

const MINIMUM_COLUMN_WIDTHS: MessageColumnWidths = {
  toggle: 48,
  offset: 72,
  partition: 88,
  timestamp: 160,
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
  animateLiveArrivals = false,
}) => {
  const paginate = usePaginateTopics();
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
              <TableHeaderCell title="Offset" {...getResizeProps('offset')} />
              <TableHeaderCell
                title="Partition"
                {...getResizeProps('partition')}
              />
              <TableHeaderCell
                title="Timestamp"
                {...getResizeProps('timestamp')}
              />
              <TableHeaderCell
                title="Key"
                previewText={`Preview ${
                  keyFilters.length ? `(${keyFilters.length} selected)` : ''
                }`}
                onPreview={() => setPreviewFor('key')}
                {...getResizeProps('key')}
              />
              <TableHeaderCell
                title="Headers"
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
            {messages.map((message: TopicMessage) => (
              <Message
                key={[
                  message.offset,
                  message.timestamp,
                  message.key,
                  message.partition,
                ].join('-')}
                message={message}
                keyFilters={keyFilters}
                headersFilters={headersFilters}
                contentFilters={contentFilters}
                isLiveArrival={isLive && animateLiveArrivals}
              />
            ))}
            {isFetching && !messages.length && (
              <tr>
                <td colSpan={8}>
                  <PageLoader />
                </td>
              </tr>
            )}
            {messages.length === 0 && !isFetching && (
              <tr>
                <td colSpan={8}>No messages found</td>
              </tr>
            )}
          </tbody>
        </TableS.ResizableTable>
      </TableS.TableViewport>
      <S.Pagination>
        <S.Pages>
          <Button
            disabled={isLive || isFetching || !nextCursor}
            buttonType="secondary"
            buttonSize="L"
            onClick={paginate}
          >
            Next →
          </Button>
        </S.Pages>
      </S.Pagination>
    </div>
  );
};

export default MessagesTable;
