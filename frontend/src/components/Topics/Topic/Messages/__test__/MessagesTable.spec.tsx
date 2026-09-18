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

  const renderComponent = (props?: Partial<MessagesTableProps>) => {
    (useAppParams as jest.Mock).mockImplementation(() => ({
      clusterName: 'testCluster',
      topicName: 'testTopic',
    }));
    return render(
      <TopicActionsProvider openSidebarWithMessage={jest.fn()}>
        <MessagesTable messages={[]} isFetching={false} {...props} />
      </TopicActionsProvider>
    );
  };

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

      expect(columns[4]).toHaveStyle('width: 296px');
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
          screen.getByRole('table').querySelectorAll('col')[4]
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
