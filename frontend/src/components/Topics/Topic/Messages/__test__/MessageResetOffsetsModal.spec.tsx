import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from 'lib/testHelpers';
import MessageResetOffsetsModal from 'components/Topics/Topic/Messages/MessageResetOffsetsModal';
import {
  ConsumerGroupOffsetResetImpact,
  ConsumerGroupOffsetsResetType,
  TopicMessage,
  TopicMessageTimestampTypeEnum,
} from 'generated-sources';
import { useTopicConsumerGroups } from 'lib/hooks/api/topics';
import {
  useConsumerGroupOffsetsResetPreview,
  useResetConsumerGroupOffsetsMutation,
} from 'lib/hooks/api/consumers';
import useAppParams from 'lib/hooks/useAppParams';

const mutateAsync = jest.fn();
const onClose = jest.fn();

jest.mock('lib/hooks/api/topics', () => ({
  useTopicConsumerGroups: jest.fn(),
}));

jest.mock('lib/hooks/api/consumers', () => ({
  useConsumerGroupOffsetsResetPreview: jest.fn(),
  useResetConsumerGroupOffsetsMutation: jest.fn(),
}));

jest.mock('lib/hooks/useAppParams', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const message: TopicMessage = {
  partition: 3,
  offset: 42,
  timestamp: new Date('2024-01-01T12:00:00.000Z'),
  timestampType: TopicMessageTimestampTypeEnum.CREATE_TIME,
};

describe('MessageResetOffsetsModal', () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue(undefined);
    onClose.mockReset();
    (useAppParams as jest.Mock).mockReturnValue({
      clusterName: 'test-cluster',
      topicName: 'orders',
    });
    (useTopicConsumerGroups as jest.Mock).mockReturnValue({
      data: [
        { groupId: 'orders-primary', inherit: '' },
        { groupId: 'orders-retry', inherit: '' },
      ],
    });
    (useResetConsumerGroupOffsetsMutation as jest.Mock).mockReturnValue({
      mutateAsync,
      isPending: false,
    });
    (useConsumerGroupOffsetsResetPreview as jest.Mock).mockReturnValue({
      data: {
        topic: 'orders',
        resetType: ConsumerGroupOffsetsResetType.OFFSET,
        partitions: [
          {
            partition: 3,
            currentCommittedOffset: 47,
            requestedOffset: 42,
            targetOffset: 42,
            logStartOffset: 0,
            logEndOffset: 100,
            impact: ConsumerGroupOffsetResetImpact.REPLAY,
            affectedMessages: 5,
            targetAdjusted: false,
          },
        ],
      },
      isError: false,
      isFetching: false,
      isLoading: false,
    });
  });

  const selectConsumerGroup = async (groupId: string) => {
    await userEvent.click(
      screen.getByRole('listbox', { name: 'Consumer group' })
    );
    await userEvent.click(screen.getByRole('option', { name: groupId }));
  };

  it('filters topic consumer groups and resets the clicked message offset', async () => {
    render(<MessageResetOffsetsModal message={message} onClose={onClose} />);

    expect(screen.getByRole('button', { name: 'Reset offset' })).toBeDisabled();

    await userEvent.type(
      screen.getByLabelText('Search consumer groups'),
      'retry'
    );
    await userEvent.click(
      screen.getByRole('listbox', { name: 'Consumer group' })
    );

    expect(
      screen.getByRole('option', { name: 'orders-retry' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'orders-primary' })
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('option', { name: 'orders-retry' }));
    expect(screen.getByText('Current committed offset')).toBeInTheDocument();
    expect(screen.getByText('Selected message offset')).toBeInTheDocument();
    expect(screen.getByText('Log end offset')).toBeInTheDocument();
    expect(
      screen.getByText('This reset will replay 5 messages.')
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reset offset' }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        topic: 'orders',
        resetType: ConsumerGroupOffsetsResetType.OFFSET,
        partitions: [3],
        partitionsOffsets: [{ partition: 3, offset: 42 }],
        waitForInactive: true,
      });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses the reset type dropdown for a non-offset reset', async () => {
    render(<MessageResetOffsetsModal message={message} onClose={onClose} />);

    await selectConsumerGroup('orders-primary');
    await userEvent.click(screen.getByRole('listbox', { name: 'Reset type' }));
    await userEvent.click(screen.getByRole('option', { name: 'LATEST' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset offset' }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        topic: 'orders',
        resetType: ConsumerGroupOffsetsResetType.LATEST,
        partitions: [3],
        waitForInactive: true,
      });
    });
  });

  it('uses the timestamp from an SSE message without requiring a Date object', async () => {
    const streamedMessage = {
      ...message,
      timestamp: '2024-01-01T12:00:00.000Z',
    } as unknown as TopicMessage;
    render(
      <MessageResetOffsetsModal message={streamedMessage} onClose={onClose} />
    );

    await selectConsumerGroup('orders-primary');
    await userEvent.click(screen.getByRole('listbox', { name: 'Reset type' }));
    await userEvent.click(screen.getByRole('option', { name: 'TIMESTAMP' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset offset' }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        topic: 'orders',
        resetType: ConsumerGroupOffsetsResetType.TIMESTAMP,
        partitions: [3],
        resetToTimestamp: Date.parse('2024-01-01T12:00:00.000Z'),
        waitForInactive: true,
      });
    });
  });

  it('waits for an active consumer group by default and allows opting out', async () => {
    render(<MessageResetOffsetsModal message={message} onClose={onClose} />);

    await selectConsumerGroup('orders-primary');
    const waitForInactiveCheckbox = screen.getByRole('checkbox', {
      name: /Wait for an active consumer group to become inactive/,
    });
    expect(waitForInactiveCheckbox).toBeChecked();
    await userEvent.click(waitForInactiveCheckbox);
    await userEvent.click(screen.getByRole('button', { name: 'Reset offset' }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        topic: 'orders',
        resetType: ConsumerGroupOffsetsResetType.OFFSET,
        partitions: [3],
        partitionsOffsets: [{ partition: 3, offset: 42 }],
      });
    });
  });

  it('does not offer the topic-based stable mode', async () => {
    render(<MessageResetOffsetsModal message={message} onClose={onClose} />);

    await selectConsumerGroup('orders-primary');

    expect(
      screen.queryByRole('checkbox', {
        name: /Keep the consumer group STABLE/,
      })
    ).not.toBeInTheDocument();
  });

  it('keeps the reset action disabled while the change plan is loading', async () => {
    (useConsumerGroupOffsetsResetPreview as jest.Mock).mockReturnValue({
      data: undefined,
      isError: false,
      isFetching: true,
      isLoading: true,
    });
    render(<MessageResetOffsetsModal message={message} onClose={onClose} />);

    await selectConsumerGroup('orders-primary');

    expect(
      screen.getByText('Calculating the current offset impact.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset offset' })).toBeDisabled();
  });
});
