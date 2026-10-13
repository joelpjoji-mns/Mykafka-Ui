import React from 'react';
import { screen } from '@testing-library/react';
import { render } from 'lib/testHelpers';
import {
  useConsumerGroups,
  useGetConsumerGroupsLag,
} from 'lib/hooks/api/consumers';
import List from 'components/ConsumerGroups/List';

const mockSearchParams = new URLSearchParams();

// Mock hooks
jest.mock('lib/hooks/api/consumers', () => ({
  useConsumerGroups: jest.fn(),
  useGetConsumerGroupsLag: jest.fn(),
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useSearchParams: () => [mockSearchParams, jest.fn()],
  useNavigate: () => jest.fn(),
}));

const mockUseConsumerGroups = useConsumerGroups as jest.Mock;
const mockUseConsumerGroupsLag = useGetConsumerGroupsLag as jest.Mock;

describe('ConsumerGroups List', () => {
  beforeEach(() => {
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
});
