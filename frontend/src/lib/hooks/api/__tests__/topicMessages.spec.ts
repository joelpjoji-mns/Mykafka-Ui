import { act, renderHook, waitFor } from '@testing-library/react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { renderQueryHook, TestQueryClientProvider } from 'lib/testHelpers';
import * as hooks from 'lib/hooks/api/topicMessages';
import { showServerError } from 'lib/errorHandling';
import fetchMock from 'fetch-mock';
import { UseQueryResult, UseSuspenseQueryResult } from '@tanstack/react-query';
import { SerdeUsage, TopicMessageEventTypeEnum } from 'generated-sources';
import { MESSAGES_PER_PAGE, MessagesFilterKeys } from 'lib/constants';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { createElement, Fragment, type PropsWithChildren } from 'react';
import { useMessageFiltersStore } from 'lib/hooks/useMessageFiltersStore';
import { clearCachedSortedMessagePages } from 'lib/hooks/api/topicMessages';

const clusterName = 'test-cluster';
const topicName = 'test-topic';

const expectQueryWorks = async (
  mock: fetchMock.FetchMockStatic,
  result: {
    current:
      | UseQueryResult<unknown, unknown>
      | UseSuspenseQueryResult<unknown, unknown>;
  }
) => {
  await waitFor(() => expect(result.current.isFetched).toBeTruthy());
  expect(mock.calls()).toHaveLength(1);
  expect(result.current.data).toBeDefined();
};

jest.mock('lib/errorHandling', () => ({
  ...jest.requireActual('lib/errorHandling'),
  showServerError: jest.fn(),
}));

jest.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: jest.fn(),
}));

const MessagesHookRouter = ({ children }: PropsWithChildren) =>
  createElement(MemoryRouter, null, children);

const TimeRangeMessagesHookRouter = ({ children }: PropsWithChildren) =>
  createElement(
    MemoryRouter,
    {
      initialEntries: [
        '/?mode=FROM_TIMESTAMP&timestamp=1704067200000&timestampTo=1704153600000',
      ],
    },
    children
  );

describe('Topic Messages hooks', () => {
  const createObjectURL = jest.fn(() => 'blob:messages');
  const revokeObjectURL = jest.fn();
  const click = jest
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation();

  beforeEach(() => {
    useMessageFiltersStore.getState().setNextCursor(undefined);
    clearCachedSortedMessagePages();
    fetchMock.restore();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    createObjectURL.mockClear();
    createObjectURL.mockReturnValue('blob:messages');
    revokeObjectURL.mockClear();
    click.mockClear();
    (fetchEventSource as jest.Mock).mockResolvedValue(undefined);
  });

  it('handles useSerdes', async () => {
    const path = `/api/clusters/${clusterName}/topics/${topicName}/serdes?use=SERIALIZE`;

    const mock = fetchMock.getOnce(path, {});
    const { result } = renderQueryHook(() =>
      hooks.useSerdes({ clusterName, topicName, use: SerdeUsage.SERIALIZE })
    );
    await expectQueryWorks(mock, result);
  });

  it('appends primary and refinement string filters as repeated params', () => {
    const requestParams = new URLSearchParams({ limit: '100' });

    hooks.appendStringFilters(requestParams, 'primary', [
      'secondary',
      '',
      'third',
    ]);

    expect(requestParams.getAll(MessagesFilterKeys.stringFilter)).toEqual([
      'primary',
      'secondary',
      'third',
    ]);
  });

  it('starts a fresh message stream in tailing mode', async () => {
    const { unmount } = renderHook(
      () => hooks.useTopicMessages({ clusterName, topicName }),
      { wrapper: MessagesHookRouter }
    );

    await waitFor(() => {
      expect(fetchEventSource).toHaveBeenCalledWith(
        expect.stringContaining('mode=TAILING'),
        expect.objectContaining({ method: 'GET' })
      );
    });

    unmount();
  });

  it('forwards whole-topic sorting and forces a finite scan instead of live mode', async () => {
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(
        MemoryRouter,
        {
          initialEntries: [
            '/?mode=TAILING&orderBy=size&sortOrder=DESC&limit=1000',
          ],
        },
        children
      );
    const { unmount } = renderHook(
      () => hooks.useTopicMessages({ clusterName, topicName }),
      { wrapper }
    );
    await waitFor(() => expect(fetchEventSource).toHaveBeenCalled());
    const params = new URL(
      (fetchEventSource as jest.Mock).mock.calls.at(-1)[0],
      'http://localhost'
    ).searchParams;
    expect(params.get('mode')).toBe('EARLIEST');
    expect(params.get('orderBy')).toBe('size');
    expect(params.get('sortOrder')).toBe('DESC');
    expect(params.get('limit')).toBe('1000');
    unmount();
  });

  it('shows provisional sort results and replaces them with the final ranking', async () => {
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(
        MemoryRouter,
        { initialEntries: ['/?orderBy=size&sortOrder=DESC'] },
        children
      );
    const { result, unmount } = renderHook(
      () => hooks.useTopicMessages({ clusterName, topicName }),
      { wrapper }
    );

    await waitFor(() => expect(fetchEventSource).toHaveBeenCalledTimes(1));
    const options = (fetchEventSource as jest.Mock).mock.calls[0][1];
    await act(async () => {
      options.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.PHASE,
          phase: { name: 'Provisional sort results' },
        }),
      });
      options.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.MESSAGE,
          message: { partition: 0, offset: 1, value: 'provisional' },
        }),
      });
      options.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.PHASE,
          phase: { name: 'Provisional sort results complete' },
        }),
      });
    });

    await waitFor(() => {
      expect(result.current.isProvisionalRanking).toBe(true);
      expect(result.current.messages.map(({ value }) => value)).toEqual([
        'provisional',
      ]);
    });

    await act(async () => {
      options.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.PHASE,
          phase: { name: 'Final sort results' },
        }),
      });
      options.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.MESSAGE,
          message: { partition: 1, offset: 2, value: 'final' },
        }),
      });
      options.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.PHASE,
          phase: { name: 'Final sort results complete' },
        }),
      });
      options.onclose();
    });

    await waitFor(() => {
      expect(result.current.isProvisionalRanking).toBe(false);
      expect(result.current.messages.map(({ value }) => value)).toEqual([
        'final',
      ]);
    });
    unmount();
  });

  it('keeps provisional result counts from shrinking during the scan', async () => {
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(
        MemoryRouter,
        { initialEntries: ['/?orderBy=size&sortOrder=DESC'] },
        children
      );
    const { result, unmount } = renderHook(
      () => hooks.useTopicMessages({ clusterName, topicName }),
      { wrapper }
    );

    await waitFor(() => expect(fetchEventSource).toHaveBeenCalledTimes(1));
    const options = (fetchEventSource as jest.Mock).mock.calls[0][1];
    const emitPreview = (offsets: number[]) => {
      options.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.PHASE,
          phase: { name: 'Provisional sort results' },
        }),
      });
      offsets.forEach((offset) => {
        options.onmessage({
          data: JSON.stringify({
            type: TopicMessageEventTypeEnum.MESSAGE,
            message: { partition: 0, offset, value: `preview-${offset}` },
          }),
        });
      });
      options.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.PHASE,
          phase: { name: 'Provisional sort results complete' },
        }),
      });
    };

    await act(async () => emitPreview([1, 2, 3]));
    await waitFor(() => expect(result.current.messages).toHaveLength(3));

    await act(async () => emitPreview([4]));

    expect(result.current.messages.map(({ value }) => value)).toEqual([
      'preview-1',
      'preview-2',
      'preview-3',
    ]);
    unmount();
  });

  it('loads the next globally sorted page and clears the cursor at the end', async () => {
    const navigation: { navigate?: ReturnType<typeof useNavigate> } = {};
    const CaptureNavigation = () => {
      navigation.navigate = useNavigate();
      return null;
    };
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(
        MemoryRouter,
        { initialEntries: ['/?orderBy=size&sortOrder=DESC'] },
        createElement(
          Fragment,
          null,
          children,
          createElement(CaptureNavigation)
        )
      );
    const { result, unmount } = renderHook(
      () => hooks.useTopicMessages({ clusterName, topicName }),
      { wrapper }
    );

    await waitFor(() => expect(fetchEventSource).toHaveBeenCalledTimes(1));
    const firstPageOptions = (fetchEventSource as jest.Mock).mock.calls[0][1];
    await act(async () => {
      firstPageOptions.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.PHASE,
          phase: { name: 'Final sort results' },
        }),
      });
      firstPageOptions.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.MESSAGE,
          message: { partition: 0, offset: 1, value: 'page-1' },
        }),
      });
      firstPageOptions.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.PHASE,
          phase: { name: 'Final sort results complete' },
        }),
      });
      firstPageOptions.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.DONE,
          cursor: { id: 'sorted-page-2' },
        }),
      });
      firstPageOptions.onclose();
    });

    await waitFor(() => {
      expect(result.current.messages.map(({ value }) => value)).toEqual([
        'page-1',
      ]);
      expect(useMessageFiltersStore.getState().nextCursor).toBe(
        'sorted-page-2'
      );
    });

    await act(async () => {
      navigation.navigate?.('/?orderBy=size&sortOrder=DESC&cursor=1');
    });
    await waitFor(() => expect(fetchEventSource).toHaveBeenCalledTimes(2));
    const secondUrl = new URL(
      (fetchEventSource as jest.Mock).mock.calls[1][0],
      'http://localhost'
    );
    expect(secondUrl.searchParams.get('cursor')).toBe('sorted-page-2');

    const secondPageOptions = (fetchEventSource as jest.Mock).mock.calls[1][1];
    await act(async () => {
      secondPageOptions.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.PHASE,
          phase: { name: 'Sorted page results' },
        }),
      });
      secondPageOptions.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.MESSAGE,
          message: { partition: 1, offset: 2, value: 'page-2' },
        }),
      });
      secondPageOptions.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.PHASE,
          phase: { name: 'Sorted page results complete' },
        }),
      });
      secondPageOptions.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.DONE,
          cursor: null,
        }),
      });
      secondPageOptions.onclose();
    });

    await waitFor(() => {
      expect(result.current.messages.map(({ value }) => value)).toEqual([
        'page-2',
      ]);
      expect(useMessageFiltersStore.getState().nextCursor).toBeUndefined();
    });
    unmount();
  });

  it('reuses completed sorted pages after leaving and returning to Messages', async () => {
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(
        MemoryRouter,
        { initialEntries: ['/?orderBy=size&sortOrder=DESC'] },
        children
      );
    const firstRender = renderHook(
      () => hooks.useTopicMessages({ clusterName, topicName }),
      { wrapper }
    );

    await waitFor(() => expect(fetchEventSource).toHaveBeenCalledTimes(1));
    const options = (fetchEventSource as jest.Mock).mock.calls[0][1];
    await act(async () => {
      options.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.PHASE,
          phase: { name: 'Final sort results' },
        }),
      });
      options.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.MESSAGE,
          message: { partition: 0, offset: 1, value: 'cached-page' },
        }),
      });
      options.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.PHASE,
          phase: { name: 'Final sort results complete' },
        }),
      });
      options.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.DONE,
          cursor: { id: 'cached-next-page' },
        }),
      });
      options.onclose();
    });

    await waitFor(() =>
      expect(
        firstRender.result.current.messages.map(({ value }) => value)
      ).toEqual(['cached-page'])
    );
    firstRender.unmount();

    const secondRender = renderHook(
      () => hooks.useTopicMessages({ clusterName, topicName }),
      { wrapper }
    );
    await waitFor(() =>
      expect(
        secondRender.result.current.messages.map(({ value }) => value)
      ).toEqual(['cached-page'])
    );
    expect(useMessageFiltersStore.getState().nextCursor).toBe(
      'cached-next-page'
    );
    expect(fetchEventSource).toHaveBeenCalledTimes(1);
    secondRender.unmount();
  });

  it('requests the next sorted page with its cursor and clears Next at the end', async () => {
    const navigation: { navigate?: ReturnType<typeof useNavigate> } = {};
    const CaptureNavigation = () => {
      navigation.navigate = useNavigate();
      return null;
    };
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(
        MemoryRouter,
        { initialEntries: ['/?orderBy=size&sortOrder=DESC'] },
        createElement(
          Fragment,
          null,
          children,
          createElement(CaptureNavigation)
        )
      );
    const { result, unmount } = renderHook(
      () => hooks.useTopicMessages({ clusterName, topicName }),
      { wrapper }
    );

    await waitFor(() => expect(fetchEventSource).toHaveBeenCalledTimes(1));
    const firstPageOptions = (fetchEventSource as jest.Mock).mock.calls[0][1];
    await act(async () => {
      firstPageOptions.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.PHASE,
          phase: { name: 'Final sort results' },
        }),
      });
      firstPageOptions.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.MESSAGE,
          message: { partition: 0, offset: 1, value: 'page-1' },
        }),
      });
      firstPageOptions.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.PHASE,
          phase: { name: 'Final sort results complete' },
        }),
      });
      firstPageOptions.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.DONE,
          cursor: { id: 'sorted-page-2' },
        }),
      });
      firstPageOptions.onclose();
    });

    await waitFor(() => {
      expect(result.current.messages.map(({ value }) => value)).toEqual([
        'page-1',
      ]);
      expect(useMessageFiltersStore.getState().nextCursor).toBe(
        'sorted-page-2'
      );
    });

    await act(async () => {
      navigation.navigate?.('/?orderBy=size&sortOrder=DESC&cursor=1');
    });
    await waitFor(() => expect(fetchEventSource).toHaveBeenCalledTimes(2));

    const secondUrl = new URL(
      (fetchEventSource as jest.Mock).mock.calls[1][0],
      'http://localhost'
    );
    expect(secondUrl.searchParams.get('cursor')).toBe('sorted-page-2');

    const secondPageOptions = (fetchEventSource as jest.Mock).mock.calls[1][1];
    await act(async () => {
      secondPageOptions.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.PHASE,
          phase: { name: 'Sorted page results' },
        }),
      });
      secondPageOptions.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.MESSAGE,
          message: { partition: 1, offset: 2, value: 'page-2' },
        }),
      });
      secondPageOptions.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.PHASE,
          phase: { name: 'Sorted page results complete' },
        }),
      });
      secondPageOptions.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.DONE,
          cursor: null,
        }),
      });
      secondPageOptions.onclose();
    });

    await waitFor(() => {
      expect(result.current.messages.map(({ value }) => value)).toEqual([
        'page-2',
      ]);
      expect(useMessageFiltersStore.getState().nextCursor).toBeUndefined();
    });
    unmount();
  });

  it('keeps a refreshed stream cancellable when the previous stream closes', async () => {
    const { result, rerender, unmount } = renderHook(
      ({ stringFilters }) =>
        hooks.useTopicMessages({ clusterName, topicName, stringFilters }),
      {
        initialProps: { stringFilters: ['first'] },
        wrapper: MessagesHookRouter,
      }
    );

    await waitFor(() => expect(fetchEventSource).toHaveBeenCalledTimes(1));
    const firstStreamOptions = (fetchEventSource as jest.Mock).mock.calls[0][1];

    await act(async () => {
      await firstStreamOptions.onopen({ ok: true, status: 200 });
      firstStreamOptions.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.MESSAGE,
          message: { partition: 0, offset: 1, value: 'stale-message' },
        }),
      });
    });

    await waitFor(() =>
      expect(result.current.messages[0]?.value).toBe('stale-message')
    );

    rerender({ stringFilters: ['second'] });

    await waitFor(() => expect(fetchEventSource).toHaveBeenCalledTimes(2));
    const secondStreamOptions = (fetchEventSource as jest.Mock).mock
      .calls[1][1];
    expect(firstStreamOptions.signal.aborted).toBe(true);
    expect(result.current.messages).toEqual([]);

    await act(async () => {
      firstStreamOptions.onclose();
      firstStreamOptions.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.MESSAGE,
          message: { partition: 0, offset: 2, value: 'late-stale-message' },
        }),
      });
      await secondStreamOptions.onopen({ ok: true, status: 200 });
      secondStreamOptions.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.MESSAGE,
          message: { partition: 0, offset: 3, value: 'current-message' },
        }),
      });
    });

    await waitFor(() =>
      expect(result.current.messages.map((message) => message.value)).toEqual([
        'current-message',
      ])
    );
    act(() => result.current.abortFetchData());

    expect(secondStreamOptions.signal.aborted).toBe(true);
    unmount();
  });

  it('aborts while the search draft is pending and ignores obsolete stream events', async () => {
    const { result, rerender, unmount } = renderHook(
      ({ enabled, stringFilters }) =>
        hooks.useTopicMessages({
          clusterName,
          topicName,
          enabled,
          stringFilters,
        }),
      {
        initialProps: { enabled: true, stringFilters: ['first'] },
        wrapper: TimeRangeMessagesHookRouter,
      }
    );
    await waitFor(() => expect(fetchEventSource).toHaveBeenCalledTimes(1));
    const oldStream = (fetchEventSource as jest.Mock).mock.calls[0][1];
    act(() => {
      oldStream.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.MESSAGE,
          message: { partition: 0, offset: 1, value: 'first-result' },
        }),
      });
      oldStream.onclose();
    });
    expect(result.current.messages.map((message) => message.value)).toEqual([
      'first-result',
    ]);
    expect(result.current.isFetching).toBe(false);
    rerender({ enabled: false, stringFilters: ['first'] });
    expect(oldStream.signal.aborted).toBe(true);
    expect(result.current.messages).toEqual([]);
    expect(fetchEventSource).toHaveBeenCalledTimes(1);
    act(() => {
      oldStream.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.MESSAGE,
          message: { partition: 0, offset: 2, value: 'obsolete-result' },
        }),
      });
    });
    expect(result.current.messages).toEqual([]);
    rerender({ enabled: true, stringFilters: ['second'] });
    await waitFor(() => expect(fetchEventSource).toHaveBeenCalledTimes(2));
    expect(result.current.messages).toEqual([]);
    const newStream = (fetchEventSource as jest.Mock).mock.calls[1][1];
    act(() => {
      newStream.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.MESSAGE,
          message: { partition: 0, offset: 3, value: 'second-result' },
        }),
      });
      newStream.onclose();
    });
    expect(result.current.messages.map((message) => message.value)).toEqual([
      'second-result',
    ]);
    expect(result.current.isFetching).toBe(false);
    unmount();
  });

  it('surfaces an active stream error once and stops the retry loop', async () => {
    const { result, unmount } = renderHook(
      () => hooks.useTopicMessages({ clusterName, topicName }),
      { wrapper: MessagesHookRouter }
    );

    await waitFor(() => expect(fetchEventSource).toHaveBeenCalledTimes(1));
    const streamOptions = (fetchEventSource as jest.Mock).mock.calls[0][1];
    const error = new Error('stream disconnected');

    act(() => {
      expect(() => streamOptions.onerror(error)).toThrow(error);
    });

    expect(showServerError).toHaveBeenCalledWith(error);
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    unmount();
  });

  it('reports failures that occur before stream callbacks and stops loading', async () => {
    const error = new Error('Unable to start message stream');
    (fetchEventSource as jest.Mock).mockRejectedValueOnce(error);
    const { result, unmount } = renderHook(
      () => hooks.useTopicMessages({ clusterName, topicName }),
      { wrapper: MessagesHookRouter }
    );

    await waitFor(() => expect(showServerError).toHaveBeenCalledWith(error));
    expect(showServerError).toHaveBeenCalledTimes(1);
    expect(result.current.isFetching).toBe(false);
    unmount();
  });

  it('rejects an unsuccessful stream response without duplicate error alerts', async () => {
    const { result, unmount } = renderHook(
      () => hooks.useTopicMessages({ clusterName, topicName }),
      { wrapper: MessagesHookRouter }
    );
    await waitFor(() => expect(fetchEventSource).toHaveBeenCalledTimes(1));
    const options = (fetchEventSource as jest.Mock).mock.calls[0][1];
    const response = { ok: false, status: 403 };

    await act(async () => {
      await expect(options.onopen(response)).rejects.toThrow(
        'Message stream request failed (403)'
      );
      expect(() => options.onerror(new Error('Forbidden'))).toThrow(
        'Forbidden'
      );
    });

    expect(showServerError).toHaveBeenCalledTimes(1);
    expect(showServerError).toHaveBeenCalledWith(response);
    expect(result.current.isFetching).toBe(false);
    unmount();
  });

  it('keeps the recent tailing snapshot ordered before prepending live records', async () => {
    const historicalNewest = {
      partition: 0,
      offset: 2,
      value: 'history-newest',
    };
    const historicalOldest = {
      partition: 0,
      offset: 1,
      value: 'history-oldest',
    };
    const liveMessage = { partition: 0, offset: 3, value: 'live-message' };
    const { result, unmount } = renderHook(
      () => hooks.useTopicMessages({ clusterName, topicName }),
      { wrapper: MessagesHookRouter }
    );

    await waitFor(() => expect(fetchEventSource).toHaveBeenCalledTimes(1));

    const options = (fetchEventSource as jest.Mock).mock.calls[0][1];
    await act(async () => {
      await options.onopen({ ok: true, status: 200 });
      options.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.MESSAGE,
          message: historicalNewest,
        }),
      });
      options.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.MESSAGE,
          message: historicalOldest,
        }),
      });
      options.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.PHASE,
          phase: { name: 'Live polling' },
        }),
      });
      options.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.MESSAGE,
          message: liveMessage,
        }),
      });
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual([
        liveMessage,
        historicalNewest,
        historicalOldest,
      ]);
      expect(result.current.isLiveStreamReady).toBe(true);
    });

    unmount();
  });

  it('retains only the latest live messages', async () => {
    const { result, unmount } = renderHook(
      () => hooks.useTopicMessages({ clusterName, topicName }),
      { wrapper: MessagesHookRouter }
    );

    await waitFor(() => expect(fetchEventSource).toHaveBeenCalledTimes(1));
    const options = (fetchEventSource as jest.Mock).mock.calls[0][1];
    const liveMessageLimit = Number(MESSAGES_PER_PAGE);

    await act(async () => {
      options.onmessage({
        data: JSON.stringify({
          type: TopicMessageEventTypeEnum.PHASE,
          phase: { name: 'Live polling' },
        }),
      });
      for (let offset = 0; offset <= liveMessageLimit; offset += 1) {
        options.onmessage({
          data: JSON.stringify({
            type: TopicMessageEventTypeEnum.MESSAGE,
            message: { partition: 0, offset },
          }),
        });
      }
    });

    await waitFor(() =>
      expect(result.current.messages).toHaveLength(liveMessageLimit)
    );
    expect(result.current.messages[0].offset).toBe(liveMessageLimit);
    expect(result.current.messages.at(-1)?.offset).toBe(1);
    unmount();
  });

  it('clears queued messages when the stream is aborted', async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    const requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
      const frameId = callbacks.size + 1;
      callbacks.set(frameId, callback);
      return frameId;
    });
    const cancelAnimationFrame = jest.fn((frameId: number) => {
      callbacks.delete(frameId);
    });

    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: requestAnimationFrame,
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      value: cancelAnimationFrame,
    });

    try {
      const { result, unmount } = renderHook(
        () => hooks.useTopicMessages({ clusterName, topicName }),
        { wrapper: MessagesHookRouter }
      );

      await waitFor(() => expect(fetchEventSource).toHaveBeenCalledTimes(1));
      const options = (fetchEventSource as jest.Mock).mock.calls[0][1];

      act(() => {
        options.onmessage({
          data: JSON.stringify({
            type: TopicMessageEventTypeEnum.MESSAGE,
            message: { partition: 0, offset: 1 },
          }),
        });
        result.current.abortFetchData();
      });

      callbacks.forEach((callback) => callback(0));

      expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
      expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
      expect(result.current.messages).toEqual([]);
      unmount();
    } finally {
      Object.defineProperty(window, 'requestAnimationFrame', {
        configurable: true,
        value: originalRequestAnimationFrame,
      });
      Object.defineProperty(window, 'cancelAnimationFrame', {
        configurable: true,
        value: originalCancelAnimationFrame,
      });
    }
  });

  it('forwards the selected end timestamp to the message stream', async () => {
    const { unmount } = renderHook(
      () => hooks.useTopicMessages({ clusterName, topicName }),
      { wrapper: TimeRangeMessagesHookRouter }
    );

    await waitFor(() => {
      expect(fetchEventSource).toHaveBeenCalledWith(
        expect.stringContaining('timestampTo=1704153600000'),
        expect.objectContaining({ method: 'GET' })
      );
    });

    unmount();
  });

  it('downloads topic messages zip with repeated string filters', async () => {
    const path = `/api/clusters/${clusterName}/topics/${topicName}/messages/download?limit=2&partitions=0%2C1&stringFilter=payload&stringFilter=secondary&smartFilterId=abc123&keySerde=String&valueSerde=String`;
    const mock = fetchMock.getOnce(path, {
      body: 'zip-content',
      headers: {
        'content-type': 'application/zip',
        'content-disposition': "attachment; filename*=UTF-8''messages.zip",
      },
    });
    const { result } = renderHook(() => hooks.useDownloadMessagesZip(), {
      wrapper: TestQueryClientProvider,
    });

    await act(() =>
      result.current.mutateAsync({
        clusterName,
        topicName,
        limit: 2,
        partitions: ['0', '1'],
        stringFilters: ['payload', 'secondary'],
        smartFilterId: 'abc123',
        keySerde: 'String',
        valueSerde: 'String',
      })
    );

    expect(mock.calls()).toHaveLength(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:messages');
  });

  it('downloads with per-partition starting offsets', async () => {
    const path = `/api/clusters/${clusterName}/topics/${topicName}/messages/download?limit=5&downloadMode=FROM_OFFSET&format=JSON&partitionOffsets=p0%3A10%2Cp1%3A20`;
    const mock = fetchMock.getOnce(path, {
      body: 'zip-content',
      headers: {
        'content-type': 'application/zip',
      },
    });
    const { result } = renderHook(() => hooks.useDownloadMessagesZip(), {
      wrapper: TestQueryClientProvider,
    });

    await act(() =>
      result.current.mutateAsync({
        clusterName,
        topicName,
        limit: 5,
        downloadMode: 'FROM_OFFSET',
        format: 'JSON',
        partitionOffsets: 'p0:10,p1:20',
      })
    );

    expect(mock.calls()).toHaveLength(1);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('downloads with per-partition inclusive offset ranges', async () => {
    const path = `/api/clusters/${clusterName}/topics/${topicName}/messages/download?limit=5&downloadMode=FROM_OFFSET&format=JSON&partitionOffsetRanges=p0%3A10-15%2Cp1%3A20-25`;
    const mock = fetchMock.getOnce(path, {
      body: 'zip-content',
      headers: {
        'content-type': 'application/zip',
      },
    });
    const { result } = renderHook(() => hooks.useDownloadMessagesZip(), {
      wrapper: TestQueryClientProvider,
    });

    await act(() =>
      result.current.mutateAsync({
        clusterName,
        topicName,
        limit: 5,
        downloadMode: 'FROM_OFFSET',
        format: 'JSON',
        partitionOffsetRanges: 'p0:10-15,p1:20-25',
      })
    );

    expect(mock.calls()).toHaveLength(1);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('uploads topic message files', async () => {
    const path = `/api/clusters/${clusterName}/topics/${topicName}/messages/upload`;
    const response = {
      dryRun: true,
      filesReceived: 1,
      entriesRead: 1,
      messagesParsed: 1,
      messagesProduced: 0,
      failures: 0,
      files: [],
      previews: [],
      errors: [],
    };
    const mock = fetchMock.postOnce(path, response);
    const file = new File(['hello'], 'message.txt', { type: 'text/plain' });
    const { result } = renderHook(() => hooks.useUploadMessages(), {
      wrapper: TestQueryClientProvider,
    });

    await act(() =>
      result.current.mutateAsync({
        clusterName,
        topicName,
        files: [file],
        parseMode: 'FILE_PER_MESSAGE',
        partitionStrategy: 'ANY',
        keyMode: 'NONE',
        keySerde: 'String',
        valueSerde: 'String',
        includeMetadataHeaders: true,
        dryRun: true,
        messageLimit: '1000',
      })
    );

    const body = mock.lastCall()?.[1]?.body as FormData;

    expect(mock.calls()).toHaveLength(1);
    expect(body.getAll('files')).toHaveLength(1);
    expect(body.get('parseMode')).toBe('FILE_PER_MESSAGE');
    expect(body.get('dryRun')).toBe('true');
  });
});
