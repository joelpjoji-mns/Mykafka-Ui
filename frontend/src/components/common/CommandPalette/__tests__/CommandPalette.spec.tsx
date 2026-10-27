import React from 'react';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, WithRoute } from 'lib/testHelpers';
import CommandPalette from 'components/common/CommandPalette/CommandPalette';
import ClusterContext, {
  ContextProps,
  initialValue as clusterInitialValue,
} from 'components/contexts/ClusterContext';
import { useTopics } from 'lib/hooks/api/topics';
import { useConsumerGroups } from 'lib/hooks/api/consumers';
import { useGetSchemas } from 'lib/hooks/api/schemas';
import { useConnectors } from 'lib/hooks/api/kafkaConnect';
import { clusterConsumerGroupDetailsPath, clusterTopicPath } from 'lib/paths';
import { useFavoritesStore } from 'lib/hooks/useFavorites';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('lib/hooks/api/topics', () => ({
  useTopics: jest.fn(),
}));
jest.mock('lib/hooks/api/consumers', () => ({
  useConsumerGroups: jest.fn(),
}));
jest.mock('lib/hooks/api/schemas', () => ({
  useGetSchemas: jest.fn(),
}));
jest.mock('lib/hooks/api/kafkaConnect', () => ({
  useConnectors: jest.fn(),
}));

const clusterName = 'local';

const renderComponent = (context: Partial<ContextProps> = {}) =>
  render(
    <ClusterContext.Provider value={{ ...clusterInitialValue, ...context }}>
      <WithRoute path="/ui/clusters/:clusterName/*">
        <CommandPalette />
      </WithRoute>
    </ClusterContext.Provider>,
    { initialEntries: [`/ui/clusters/${clusterName}/topics`] }
  );

const openPalette = () => {
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
};

describe('CommandPalette', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    useFavoritesStore.setState({ clusters: {} });
    (useTopics as jest.Mock).mockReturnValue({
      data: { topics: [{ name: 'orders-topic' }] },
      isFetching: false,
    });
    (useConsumerGroups as jest.Mock).mockReturnValue({
      data: { consumerGroups: [{ groupId: 'orders-group' }] },
      isFetching: false,
    });
    (useGetSchemas as jest.Mock).mockReturnValue({
      data: { schemas: [] },
      isFetching: false,
    });
    (useConnectors as jest.Mock).mockReturnValue({
      data: [],
      isFetching: false,
    });
  });

  it('is hidden until the keyboard shortcut is pressed', () => {
    renderComponent();
    expect(
      screen.queryByLabelText('Command palette search')
    ).not.toBeInTheDocument();

    openPalette();
    expect(screen.getByLabelText('Command palette search')).toBeInTheDocument();
  });

  it('leaves the shortcut to Ace editors and already handled events', () => {
    renderComponent();
    const editor = document.createElement('div');
    editor.className = 'ace_editor';
    const textarea = document.createElement('textarea');
    editor.appendChild(textarea);
    document.body.appendChild(editor);

    const editorEvent = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(textarea, editorEvent);
    expect(editorEvent.defaultPrevented).toBe(false);

    const handledEvent = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    handledEvent.preventDefault();
    fireEvent(document.body, handledEvent);

    expect(
      screen.queryByLabelText('Command palette search')
    ).not.toBeInTheDocument();
    editor.remove();
  });

  it('shows matching results and navigates on click', async () => {
    renderComponent();
    openPalette();

    await userEvent.type(
      screen.getByLabelText('Command palette search'),
      'orders'
    );

    const topicResult = await screen.findByText('orders-topic');
    expect(topicResult).toBeInTheDocument();
    expect(screen.getByText('orders-group')).toBeInTheDocument();

    await userEvent.click(topicResult);
    expect(mockNavigate).toHaveBeenCalledWith(
      clusterTopicPath(clusterName, 'orders-topic')
    );
    // palette closes after navigating
    expect(
      screen.queryByLabelText('Command palette search')
    ).not.toBeInTheDocument();
  });

  it('navigates to the highlighted result on Enter', async () => {
    renderComponent();
    openPalette();

    const input = screen.getByLabelText('Command palette search');
    await userEvent.type(input, 'orders');
    await screen.findByText('orders-topic');

    await userEvent.keyboard('{Enter}');
    expect(mockNavigate).toHaveBeenCalledWith(
      clusterTopicPath(clusterName, 'orders-topic')
    );
  });

  it('closes on Escape', async () => {
    renderComponent();
    openPalette();

    const input = screen.getByLabelText('Command palette search');
    await userEvent.type(input, '{Escape}');

    await waitFor(() =>
      expect(
        screen.queryByLabelText('Command palette search')
      ).not.toBeInTheDocument()
    );
  });

  describe('when the query is empty', () => {
    const seedFavoritesAndRecents = () => {
      const { toggleFavorite, recordVisit } = useFavoritesStore.getState();
      toggleFavorite(clusterName, { type: 'topic', name: 'fav-topic' });
      toggleFavorite(clusterName, { type: 'consumerGroup', name: 'fav-group' });
      recordVisit(clusterName, { type: 'topic', name: 'old-topic' });
      recordVisit(clusterName, { type: 'topic', name: 'fav-topic' });
      recordVisit(clusterName, { type: 'consumerGroup', name: 'recent-group' });
      toggleFavorite('other-cluster', { type: 'topic', name: 'foreign-topic' });
    };

    it('shows the hint when there are no favorites or recents', () => {
      renderComponent();
      openPalette();

      expect(
        screen.getByText(
          'Type to search across this cluster. Press Esc to close.'
        )
      ).toBeInTheDocument();
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('lists favorites and recently visited items of the current cluster', () => {
      seedFavoritesAndRecents();
      renderComponent();
      openPalette();

      expect(
        screen.queryByText(
          'Type to search across this cluster. Press Esc to close.'
        )
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('listbox', { name: 'Favorites and recently visited' })
      ).toBeInTheDocument();

      const favorites = screen.getByRole('group', { name: 'Favorites' });
      expect(
        within(favorites)
          .getAllByRole('option')
          .map((option) => option.textContent)
      ).toEqual(['Topicfav-topic', 'Consumer groupfav-group']);

      const recents = screen.getByRole('group', { name: 'Recently visited' });
      // Favorited items are not repeated in the recents section.
      expect(
        within(recents)
          .getAllByRole('option')
          .map((option) => option.textContent)
      ).toEqual(['Consumer grouprecent-group', 'Topicold-topic']);

      expect(screen.queryByText('foreign-topic')).not.toBeInTheDocument();
      expect(useTopics).not.toHaveBeenCalled();
    });

    it('supports keyboard navigation across both sections', async () => {
      seedFavoritesAndRecents();
      renderComponent();
      openPalette();

      const isSelected = (name: string) =>
        screen
          .getByRole('option', { name: new RegExp(name) })
          .getAttribute('aria-selected');

      expect(isSelected('fav-topic')).toBe('true');

      await userEvent.keyboard('{ArrowDown}{ArrowDown}');
      expect(isSelected('fav-topic')).toBe('false');
      expect(isSelected('recent-group')).toBe('true');

      await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
      expect(isSelected('old-topic')).toBe('true');

      await userEvent.keyboard('{ArrowUp}{ArrowUp}');
      expect(isSelected('fav-group')).toBe('true');

      await userEvent.keyboard('{Enter}');
      expect(mockNavigate).toHaveBeenCalledWith(
        clusterConsumerGroupDetailsPath(clusterName, 'fav-group')
      );
      expect(
        screen.queryByLabelText('Command palette search')
      ).not.toBeInTheDocument();
    });

    it('navigates to a recent item on click', async () => {
      seedFavoritesAndRecents();
      renderComponent();
      openPalette();

      await userEvent.click(screen.getByText('old-topic'));
      expect(mockNavigate).toHaveBeenCalledWith(
        clusterTopicPath(clusterName, 'old-topic')
      );
    });

    it('switches back to favorites when the search query is cleared', async () => {
      seedFavoritesAndRecents();
      renderComponent();
      openPalette();

      const input = screen.getByLabelText('Command palette search');
      await userEvent.type(input, 'orders');
      expect(await screen.findByText('orders-topic')).toBeInTheDocument();
      expect(screen.queryByText('fav-topic')).not.toBeInTheDocument();

      await userEvent.clear(input);
      expect(await screen.findByText('fav-topic')).toBeInTheDocument();

      await userEvent.keyboard('{Enter}');
      expect(mockNavigate).toHaveBeenCalledWith(
        clusterTopicPath(clusterName, 'fav-topic')
      );
    });
  });
});
