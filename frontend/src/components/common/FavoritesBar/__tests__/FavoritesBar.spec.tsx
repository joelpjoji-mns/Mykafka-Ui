import React from 'react';
import { screen, within } from '@testing-library/react';
import { render } from 'lib/testHelpers';
import FavoritesBar from 'components/common/FavoritesBar/FavoritesBar';
import { useFavoritesStore } from 'lib/hooks/useFavorites';
import { clusterConsumerGroupDetailsPath, clusterTopicPath } from 'lib/paths';

const clusterName = 'local';

describe('FavoritesBar', () => {
  beforeEach(() => {
    localStorage.clear();
    useFavoritesStore.setState({ clusters: {} });
  });

  it('renders nothing when there are no favorites of the given type', () => {
    useFavoritesStore
      .getState()
      .toggleFavorite(clusterName, { type: 'consumerGroup', name: 'billing' });
    useFavoritesStore
      .getState()
      .toggleFavorite('other', { type: 'topic', name: 'orders' });

    render(<FavoritesBar clusterName={clusterName} type="topic" />);

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByText('Favorites')).not.toBeInTheDocument();
  });

  it('links to favorite topics of the current cluster', () => {
    const { toggleFavorite } = useFavoritesStore.getState();
    toggleFavorite(clusterName, { type: 'topic', name: 'orders' });
    toggleFavorite(clusterName, { type: 'consumerGroup', name: 'billing' });
    toggleFavorite(clusterName, { type: 'topic', name: 'payments' });

    render(<FavoritesBar clusterName={clusterName} type="topic" />);

    const nav = screen.getByRole('navigation', { name: 'Favorite topics' });
    expect(within(nav).getByText('Favorites')).toBeInTheDocument();
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      '★orders',
      '★payments',
    ]);
    expect(within(nav).getByRole('link', { name: 'orders' })).toHaveAttribute(
      'href',
      clusterTopicPath(clusterName, 'orders')
    );
  });

  it('links to favorite consumer groups with encoded ids', () => {
    useFavoritesStore
      .getState()
      .toggleFavorite(clusterName, { type: 'consumerGroup', name: 'team/a' });

    render(<FavoritesBar clusterName={clusterName} type="consumerGroup" />);

    expect(
      within(
        screen.getByRole('navigation', { name: 'Favorite consumer groups' })
      ).getByRole('link', { name: 'team/a' })
    ).toHaveAttribute(
      'href',
      clusterConsumerGroupDetailsPath(clusterName, 'team%2Fa')
    );
  });
});
