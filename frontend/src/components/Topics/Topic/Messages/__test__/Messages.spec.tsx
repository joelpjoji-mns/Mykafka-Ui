import React from 'react';
import { render, WithRoute } from 'lib/testHelpers';
import Messages from 'components/Topics/Topic/Messages/Messages';
import { useTopicMessages } from 'lib/hooks/api/topicMessages';
import { screen, waitFor } from '@testing-library/react';
import { clusterTopicPath } from 'lib/paths';
import { MessagesFilterKeys } from 'lib/constants';
import { getMessageViewFilterSnapshot } from 'lib/messageViewFilterSnapshot';
import userEvent from '@testing-library/user-event';

const mockFilterComponents = 'mockFilterComponents';
const mockMessagesTable = 'mockMessagesTable';
const clusterName = 'cluster-name';
const topicName = 'topic-name';

jest.mock('lib/hooks/api/topicMessages', () => ({
  useTopicMessages: jest.fn(),
  useDownloadSettings: () => ({
    data: { defaultLimit: 5000, maxLimit: 10000 },
  }),
  useDownloadMessagesZip: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock('components/Topics/Topic/Messages/MessagesTable', () => () => (
  <div>{mockMessagesTable}</div>
));
jest.mock('components/Topics/Topic/Messages/Filters/Filters', () => () => {
  const { useSearchParams } = jest.requireActual('react-router-dom');
  const [, setParams] = useSearchParams();
  React.useEffect(() => {
    setParams((params: URLSearchParams) => {
      const next = new URLSearchParams(params);
      next.set('limit', '1000');
      return next;
    });
  }, []);
  return <div>{mockFilterComponents}</div>;
});

describe('Messages', () => {
  const renderComponent = (queryString = '', searchPage = false) => {
    return render(
      <WithRoute path={clusterTopicPath()}>
        <Messages searchPage={searchPage} />
      </WithRoute>,
      {
        initialEntries: [
          `${clusterTopicPath(clusterName, topicName)}${queryString}`,
        ],
      }
    );
  };

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    (useTopicMessages as jest.Mock).mockClear();
    (useTopicMessages as jest.Mock).mockImplementation(() => ({
      messages: [],
      isFetching: false,
      consumptionStats: undefined,
      phase: undefined,
      abortFetchData: jest.fn(),
    }));
  });

  describe('component rendering default behavior with the search params', () => {
    beforeEach(() => {
      renderComponent();
    });

    it('should check if the filters are shown in the messages', () => {
      expect(screen.getByText(mockFilterComponents)).toBeInTheDocument();
    });

    it('should check if the table of messages are shown in the messages', () => {
      expect(screen.getByText(mockMessagesTable)).toBeInTheDocument();
    });

    it('does not show the advanced search toolbar in Messages', () => {
      expect(
        screen.queryByRole('textbox', { name: 'Search terms' })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('Match ALL terms (AND)')
      ).not.toBeInTheDocument();
    });

    it('passes repeated stringFilter params as refinement filters', () => {
      renderComponent(
        `?${MessagesFilterKeys.stringFilter}=first&${MessagesFilterKeys.stringFilter}=second&${MessagesFilterKeys.stringFilter}=third`
      );

      expect(useTopicMessages).toHaveBeenLastCalledWith(
        expect.objectContaining({
          stringFilters: ['second', 'third'],
        })
      );
    });

    it('stores URL-backed filters for the Download screen', () => {
      renderComponent(
        `?${MessagesFilterKeys.mode}=FROM_TIMESTAMP&${MessagesFilterKeys.partitions}=0,2&${MessagesFilterKeys.stringFilter}=primary&${MessagesFilterKeys.stringFilter}=secondary`
      );

      const snapshot = getMessageViewFilterSnapshot(clusterName, topicName);
      expect(snapshot?.get(MessagesFilterKeys.mode)).toBe('FROM_TIMESTAMP');
      expect(snapshot?.get(MessagesFilterKeys.partitions)).toBe('0,2');
      expect(snapshot?.getAll(MessagesFilterKeys.stringFilter)).toEqual([
        'primary',
        'secondary',
      ]);
    });
  });

  describe('Search page', () => {
    it('does not fetch or show results for an empty search', () => {
      renderComponent('', true);
      expect(useTopicMessages).not.toHaveBeenCalled();
      expect(screen.queryByText(mockMessagesTable)).not.toBeInTheDocument();
      expect(screen.queryByText(mockFilterComponents)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', {
          name: 'Download matching results (NDJSON)',
        })
      ).not.toBeInTheDocument();
    });

    it('automatically searches after typing and hides the browsing controls initially', async () => {
      renderComponent('', true);
      expect(
        screen.queryByRole('button', { name: 'Search' })
      ).not.toBeInTheDocument();
      await userEvent.type(
        screen.getByRole('textbox', { name: 'Search terms' }),
        'one, two'
      );
      expect(useTopicMessages).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(useTopicMessages).toHaveBeenCalledWith(
          expect.objectContaining({ stringFilters: ['two'], enabled: true })
        )
      );
      await waitFor(() =>
        expect(useTopicMessages).toHaveBeenLastCalledWith(
          expect.objectContaining({ stringFilters: ['two'], enabled: true })
        )
      );
      expect(screen.getByText(mockMessagesTable)).toBeInTheDocument();
      expect(
        screen.getByText('Advanced filters').closest('details')
      ).not.toHaveAttribute('open');
      expect(screen.getByText(mockFilterComponents)).not.toBeVisible();
    });

    it('keeps the results panel mounted and disables obsolete searches while typing', async () => {
      renderComponent('', true);
      const input = screen.getByRole('textbox', { name: 'Search terms' });
      await userEvent.type(input, 'first');
      await waitFor(() =>
        expect(useTopicMessages).toHaveBeenLastCalledWith(
          expect.objectContaining({ enabled: true })
        )
      );
      const table = screen.getByText(mockMessagesTable);
      const advanced = screen.getByText('Advanced filters').closest('details');
      advanced?.setAttribute('open', '');
      (useTopicMessages as jest.Mock).mockClear();
      await userEvent.type(input, ',second');
      expect(useTopicMessages).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: false })
      );
      expect(screen.getByText(mockMessagesTable)).toBe(table);
      expect(table).toBeVisible();
      expect(advanced).toHaveAttribute('open');
      await waitFor(() =>
        expect(useTopicMessages).toHaveBeenCalledWith(
          expect.objectContaining({ stringFilters: ['second'], enabled: true })
        )
      );
      await userEvent.clear(input);
      expect(screen.getByText(mockMessagesTable)).not.toBeVisible();
    });

    it('restores search text and searches again when returning to the topic', async () => {
      const first = renderComponent('', true);
      await userEvent.type(
        screen.getByRole('textbox', { name: 'Search terms' }),
        'copied-value'
      );
      first.unmount();
      (useTopicMessages as jest.Mock).mockClear();
      renderComponent('', true);
      expect(screen.getByRole('textbox', { name: 'Search terms' })).toHaveValue(
        'copied-value'
      );
      await waitFor(() => expect(useTopicMessages).toHaveBeenCalled());
    });

    it('automatically searches terms supplied in a URL', async () => {
      renderComponent('?stringFilter=one&stringFilter=two', true);
      await waitFor(() =>
        expect(useTopicMessages).toHaveBeenCalledWith(
          expect.objectContaining({ stringFilters: ['two'] })
        )
      );
    });
  });
});
