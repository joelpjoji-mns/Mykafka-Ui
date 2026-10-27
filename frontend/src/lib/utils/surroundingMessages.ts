import { PollingMode, TopicMessage } from 'generated-sources';
import { MessagesFilterKeys } from 'lib/constants';
import { messageCompareId } from 'lib/hooks/useMessageCompareStore';

export const SURROUNDING_MESSAGES_WINDOW = 25;

/**
 * Builds Messages-tab search params that show the records just before and
 * after `message` in its partition, with the message itself highlighted.
 * Text and smart filters are dropped so neighbouring records are not hidden;
 * the chosen serdes are kept so records decode the same way.
 */
export const surroundingMessagesSearch = (
  message: Pick<TopicMessage, 'partition' | 'offset'>,
  currentParams: URLSearchParams
) => {
  const params = new URLSearchParams();
  params.set(MessagesFilterKeys.mode, PollingMode.FROM_OFFSET);
  params.set(
    MessagesFilterKeys.offset,
    String(Math.max(0, message.offset - SURROUNDING_MESSAGES_WINDOW))
  );
  params.set(MessagesFilterKeys.partitions, String(message.partition));
  params.set(
    MessagesFilterKeys.limit,
    String(SURROUNDING_MESSAGES_WINDOW * 2 + 1)
  );
  [MessagesFilterKeys.keySerde, MessagesFilterKeys.valueSerde].forEach(
    (key) => {
      const value = currentParams.get(key);
      if (value) params.set(key, value);
    }
  );
  params.set(MessagesFilterKeys.anchor, messageCompareId(message));
  return params;
};
