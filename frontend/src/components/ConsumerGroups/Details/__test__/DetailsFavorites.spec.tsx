import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Details from 'components/ConsumerGroups/Details/Details';
import { render, WithRoute } from 'lib/testHelpers';
import { clusterConsumerGroupDetailsPath } from 'lib/paths';
import {
  useConsumerGroupDetails,
  useDeleteConsumerGroupMutation,
} from 'lib/hooks/api/consumers';
import { useConnectors } from 'lib/hooks/api/kafkaConnect';
import { useGetConsumerGroupLagsInfo } from 'components/ConsumerGroups/Details/useGetConsumerGroupLagsInfo';
import { useFavoritesStore } from 'lib/hooks/useFavorites';
import { ConsumerGroupState } from 'generated-sources';

const clusterName = 'local';
const groupId = 'groupId1';

jest.mock('lib/hooks/api/consumers', () => ({
  useConsumerGroupDetails: jest.fn(),
  useDeleteConsumerGroupMutation: jest.fn(),
}));
jest.mock('lib/hooks/api/kafkaConnect', () => ({
  useConnectors: jest.fn(),
}));
jest.mock(
  'components/ConsumerGroups/Details/useGetConsumerGroupLagsInfo',
  () => ({ useGetConsumerGroupLagsInfo: jest.fn() })
);

const renderComponent = () =>
  render(
    <WithRoute path={clusterConsumerGroupDetailsPath()}>
      <Details />
    </WithRoute>,
    {
      initialEntries: [clusterConsumerGroupDetailsPath(clusterName, groupId)],
    }
  );

describe('ConsumerGroup Details favorites', () => {
  beforeEach(() => {
    localStorage.clear();
    useFavoritesStore.setState({ clusters: {} });
    (useConsumerGroupDetails as jest.Mock).mockReturnValue({
      data: {
        groupId,
        members: 0,
        topics: 1,
        partitions: [],
        state: ConsumerGroupState.STABLE,
        coordinator: { id: 1 },
      },
      isSuccess: true,
      isLoading: false,
      refetch: jest.fn(),
    });
    (useDeleteConsumerGroupMutation as jest.Mock).mockReturnValue({
      mutateAsync: jest.fn(),
    });
    (useConnectors as jest.Mock).mockReturnValue({ data: [] });
    (useGetConsumerGroupLagsInfo as jest.Mock).mockReturnValue({
      consumerGroupLagInfo: { lag: 0, trend: undefined },
      topicsLagInfo: {},
      partitionsLagInfo: {},
    });
  });

  it('records a visit for the consumer group', () => {
    renderComponent();

    expect(useFavoritesStore.getState().clusters[clusterName].recents).toEqual([
      { type: 'consumerGroup', name: groupId },
    ]);
  });

  it('toggles the consumer group favorite from the heading', async () => {
    renderComponent();

    const heading = screen.getByRole('heading', { name: groupId });
    const toggle = screen.getByRole('button', {
      name: `Add ${groupId} to favorites`,
    });
    expect(heading.parentElement).toContainElement(toggle);

    await userEvent.click(toggle);

    expect(
      screen.getByRole('button', { name: `Remove ${groupId} from favorites` })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      useFavoritesStore.getState().clusters[clusterName].favorites
    ).toEqual([{ type: 'consumerGroup', name: groupId }]);
  });
});
