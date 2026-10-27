import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CellContext } from '@tanstack/react-table';
import { Route, Routes } from 'react-router-dom';
import { render } from 'lib/testHelpers';
import { Topic } from 'generated-sources';
import { TopicTitleCell } from 'components/Topics/List/TopicTitleCell';
import { useFavoritesStore } from 'lib/hooks/useFavorites';
import { clusterTopicPath, clusterTopicsPath } from 'lib/paths';

const clusterName = 'local';
const topicName = 'orders';

const renderCell = (topic: Partial<Topic> = {}) => {
  const context = {
    row: { original: { name: topicName, internal: false, ...topic } },
  } as unknown as CellContext<Topic, unknown>;

  return render(
    <Routes>
      <Route
        path={clusterTopicsPath(':clusterName')}
        element={<TopicTitleCell {...context} />}
      />
      <Route
        path={clusterTopicPath(':clusterName', ':topicName')}
        element={<div>Topic page</div>}
      />
    </Routes>,
    { initialEntries: [clusterTopicsPath(clusterName)] }
  );
};

describe('TopicTitleCell', () => {
  beforeEach(() => {
    localStorage.clear();
    useFavoritesStore.setState({ clusters: {} });
  });

  it('renders a favorite toggle before and outside of the topic link', () => {
    renderCell();

    const star = screen.getByRole('button', {
      name: `Add ${topicName} to favorites`,
    });
    const link = screen.getByRole('link', { name: topicName });

    expect(link).not.toContainElement(star);
    expect(
      // eslint-disable-next-line no-bitwise
      star.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('toggles the topic favorite without navigating', async () => {
    renderCell();

    await userEvent.click(
      screen.getByRole('button', { name: `Add ${topicName} to favorites` })
    );

    expect(
      screen.getByRole('button', {
        name: `Remove ${topicName} from favorites`,
      })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      useFavoritesStore.getState().clusters[clusterName].favorites
    ).toEqual([{ type: 'topic', name: topicName }]);
    expect(screen.queryByText('Topic page')).not.toBeInTheDocument();
  });

  it('still navigates to the topic when the name is clicked', () => {
    renderCell();

    fireEvent.click(screen.getByRole('link', { name: topicName }));

    expect(screen.getByText('Topic page')).toBeInTheDocument();
    expect(useFavoritesStore.getState().clusters).toEqual({});
  });

  it('keeps the internal badge inside the link', () => {
    renderCell({ internal: true });

    expect(
      within(screen.getByRole('link', { name: `IN ${topicName}` })).getByText(
        'IN'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `Add ${topicName} to favorites` })
    ).toBeInTheDocument();
  });
});
