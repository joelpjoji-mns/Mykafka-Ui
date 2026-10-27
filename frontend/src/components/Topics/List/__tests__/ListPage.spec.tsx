import React from 'react';
import { render, WithRoute } from 'lib/testHelpers';
import { screen } from '@testing-library/react';
import ClusterContext from 'components/contexts/ClusterContext';
import userEvent from '@testing-library/user-event';
import { clusterTopicsPath } from 'lib/paths';
import ListPage from 'components/Topics/List/ListPage';
import { useFavoritesStore } from 'lib/hooks/useFavorites';

const clusterName = 'test-cluster';

jest.mock('components/Topics/List/TopicTable', () => () => <>TopicTableMock</>);

describe('ListPage Component', () => {
  const renderComponent = () =>
    render(
      <ClusterContext.Provider
        value={{
          isReadOnly: false,
          hasKafkaConnectConfigured: true,
          hasSchemaRegistryConfigured: true,
          isTopicDeletionAllowed: true,
          ftsEnabled: false,
          ftsDefaultEnabled: false,
        }}
      >
        <WithRoute path={clusterTopicsPath()}>
          <ListPage />
        </WithRoute>
      </ClusterContext.Provider>,
      { initialEntries: [clusterTopicsPath(clusterName)] }
    );

  describe('Component Render', () => {
    beforeEach(() => {
      renderComponent();
    });
    it('handles switch of Internal Topics visibility', async () => {
      const switchInput = screen.getByLabelText('Show Internal Topics');
      expect(switchInput).toBeInTheDocument();

      expect(global.localStorage.getItem('hideInternalTopics')).toBeNull();
      await userEvent.click(switchInput);
      expect(global.localStorage.getItem('hideInternalTopics')).toBeTruthy();
      await userEvent.click(switchInput);
      expect(global.localStorage.getItem('hideInternalTopics')).toBeNull();
    });

    it('renders the TopicsTable', () => {
      expect(screen.getByText('TopicTableMock')).toBeInTheDocument();
    });
  });

  describe('Favorites row', () => {
    beforeEach(() => {
      localStorage.clear();
      useFavoritesStore.setState({ clusters: {} });
    });

    it('is hidden when the cluster has no favorite topics', () => {
      renderComponent();
      expect(
        screen.queryByRole('navigation', { name: 'Favorite topics' })
      ).not.toBeInTheDocument();
    });

    it('links to favorite topics of the current cluster', () => {
      useFavoritesStore
        .getState()
        .toggleFavorite(clusterName, { type: 'topic', name: 'orders' });
      renderComponent();

      expect(
        screen.getByRole('navigation', { name: 'Favorite topics' })
      ).toHaveTextContent('Favorites');
      expect(screen.getByRole('link', { name: 'orders' })).toHaveAttribute(
        'href',
        `${clusterTopicsPath(clusterName)}/orders`
      );
    });
  });
});
