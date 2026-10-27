import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from 'lib/testHelpers';
import MessageActions from 'components/Topics/Topic/Messages/MessageActions';
import { TopicActionsProvider } from 'components/contexts/TopicActionsContext';
import useAppParams from 'lib/hooks/useAppParams';
import { useLocation } from 'react-router-dom';
import {
  messageCompareScope,
  useMessageCompareStore,
} from 'lib/hooks/useMessageCompareStore';

import { mockMessage } from './Message.fixtures';

jest.mock('lib/hooks/useAppParams', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock(
  'components/Topics/Topic/Messages/MessageResetOffsetsModal',
  () => () => <div>reset-offsets-modal</div>
);

const CurrentLocation = () => {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{`${pathname}${search}`}</output>;
};

describe('MessageActions', () => {
  beforeEach(() => {
    useMessageCompareStore.getState().clear();
    (useAppParams as jest.Mock).mockReturnValue({
      clusterName: 'test-cluster',
      topicName: 'orders',
    });
  });

  it('opens the consumer offset reset flow from the message actions menu', async () => {
    render(
      <TopicActionsProvider openSidebarWithMessage={jest.fn()}>
        <MessageActions message={mockMessage} />
      </TopicActionsProvider>
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Dropdown Toggle' })
    );
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Reset consumer offset' })
    );

    expect(screen.getByText('reset-offsets-modal')).toBeInTheDocument();
  });

  it('selects and unselects a message for comparison', async () => {
    render(
      <TopicActionsProvider openSidebarWithMessage={jest.fn()}>
        <MessageActions message={mockMessage} />
      </TopicActionsProvider>
    );
    const scope = messageCompareScope('test-cluster', 'orders');

    await userEvent.click(
      screen.getByRole('button', { name: 'Dropdown Toggle' })
    );
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Select for compare' })
    );
    expect(useMessageCompareStore.getState()).toMatchObject({
      scope,
      selected: [mockMessage],
    });

    await userEvent.click(
      screen.getByRole('button', { name: 'Dropdown Toggle' })
    );
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Remove from compare' })
    );
    expect(useMessageCompareStore.getState().selected).toEqual([]);
  });

  it('opens the surrounding messages of the record in its partition', async () => {
    render(
      <TopicActionsProvider openSidebarWithMessage={jest.fn()}>
        <MessageActions message={mockMessage} />
        <CurrentLocation />
      </TopicActionsProvider>,
      { initialEntries: ['/?keySerde=String&stringFilter=needle'] }
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Dropdown Toggle' })
    );
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'View surrounding messages' })
    );

    const location = screen.getByTestId('location').textContent ?? '';
    const [pathname, search] = location.split('?');
    const params = new URLSearchParams(search);
    expect(pathname).toBe(
      '/ui/clusters/test-cluster/all-topics/orders/messages'
    );
    expect(params.get('mode')).toBe('FROM_OFFSET');
    expect(params.get('partitions')).toBe(String(mockMessage.partition));
    expect(params.get('anchor')).toBe(
      `${mockMessage.partition}:${mockMessage.offset}`
    );
    expect(params.get('keySerde')).toBe('String');
    expect(params.has('stringFilter')).toBe(false);
  });
});
