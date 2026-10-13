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

describe('MessagesTable', () => {
  beforeEach(() => localStorage.clear());

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
        isFetching: true,
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
      screen.getByText('Scanning whole topic: 1200 records read...')
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Cancel topic scan' })
    );
    expect(abortFetchData).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText('Scan cancelled. No partial ranking is shown.')
    ).toBeInTheDocument();
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

    it('should check the display of the loader element during loader', () => {
      renderComponent({ isFetching: true });
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
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
