import React from 'react';
import { Action, ResourceType, TopicMessage } from 'generated-sources';
import { Dropdown, DropdownItem } from 'components/common/Dropdown';
import { ActionDropdownItem } from 'components/common/ActionComponent';
import useDataSaver from 'lib/hooks/useDataSaver';
import useAppParams from 'lib/hooks/useAppParams';
import { clusterTopicMessagesPath, RouteParamsClusterTopic } from 'lib/paths';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  messageCompareScope,
  useIsSelectedForCompare,
  useMessageCompareStore,
} from 'lib/hooks/useMessageCompareStore';
import { surroundingMessagesSearch } from 'lib/utils/surroundingMessages';
import { useTopicActions } from 'components/contexts/TopicActionsContext';
import { Modal } from 'components/common/Modal';
import PageLoader from 'components/common/PageLoader/PageLoader';

import MessageResetOffsetsModal from './MessageResetOffsetsModal';

interface MessageActionsProps {
  message: TopicMessage;
}

const MessageActions: React.FC<MessageActionsProps> = ({ message }) => {
  const { clusterName, topicName } = useAppParams<RouteParamsClusterTopic>();
  const { openSidebarWithMessage } = useTopicActions();
  const [isResetOffsetsOpen, setIsResetOffsetsOpen] = React.useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const compareScope = messageCompareScope(clusterName, topicName);
  const isSelectedForCompare = useIsSelectedForCompare(compareScope, message);
  const toggleCompare = useMessageCompareStore((state) => state.toggle);

  const showSurroundingMessages = () => {
    navigate({
      pathname: clusterTopicMessagesPath(clusterName, topicName),
      search: `?${surroundingMessagesSearch(message, searchParams)}`,
    });
  };

  const savedMessageJson = {
    Value: message.value,
    Offset: message.offset,
    Key: message.key,
    Partition: message.partition,
    Headers: message.headers,
    Timestamp: message.timestamp,
  };
  const savedMessage = JSON.stringify(savedMessageJson, null, '\t');
  const { copyToClipboard, saveFile } = useDataSaver(
    'topic-message',
    savedMessage || ''
  );

  return (
    <>
      <Dropdown>
        <DropdownItem aria-label="Copy to clipboard" onClick={copyToClipboard}>
          Copy to clipboard
        </DropdownItem>
        <DropdownItem aria-label="Save as a file" onClick={saveFile}>
          Save as a file
        </DropdownItem>
        <DropdownItem
          aria-label={
            isSelectedForCompare ? 'Remove from compare' : 'Select for compare'
          }
          onClick={() => toggleCompare(compareScope, message)}
        >
          {isSelectedForCompare ? 'Remove from compare' : 'Select for compare'}
        </DropdownItem>
        <DropdownItem
          aria-label="View surrounding messages"
          onClick={showSurroundingMessages}
        >
          View surrounding messages
        </DropdownItem>
        <DropdownItem
          aria-label="Reset consumer offset"
          onClick={() => setIsResetOffsetsOpen(true)}
        >
          Reset consumer offset
        </DropdownItem>
        <ActionDropdownItem
          aria-label="Reproduce message"
          onClick={() => {
            openSidebarWithMessage(message);
          }}
          permission={{
            resource: ResourceType.TOPIC,
            action: Action.MESSAGES_PRODUCE,
            value: topicName,
          }}
        >
          Reproduce message
        </ActionDropdownItem>
      </Dropdown>
      {isResetOffsetsOpen && (
        <React.Suspense
          fallback={
            <Modal
              isOpen
              onClose={() => setIsResetOffsetsOpen(false)}
              title="Reset consumer offset"
            >
              <PageLoader />
            </Modal>
          }
        >
          <MessageResetOffsetsModal
            message={message}
            onClose={() => setIsResetOffsetsOpen(false)}
          />
        </React.Suspense>
      )}
    </>
  );
};

export default MessageActions;
