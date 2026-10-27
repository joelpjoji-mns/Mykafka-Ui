import { TopicMessage, TopicMessageTimestampTypeEnum } from 'generated-sources';
import {
  messageCompareScope,
  useMessageCompareStore,
} from 'lib/hooks/useMessageCompareStore';

const message = (partition: number, offset: number): TopicMessage => ({
  partition,
  offset,
  timestamp: new Date(0),
  timestampType: TopicMessageTimestampTypeEnum.CREATE_TIME,
});

describe('useMessageCompareStore', () => {
  const orders = messageCompareScope('local', 'orders');
  const payments = messageCompareScope('local', 'payments');

  beforeEach(() => useMessageCompareStore.getState().clear());

  it('toggles selection by partition and offset', () => {
    const { toggle } = useMessageCompareStore.getState();
    toggle(orders, message(0, 1));
    toggle(orders, { ...message(0, 1), value: 'refetched copy' });

    expect(useMessageCompareStore.getState().selected).toEqual([]);
  });

  it('keeps the two most recent selections', () => {
    const { toggle } = useMessageCompareStore.getState();
    toggle(orders, message(0, 1));
    toggle(orders, message(0, 2));
    toggle(orders, message(1, 3));

    expect(
      useMessageCompareStore.getState().selected.map(({ offset }) => offset)
    ).toEqual([2, 3]);
  });

  it('starts a new selection when a message from another topic is picked', () => {
    const { toggle } = useMessageCompareStore.getState();
    toggle(orders, message(0, 1));
    toggle(payments, message(0, 9));

    expect(useMessageCompareStore.getState()).toMatchObject({
      scope: payments,
      selected: [message(0, 9)],
    });
  });

  it('does not confuse clusters and topics containing separators', () => {
    expect(messageCompareScope('a:b', 'c')).not.toBe(
      messageCompareScope('a', 'b:c')
    );
  });
});
