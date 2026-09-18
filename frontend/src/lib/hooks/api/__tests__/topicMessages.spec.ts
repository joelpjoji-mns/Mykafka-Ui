import { act, renderHook, waitFor } from '@testing-library/react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { renderQueryHook, TestQueryClientProvider } from 'lib/testHelpers';
import * as hooks from 'lib/hooks/api/topicMessages';
import { showServerError } from 'lib/errorHandling';
import fetchMock from 'fetch-mock';
import { UseQueryResult, UseSuspenseQueryResult } from '@tanstack/react-query';
import { SerdeUsage, TopicMessageEventTypeEnum } from 'generated-sources';
import { MESSAGES_PER_PAGE, MessagesFilterKeys } from 'lib/constants';
import { MemoryRouter } from 'react-router-dom';
import { createElement, type PropsWithChildren } from 'react';

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
