import React from 'react';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, WithRoute } from 'lib/testHelpers';
import CommandPalette from 'components/common/CommandPalette/CommandPalette';
import ClusterContext, {
  ContextProps,
  initialValue as clusterInitialValue,
} from 'components/contexts/ClusterContext';
import { useTopics } from 'lib/hooks/api/topics';
import { useConsumerGroups } from 'lib/hooks/api/consumers';
import { useGetSchemas } from 'lib/hooks/api/schemas';
import { useConnectors } from 'lib/hooks/api/kafkaConnect';
import { clusterTopicPath } from 'lib/paths';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('lib/hooks/api/topics', () => ({
  useTopics: jest.fn(),
}));
jest.mock('lib/hooks/api/consumers', () => ({
  useConsumerGroups: jest.fn(),
}));
jest.mock('lib/hooks/api/schemas', () => ({
  useGetSchemas: jest.fn(),
}));
jest.mock('lib/hooks/api/kafkaConnect', () => ({
  useConnectors: jest.fn(),
}));

const clusterName = 'local';

const renderComponent = (context: Partial<ContextProps> = {}) =>
  render(
    <ClusterContext.Provider value={{ ...clusterInitialValue, ...context }}>
      <WithRoute path="/ui/clusters/:clusterName/*">
        <CommandPalette />
      </WithRoute>
    </ClusterContext.Provider>,
    { initialEntries: [`/ui/clusters/${clusterName}/topics`] }
  );

const openPalette = () => {
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
};

describe('CommandPalette', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useTopics as jest.Mock).mockReturnValue({
      data: { topics: [{ name: 'orders-topic' }] },
      isFetching: false,
    });
    (useConsumerGroups as jest.Mock).mockReturnValue({
      data: { consumerGroups: [{ groupId: 'orders-group' }] },
      isFetching: false,
    });
    (useGetSchemas as jest.Mock).mockReturnValue({
      data: { schemas: [] },
      isFetching: false,
    });
    (useConnectors as jest.Mock).mockReturnValue({
      data: [],
      isFetching: false,
    });
  });

  it('is hidden until the keyboard shortcut is pressed', () => {
    renderComponent();
    expect(
      screen.queryByLabelText('Command palette search')
    ).not.toBeInTheDocument();

    openPalette();
    expect(screen.getByLabelText('Command palette search')).toBeInTheDocument();
  });

  it('leaves the shortcut to Ace editors and already handled events', () => {
    renderComponent();
    const editor = document.createElement('div');
    editor.className = 'ace_editor';
    const textarea = document.createElement('textarea');
    editor.appendChild(textarea);
    document.body.appendChild(editor);

    const editorEvent = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(textarea, editorEvent);
    expect(editorEvent.defaultPrevented).toBe(false);

    const handledEvent = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    handledEvent.preventDefault();
    fireEvent(document.body, handledEvent);

    expect(
      screen.queryByLabelText('Command palette search')
    ).not.toBeInTheDocument();
    editor.remove();
  });

  it('shows matching results and navigates on click', async () => {
    renderComponent();
    openPalette();

    await userEvent.type(
      screen.getByLabelText('Command palette search'),
      'orders'
    );

    const topicResult = await screen.findByText('orders-topic');
    expect(topicResult).toBeInTheDocument();
    expect(screen.getByText('orders-group')).toBeInTheDocument();

    await userEvent.click(topicResult);
    expect(mockNavigate).toHaveBeenCalledWith(
      clusterTopicPath(clusterName, 'orders-topic')
    );
    // palette closes after navigating
    expect(
      screen.queryByLabelText('Command palette search')
    ).not.toBeInTheDocument();
  });

  it('navigates to the highlighted result on Enter', async () => {
    renderComponent();
    openPalette();

    const input = screen.getByLabelText('Command palette search');
    await userEvent.type(input, 'orders');
    await screen.findByText('orders-topic');

    await userEvent.keyboard('{Enter}');
    expect(mockNavigate).toHaveBeenCalledWith(
      clusterTopicPath(clusterName, 'orders-topic')
    );
  });

  it('closes on Escape', async () => {
    renderComponent();
    openPalette();

    const input = screen.getByLabelText('Command palette search');
    await userEvent.type(input, '{Escape}');

    await waitFor(() =>
      expect(
        screen.queryByLabelText('Command palette search')
      ).not.toBeInTheDocument()
    );
  });
});
