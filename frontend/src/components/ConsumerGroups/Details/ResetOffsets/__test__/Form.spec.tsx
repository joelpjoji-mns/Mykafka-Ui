import React from 'react';
import { screen } from '@testing-library/react';
import { render } from 'lib/testHelpers';
import { ConsumerGroupOffsetsResetType } from 'generated-sources';
import useAppParams from 'lib/hooks/useAppParams';
import { useResetConsumerGroupOffsetsMutation } from 'lib/hooks/api/consumers';
import Form from 'components/ConsumerGroups/Details/ResetOffsets/Form';

jest.mock('lib/hooks/useAppParams', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('lib/hooks/api/consumers', () => ({
  useResetConsumerGroupOffsetsMutation: jest.fn(),
}));

jest.mock('lib/hooks/useTimezones', () => ({
  useTimezone: () => ({
    getDateInCurrentTimezone: (date: Date) => date,
  }),
}));

describe('ResetOffsets Form', () => {
  beforeEach(() => {
    (useAppParams as jest.Mock).mockReturnValue({
      clusterName: 'test-cluster',
      consumerGroupID: 'orders-group',
    });
    (useResetConsumerGroupOffsetsMutation as jest.Mock).mockReturnValue({
      mutateAsync: jest.fn(),
      isPending: false,
    });
  });

  it('retains waiting for inactivity without the topic-based stable mode', () => {
    render(
      <Form
        defaultValues={{
          topic: 'orders',
          resetType: ConsumerGroupOffsetsResetType.EARLIEST,
          partitionsOffsets: [],
          resetToTimestamp: Date.now(),
          waitForInactive: true,
        }}
        topics={['orders']}
        partitions={[
          {
            topic: 'orders',
            partition: 0,
          },
        ]}
      />
    );

    expect(
      screen.getByRole('checkbox', {
        name: /Wait for an active consumer group to become inactive/,
      })
    ).toBeInTheDocument();

    expect(
      screen.queryByRole('checkbox', {
        name: /Keep the consumer group STABLE/,
      })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reset Offsets' })
    ).toBeInTheDocument();
  });

  it('allows cancelling the pending inactive-group wait', () => {
    const cancel = jest.fn();
    (useResetConsumerGroupOffsetsMutation as jest.Mock).mockReturnValue({
      mutateAsync: jest.fn(),
      isPending: true,
      cancel,
    });
    render(
      <Form
        defaultValues={{
          topic: 'orders',
          resetType: ConsumerGroupOffsetsResetType.EARLIEST,
          partitionsOffsets: [],
          resetToTimestamp: Date.now(),
          waitForInactive: true,
        }}
        topics={['orders']}
        partitions={[{ topic: 'orders', partition: 0 }]}
      />
    );

    expect(screen.getByRole('dialog')).toHaveTextContent('no time limit');
    screen.getByRole('button', { name: 'Cancel waiting' }).click();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
