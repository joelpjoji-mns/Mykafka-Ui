import React from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from 'lib/testHelpers';
import { TopicMessage, TopicMessageTimestampTypeEnum } from 'generated-sources';
import MessageCompareModal, {
  comparedFieldText,
} from 'components/Topics/Topic/Messages/MessageCompare/MessageCompareModal';

jest.mock('components/common/DiffViewer/DiffViewer', () => ({
  __esModule: true,
  default: ({ value }: { value: [string, string] }) => (
    <div data-testid="diff-viewer">{`${value[0]}|||${value[1]}`}</div>
  ),
}));

const base: TopicMessage = {
  partition: 0,
  offset: 10,
  timestamp: new Date('2026-01-01T00:00:00Z'),
  timestampType: TopicMessageTimestampTypeEnum.CREATE_TIME,
  key: 'order-1',
  value: '{"status":"NEW","amount":10}',
  headers: { b: '2', a: '1' },
  valueSize: 28,
};

const changed: TopicMessage = {
  ...base,
  offset: 11,
  value: '{"status":"PAID","amount":10}',
  headers: { a: '1', b: '2' },
  valueSize: 29,
};

describe('MessageCompareModal', () => {
  it('highlights differing metadata and diffs values by default', () => {
    render(
      <MessageCompareModal messages={[base, changed]} onClose={jest.fn()} />
    );

    const metadata = screen.getByRole('table', {
      name: 'Compared message metadata',
    });
    const idRow = within(metadata).getByRole('row', { name: /Message ID/ });
    expect(idRow).toHaveTextContent('0:10');
    expect(idRow).toHaveTextContent('0:11');
    expect(
      screen.getByRole('button', { name: 'Value (differs)', pressed: true })
    ).toBeInTheDocument();
    expect(screen.getByTestId('diff-viewer')).toHaveTextContent('"NEW"');
    expect(screen.getByTestId('diff-viewer')).toHaveTextContent('"PAID"');
  });

  it('reports identical fields, ignoring header order', async () => {
    render(
      <MessageCompareModal messages={[base, changed]} onClose={jest.fn()} />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Headers' }));

    expect(screen.getByRole('status')).toHaveTextContent(
      'Headers values are identical.'
    );
    expect(screen.queryByTestId('diff-viewer')).not.toBeInTheDocument();
  });

  it('swaps sides and closes', async () => {
    const onClose = jest.fn();
    render(
      <MessageCompareModal messages={[base, changed]} onClose={onClose} />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Swap sides' }));
    expect(screen.getByTestId('diff-viewer')).toHaveTextContent(
      /PAID.*\|\|\|.*NEW/s
    );

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('pretty-prints JSON and leaves plain text untouched', () => {
    expect(comparedFieldText(base, 'value')).toBe(
      '{\n  "status": "NEW",\n  "amount": 10\n}'
    );
    expect(comparedFieldText(base, 'key')).toBe('order-1');
    expect(comparedFieldText(base, 'headers')).toBe(
      '{\n  "a": "1",\n  "b": "2"\n}'
    );
  });
});
