import React from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, WithRoute } from 'lib/testHelpers';
import {
  useConsumerGroups,
  useGetConsumerGroupsLag,
} from 'lib/hooks/api/consumers';
import List from 'components/ConsumerGroups/List';
import { useFavoritesStore } from 'lib/hooks/useFavorites';
import {
  clusterConsumerGroupDetailsPath,
  clusterConsumerGroupsPath,
} from 'lib/paths';

const mockSearchParams = new URLSearchParams();
const mockNavigate = jest.fn();

// Mock hooks
jest.mock('lib/hooks/api/consumers', () => ({
  useConsumerGroups: jest.fn(),
  useGetConsumerGroupsLag: jest.fn(),
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useSearchParams: () => [mockSearchParams, jest.fn()],
  useNavigate: () => mockNavigate,
}));

const mockUseConsumerGroups = useConsumerGroups as jest.Mock;
const mockUseConsumerGroupsLag = useGetConsumerGroupsLag as jest.Mock;

describe('ConsumerGroups List', () => {
  beforeEach(() => {
    localStorage.clear();
    useFavoritesStore.setState({ clusters: {} });
    mockSearchParams.delete('q');
    mockUseConsumerGroups.mockClear();
    mockUseConsumerGroups.mockImplementation(() => ({
      data: {
        consumerGroups: [
          {
            groupId: 'group1',
            consumerLag: 0,
            members: 1,
            topics: 1,
            coordinator: { id: 1 },
            state: 'STABLE',
          },
          {
            groupId: 'group2',
            consumerLag: null,
            members: 1,
            topics: 1,
            coordinator: { id: 2 },
            state: 'STABLE',
          },
        ],
        pageCount: 1,
      },
      isSuccess: true,
      isFetching: false,
    }));

    mockUseConsumerGroupsLag.mockReturnValue({
      data: {
        consumerGroups: { group1: { lag: 0 }, group2: { lag: null } },
      },
      isSuccess: true,
      isFetching: false,
    });
  });

  it('renders consumer lag values correctly', () => {
    render(<List />);
    const tableRows = screen.getAllByRole('row');
    expect(tableRows[1]).toHaveTextContent('0');
    expect(tableRows[2]).toHaveTextContent('N/A');
  });

  it('passes comma-separated search to the server without filtering only the current page', () => {
    mockSearchParams.set('q', 'abcd, uhdg');
    render(<List />);
    expect(
      screen.getByPlaceholderText(
        'Search by Consumer Group ID, e.g. abcd, uhdg'
      )
    ).toHaveValue('abcd, uhdg');
    expect(mockUseConsumerGroups).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'abcd, uhdg' })
    );
  });

  it('favorites a group from its row without navigating and lists it in the favorites row', async () => {
    render(
      <WithRoute path={clusterConsumerGroupsPath()}>
        <List />
      </WithRoute>,
      { initialEntries: [clusterConsumerGroupsPath('local')] }
    );
    expect(
      screen.queryByRole('navigation', { name: 'Favorite consumer groups' })
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Add group1 to favorites' })
    );

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Remove group1 from favorites' })
    ).toHaveAttribute('aria-pressed', 'true');
    const favorites = screen.getByRole('navigation', {
      name: 'Favorite consumer groups',
    });
    expect(
      within(favorites).getByRole('link', { name: 'group1' })
    ).toHaveAttribute(
      'href',
      clusterConsumerGroupDetailsPath('local', 'group1')
    );

    await userEvent.click(screen.getAllByRole('row')[2]);
    expect(mockNavigate).toHaveBeenCalledWith(
      clusterConsumerGroupDetailsPath('local', 'group2')
    );
  });
});
