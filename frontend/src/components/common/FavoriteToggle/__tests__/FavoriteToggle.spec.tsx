import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from 'lib/testHelpers';
import FavoriteToggle from 'components/common/FavoriteToggle/FavoriteToggle';
import { useFavoritesStore } from 'lib/hooks/useFavorites';
import { Link, Route, Routes } from 'react-router-dom';

const clusterName = 'local';

const renderToggle = () =>
  render(
    <FavoriteToggle clusterName={clusterName} type="topic" name="orders" />
  );

describe('FavoriteToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    useFavoritesStore.setState({ clusters: {} });
  });

  it('renders an accessible, unpressed toggle button by default', () => {
    renderToggle();

    const button = screen.getByRole('button', {
      name: 'Add orders to favorites',
    });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveAttribute('title', 'Add orders to favorites');
    expect(button).toHaveTextContent('☆');
  });

  it('toggles the favorite state on click', async () => {
    renderToggle();

    await userEvent.click(
      screen.getByRole('button', { name: 'Add orders to favorites' })
    );

    const button = screen.getByRole('button', {
      name: 'Remove orders from favorites',
    });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('title', 'Remove orders from favorites');
    expect(button).toHaveTextContent('★');
    expect(
      useFavoritesStore.getState().clusters[clusterName].favorites
    ).toEqual([{ type: 'topic', name: 'orders' }]);

    await userEvent.click(button);
    expect(
      screen.getByRole('button', { name: 'Add orders to favorites' })
    ).toHaveAttribute('aria-pressed', 'false');
    expect(
      useFavoritesStore.getState().clusters[clusterName].favorites
    ).toEqual([]);
  });

  it('reflects favorites added elsewhere', () => {
    useFavoritesStore
      .getState()
      .toggleFavorite(clusterName, { type: 'topic', name: 'orders' });
    renderToggle();

    expect(
      screen.getByRole('button', { name: 'Remove orders from favorites' })
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not trigger parent click handlers or link navigation', async () => {
    const onParentClick = jest.fn();
    render(
      <Routes>
        <Route
          path="/start"
          element={
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
            <div onClick={onParentClick}>
              <Link to="/target">
                <FavoriteToggle
                  clusterName={clusterName}
                  type="topic"
                  name="orders"
                />
                <span>orders link</span>
              </Link>
            </div>
          }
        />
        <Route path="/target" element={<span>Target page</span>} />
      </Routes>,
      { initialEntries: ['/start'] }
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Add orders to favorites' })
    );

    expect(onParentClick).not.toHaveBeenCalled();
    expect(screen.queryByText('Target page')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove orders from favorites' })
    ).toBeInTheDocument();

    // Sanity check: clicking the link itself still navigates.
    await userEvent.click(screen.getByText('orders link'));
    expect(onParentClick).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Target page')).toBeInTheDocument();
  });
});
