import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from 'lib/testHelpers';
import MessagesTable, {
  MessagesTableProps,
} from 'components/Topics/Topic/Messages/MessagesTable';
import { TopicMessage, TopicMessageTimestampTypeEnum } from 'generated-sources';
import { useIsLiveMode } from 'lib/hooks/useMessagesFilters';
import useAppParams from 'lib/hooks/useAppParams';
import { LOCAL_STORAGE_KEY_PREFIX } from 'lib/constants';
import { TopicActionsProvider } from 'components/contexts/TopicActionsContext';
import { useLocation } from 'react-router-dom';
import { useMessageFiltersStore } from 'lib/hooks/useMessageFiltersStore';
import {
  messageCompareScope,
  useMessageCompareStore,
} from 'lib/hooks/useMessageCompareStore';

const QueryLocation = () => (
  <output data-testid="query-location">{useLocation().search}</output>
);

export const topicMessagePayload: TopicMessage = {
  partition: 29,
  offset: 14,
  timestamp: new Date('2021-07-21T23:25:14.865Z'),
  timestampType: TopicMessageTimestampTypeEnum.CREATE_TIME,
  key: 'schema-registry',
  headers: { header: 'test' },
  value:
    '{"host":"schemaregistry1","port":8085,"master_eligibility":true,"scheme":"http","version":1}',
};

const mockTopicsMessages = [{ ...topicMessagePayload }];

const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('lib/hooks/useMessagesFilters', () => ({
  useIsLiveMode: jest.fn(),
  usePaginateTopics: jest.fn(),
}));

jest.mock('lib/hooks/useAppParams', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock(
  'components/Topics/Topic/Messages/MessageCompare/MessageCompareModal',
  () => ({
    __esModule: true,
    default: ({
      messages,
      onClose,
    }: {
      messages: TopicMessage[];
      onClose: () => void;
    }) => (
      <div role="dialog" aria-label="Compare messages">
        {messages.map(({ offset }) => offset).join(' vs ')}
        <button type="button" onClick={onClose}>
          close compare
        </button>
      </div>
    ),
  })
);

describe('MessagesTable', () => {
  beforeEach(() => {
    localStorage.clear();
    useMessageFiltersStore.getState().setNextCursor(undefined);
    useMessageCompareStore.getState().clear();
  });

  const renderComponent = (
    props?: Partial<MessagesTableProps>,
    query = '/'
  ) => {
    (useAppParams as jest.Mock).mockImplementation(() => ({
      clusterName: 'testCluster',
      topicName: 'testTopic',
    }));
    return render(
      <TopicActionsProvider openSidebarWithMessage={jest.fn()}>
        <MessagesTable messages={[]} isFetching={false} {...props} />
        <QueryLocation />
      </TopicActionsProvider>,
      { initialEntries: [query] }
    );
  };

  it('highlights URL search terms in rows and keeps duplicate records keyed uniquely', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation();
    renderComponent(
      {
        messages: [
          { ...topicMessagePayload, key: 'needle-key' },
          { ...topicMessagePayload, key: 'needle-key' },
          { ...topicMessagePayload, offset: 15, key: 'other' },
        ],
      },
      '/?mode=EARLIEST&stringFilter=needle'
    );

    const rows = screen.getByRole('table').querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
    const highlighted = screen.getByRole('table').querySelectorAll('mark');
    expect(highlighted).toHaveLength(2);
    expect(highlighted[0]).toHaveTextContent('needle');
    expect(
      consoleError.mock.calls.some((args) =>
        args.some((arg) => String(arg).includes('same key'))
      )
    ).toBe(false);
    consoleError.mockRestore();
  });

  it('requests full-topic ascending/descending rankings without locally reordering rows', async () => {
    renderComponent(
      {
        messages: [
          { ...topicMessagePayload, offset: 10, valueSize: 100 },
          { ...topicMessagePayload, offset: 1, valueSize: 1 },
        ],
      },
      '/?mode=EARLIEST&stringFilter=needle'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Size' }));
    let params = new URLSearchParams(
      screen.getByTestId('query-location').textContent || ''
    );
    expect(params.get('orderBy')).toBe('size');
    expect(params.get('sortOrder')).toBe('ASC');
    expect(params.get('stringFilter')).toBe('needle');
    expect(
      screen.queryByRole('listbox', { name: 'Sorting scope' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next →' })).toBeDisabled();
    const offsets = Array.from(
      screen.getByRole('table').querySelectorAll('tbody tr')
    ).map((row) => Number(row.querySelectorAll('td')[2].textContent));
    expect(offsets).toEqual([10, 1]);
    await userEvent.click(screen.getByRole('button', { name: 'Size' }));
    params = new URLSearchParams(
      screen.getByTestId('query-location').textContent || ''
    );
    expect(params.get('sortOrder')).toBe('DESC');
  });

  it('shows full-topic progress and cancels without presenting a partial ranking', async () => {
    const abortFetchData = jest.fn();
    renderComponent(
      {
        messages: [topicMessagePayload],
        isFetching: true,
        isProvisionalRanking: true,
        abortFetchData,
        consumptionStats: {
          messagesConsumed: 1200,
          bytesConsumed: 10000,
          elapsedMs: 50,
        },
      },
      '/?orderBy=size&sortOrder=DESC'
    );
    expect(
      screen.getByText(
        'Scanning whole topic: 1200 records read. Showing 1 provisional sorted results.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText(topicMessagePayload.value!)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Cancel topic scan' })
    );
    expect(abortFetchData).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText('Scan cancelled. No partial ranking is shown.')
    ).toBeInTheDocument();
    expect(
      screen.queryByText(topicMessagePayload.value!)
    ).not.toBeInTheDocument();
  });

  it('keeps Next visible while the exact whole-topic ranking is being built', () => {
    renderComponent(
      {
        messages: [topicMessagePayload],
        isFetching: true,
        isProvisionalRanking: true,
      },
      '/?orderBy=size&sortOrder=DESC'
    );

    const nextButton = screen.getByRole('button', { name: 'Next →' });
    expect(nextButton).toBeVisible();
    expect(nextButton).toBeDisabled();
    expect(nextButton).toHaveAttribute(
      'title',
      'Next page is available after the full-topic ranking completes.'
    );
  });

  it('shows an in-table message while a filtered full-topic scan has no matches yet', () => {
    renderComponent(
      {
        isFetching: true,
        consumptionStats: {
          messagesConsumed: 12_000,
          bytesConsumed: 100_000,
          elapsedMs: 1_000,
        },
      },
      '/?orderBy=size&stringFilter=rare-match'
    );

    expect(
      screen.getByText(
        'Waiting for matching messages while the full-topic scan continues...'
      )
    ).toBeInTheDocument();
  });

  it('confirms when the whole-topic sort has completed', () => {
    renderComponent(
      { messages: [topicMessagePayload], isFetching: false },
      '/?orderBy=size&sortOrder=DESC'
    );

    expect(
      screen.getByText(
        'Whole-topic sort complete. Page 1: showing 1 matching records.'
      )
    ).toBeInTheDocument();
  });

  it('enables Next when a sorted result page has a continuation cursor', () => {
    useMessageFiltersStore.getState().setNextCursor('next-page-cursor');
    renderComponent(
      { messages: [topicMessagePayload], isFetching: false },
      '/?orderBy=size&sortOrder=DESC'
    );

    expect(screen.getByRole('button', { name: 'Next →' })).toBeEnabled();
  });

  it.each([
    ['Offset', 'offset'],
    ['Partition', 'partition'],
    ['Timestamp', 'timestamp'],
    ['Message ID', 'id'],
    ['Key', 'key'],
    ['Headers', 'headers'],
    ['Value', 'value'],
    ['Size', 'size'],
  ])(
    'requests global %s sorting without modifying incoming messages',
    async (heading, column) => {
      const messages = [
        {
          ...topicMessagePayload,
          offset: 10,
          partition: 2,
          timestamp: new Date('2024-02-01'),
          key: 'z',
          value: 'z',
          headers: { id: 'z' },
          keySize: 20,
          valueSize: 30,
          headersSize: 0,
        },
        {
          ...topicMessagePayload,
          offset: 2,
          partition: 1,
          timestamp: new Date('2024-01-01'),
          key: 'a',
          value: 'a',
          headers: { id: 'a' },
          keySize: 1,
          valueSize: 1,
          headersSize: 100,
        },
      ];
      renderComponent({ messages });
      const offsets = () =>
        Array.from(screen.getByRole('table').querySelectorAll('tbody tr')).map(
          (row) => Number(row.querySelectorAll('td')[2].textContent)
        );
      await userEvent.click(screen.getByRole('button', { name: heading }));
      let params = new URLSearchParams(
        screen.getByTestId('query-location').textContent || ''
      );
      expect(params.get('orderBy')).toBe(column);
      expect(params.get('sortOrder')).toBe('ASC');
      expect(offsets()).toEqual([10, 2]);
      await userEvent.click(screen.getByRole('button', { name: heading }));
      params = new URLSearchParams(
        screen.getByTestId('query-location').textContent || ''
      );
      expect(params.get('sortOrder')).toBe('DESC');
      expect(offsets()).toEqual([10, 2]);
      expect(messages.map(({ offset }) => offset)).toEqual([10, 2]);
    }
  );

  describe('Default props Setup for MessagesTable component', () => {
    beforeEach(() => {
      renderComponent();
    });

    it('should check the render', () => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('should check preview buttons', async () => {
      const previewButtons = await screen.findAllByRole('button', {
        name: 'Preview',
      });
      expect(previewButtons).toHaveLength(3);
    });

    it('resizes a data column and persists its width', () => {
      const resizeHandle = screen.getByRole('button', {
        name: 'Resize Key column',
      });
      const columns = screen.getByRole('table').querySelectorAll('col');

      fireEvent.keyDown(resizeHandle, { key: 'ArrowRight' });

      expect(columns[6]).toHaveStyle('width: 296px');
      expect(
        JSON.parse(
          global.localStorage.getItem(
            `${LOCAL_STORAGE_KEY_PREFIX}-message-table-widths`
          ) || '{}'
        )
      ).toEqual({
        'testCluster:testTopic': { key: 296 },
      });
    });

    it('throttles pointer resize updates and cancels pending work on unmount', () => {
      const callbacks = new Map<number, FrameRequestCallback>();
      const originalRequestAnimationFrame = window.requestAnimationFrame;
      const originalCancelAnimationFrame = window.cancelAnimationFrame;
      const requestAnimationFrame = jest.fn(
        (callback: FrameRequestCallback) => {
          const frameId = callbacks.size + 1;
          callbacks.set(frameId, callback);
          return frameId;
        }
      );
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
        cleanup();
        const { unmount } = renderComponent();
        const resizeHandle = screen.getByRole('button', {
          name: 'Resize Key column',
        });

        fireEvent(
          resizeHandle,
          new MouseEvent('pointerdown', { bubbles: true, clientX: 100 })
        );
        fireEvent(
          document,
          new MouseEvent('pointermove', { bubbles: true, clientX: 120 })
        );
        fireEvent(
          document,
          new MouseEvent('pointermove', { bubbles: true, clientX: 140 })
        );

        expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

        act(() => callbacks.get(1)?.(0));
        expect(
          screen.getByRole('table').querySelectorAll('col')[6]
        ).toHaveStyle('width: 320px');

        fireEvent(
          document,
          new MouseEvent('pointermove', { bubbles: true, clientX: 160 })
        );
        unmount();

        expect(cancelAnimationFrame).toHaveBeenCalledWith(2);
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

    it('should show preview modal with validation', async () => {
      await userEvent.click(screen.getAllByText('Preview')[0]);
      expect(screen.getByPlaceholderText('Field')).toHaveValue('');
      expect(screen.getByPlaceholderText('Json Path')).toHaveValue('');
    });

    it('should check the if no elements is rendered in the table', () => {
      expect(screen.getByText(/No messages found/i)).toBeInTheDocument();
    });
  });

  describe('Custom Setup with different props value', () => {
    it('should check if next button is disabled isLive Param', () => {
      renderComponent({ isFetching: true });
      expect(screen.queryByText(/next/i)).toBeDisabled();
    });

    it('should check if next button is disabled if there is no nextCursor', () => {
      (useIsLiveMode as jest.Mock).mockImplementation(() => false);
      renderComponent({ isFetching: false });
      expect(screen.queryByText(/next/i)).toBeDisabled();
    });

    it('pauses and resumes live tailing with a buffered arrival count', async () => {
      (useIsLiveMode as jest.Mock).mockImplementation(() => true);
      const onPauseLive = jest.fn();
      const onResumeLive = jest.fn();
      const { rerender } = renderComponent({
        animateLiveArrivals: true,
        onPauseLive,
        onResumeLive,
      });

      await userEvent.click(screen.getByRole('button', { name: 'Pause live' }));
      expect(onPauseLive).toHaveBeenCalledTimes(1);

      rerender(
        <TopicActionsProvider openSidebarWithMessage={jest.fn()}>
          <MessagesTable
            messages={[]}
            isFetching={false}
            animateLiveArrivals
            isLivePaused
            pausedArrivals={3}
            onPauseLive={onPauseLive}
            onResumeLive={onResumeLive}
          />
        </TopicActionsProvider>
      );
      const resume = screen.getByRole('button', {
        name: 'Resume live (3 new)',
      });
      expect(resume).toHaveAttribute('aria-pressed', 'true');
      await userEvent.click(resume);
      expect(onResumeLive).toHaveBeenCalledTimes(1);
    });

    it('hides the live pause control outside live tailing', () => {
      (useIsLiveMode as jest.Mock).mockImplementation(() => false);
      renderComponent({
        animateLiveArrivals: true,
        onPauseLive: jest.fn(),
        onResumeLive: jest.fn(),
      });
      expect(
        screen.queryByRole('button', { name: /pause live/i })
      ).not.toBeInTheDocument();
    });

    it('compares two selected messages and clears the selection', async () => {
      (useIsLiveMode as jest.Mock).mockImplementation(() => false);
      const second = { ...topicMessagePayload, offset: 15 };
      renderComponent({ messages: [topicMessagePayload, second] });
      const scope = messageCompareScope('testCluster', 'testTopic');

      act(() =>
        useMessageCompareStore.getState().toggle(scope, topicMessagePayload)
      );
      expect(
        screen.getByRole('button', { name: 'Compare (1 of 2 selected)' })
      ).toBeDisabled();
      expect(
        document.querySelectorAll('[data-compare-selected="true"]')
      ).toHaveLength(1);

      act(() => useMessageCompareStore.getState().toggle(scope, second));
      await userEvent.click(
        screen.getByRole('button', { name: 'Compare messages' })
      );
      expect(
        await screen.findByRole('dialog', { name: 'Compare messages' })
      ).toHaveTextContent('14 vs 15');

      await userEvent.click(
        screen.getByRole('button', { name: 'close compare' })
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'Clear compare' })
      );
      expect(
        screen.queryByRole('button', { name: /compare/i })
      ).not.toBeInTheDocument();
    });

    it('highlights the anchor message from surrounding messages', () => {
      (useIsLiveMode as jest.Mock).mockImplementation(() => false);
      const scrollIntoView = jest.fn();
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: scrollIntoView,
      });
      renderComponent(
        {
          messages: [
            { ...topicMessagePayload, offset: 13 },
            topicMessagePayload,
          ],
        },
        '/?mode=FROM_OFFSET&anchor=29:14'
      );

      const anchor = document.querySelector('tr[aria-current="true"]');
      expect(anchor).toHaveTextContent('29:14');
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    });

    it('ignores a stale anchor outside the surrounding-messages view', () => {
      (useIsLiveMode as jest.Mock).mockImplementation(() => true);
      renderComponent(
        { messages: [topicMessagePayload] },
        '/?mode=TAILING&anchor=29:14'
      );
      expect(document.querySelector('tr[aria-current]')).toBeNull();
    });

    it('shows inline loading status without a blocking spinner', () => {
      renderComponent({ isFetching: true });
      expect(screen.getByText('Loading messages...')).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
  });

  describe('should render Messages table with data', () => {
    beforeEach(() => {
      renderComponent({ messages: mockTopicsMessages, isFetching: false });
    });

    it('should check the rendering of the messages', () => {
      expect(screen.queryByText(/No messages found/i)).not.toBeInTheDocument();
      if (mockTopicsMessages[0].value) {
        expect(
          screen.getByText(mockTopicsMessages[0].value)
        ).toBeInTheDocument();
      }
      expect(
        screen.getByRole('columnheader', { name: /Headers/ })
      ).toBeInTheDocument();
    });

    it('marks messages as new only after the live stream is ready', () => {
      (useIsLiveMode as jest.Mock).mockReturnValue(true);
      renderComponent({
        messages: mockTopicsMessages,
        isFetching: false,
        animateLiveArrivals: true,
      });

      expect(
        document.querySelector('[data-live-arrival="true"]')
      ).toBeInTheDocument();
    });
  });

  describe('should save messages preview into localstorage', () => {
    beforeEach(() => {
      renderComponent({ messages: mockTopicsMessages, isFetching: false });
    });

    it('should save messages preview into localstorage', async () => {
      const previewButtons = screen.getAllByText('Preview');
      await userEvent.click(previewButtons[0]);
      await userEvent.type(screen.getByPlaceholderText('Field'), 'test1');
      await userEvent.type(screen.getByPlaceholderText('Json Path'), 'test2');
      await userEvent.click(screen.getByText('Save'));
      await userEvent.click(previewButtons[1]);
      await userEvent.type(screen.getByPlaceholderText('Field'), 'header1');
      await userEvent.type(screen.getByPlaceholderText('Json Path'), 'header2');
      await userEvent.click(screen.getByText('Save'));
      await userEvent.click(previewButtons[2]);
      await userEvent.type(screen.getByPlaceholderText('Field'), 'test3');
      await userEvent.type(screen.getByPlaceholderText('Json Path'), 'test4');
      await userEvent.click(screen.getByText('Save'));
      expect(
        global.localStorage.getItem(
          `${LOCAL_STORAGE_KEY_PREFIX}-message-preview`
        )
      ).toEqual(
        JSON.stringify({
          'testCluster:testTopic': {
            keyFilters: [{ field: 'test1', path: 'test2' }],
            headersFilters: [{ field: 'header1', path: 'header2' }],
            contentFilters: [{ field: 'test3', path: 'test4' }],
          },
        })
      );
    });

    it('does not reuse topic-only preview filters from another namespace', async () => {
      cleanup();
      localStorage.setItem(
        `${LOCAL_STORAGE_KEY_PREFIX}-message-preview`,
        JSON.stringify({
          testTopic: {
            keyFilters: [{ field: 'legacy', path: 'legacy' }],
            headersFilters: [],
            contentFilters: [],
          },
        })
      );

      renderComponent({ messages: mockTopicsMessages, isFetching: false });

      await waitFor(() => {
        expect(
          screen.queryByText('Preview (1 selected)')
        ).not.toBeInTheDocument();
      });
    });
  });
});
