import React from 'react';
import {
  Action,
  ConsumerGroupOffsetResetImpact,
  ConsumerGroupOffsetsReset,
  ConsumerGroupOffsetsResetPartitionPreview,
  ConsumerGroupOffsetsResetType,
  ResourceType,
  TopicMessage,
} from 'generated-sources';
import { ActionButton } from 'components/common/ActionComponent';
import { Button } from 'components/common/Button/Button';
import { Modal } from 'components/common/Modal';
import Input from 'components/common/Input/Input';
import Select, { SelectOption } from 'components/common/Select/Select';
import { useTopicConsumerGroups } from 'lib/hooks/api/topics';
import {
  useConsumerGroupOffsetsResetPreview,
  useResetConsumerGroupOffsetsMutation,
} from 'lib/hooks/api/consumers';
import useAppParams from 'lib/hooks/useAppParams';
import { RouteParamsClusterTopic } from 'lib/paths';

import * as S from './MessageResetOffsetsModal.styled';

interface MessageResetOffsetsModalProps {
  message: TopicMessage;
  onClose: () => void;
}

const resetTypeOptions: SelectOption<ConsumerGroupOffsetsResetType>[] =
  Object.values(ConsumerGroupOffsetsResetType).map((value) => ({
    label: value,
    value,
  }));

const messagesLabel = (count: number) =>
  `${count} ${count === 1 ? 'message' : 'messages'}`;

const timestampToMillis = (timestamp: unknown) => {
  const value =
    timestamp instanceof Date
      ? timestamp.getTime()
      : new Date(String(timestamp)).getTime();
  return Number.isFinite(value) ? value : Date.now();
};
const impactSummary = (preview: ConsumerGroupOffsetsResetPartitionPreview) => {
  switch (preview.impact) {
    case ConsumerGroupOffsetResetImpact.REPLAY:
      return `This reset will replay ${messagesLabel(
        preview.affectedMessages || 0
      )}.`;
    case ConsumerGroupOffsetResetImpact.SKIP:
      return `This reset will skip ${messagesLabel(
        preview.affectedMessages || 0
      )}.`;
    case ConsumerGroupOffsetResetImpact.NONE:
      return 'The planned offset matches the committed offset; no messages will be replayed or skipped.';
    case ConsumerGroupOffsetResetImpact.UNKNOWN:
      return 'There is no committed offset for this partition, so replay and skip impact cannot be calculated.';
    default:
      return 'The current reset impact could not be calculated.';
  }
};

const MessageResetOffsetsModal: React.FC<MessageResetOffsetsModalProps> = ({
  message,
  onClose,
}) => {
  const { clusterName, topicName } = useAppParams<RouteParamsClusterTopic>();
  const { data: consumerGroups = [] } = useTopicConsumerGroups({
    clusterName,
    topicName,
  });
  const [search, setSearch] = React.useState('');
  const [consumerGroupId, setConsumerGroupId] = React.useState<string>();
  const [resetType, setResetType] = React.useState(
    ConsumerGroupOffsetsResetType.OFFSET
  );
  const [waitForInactive, setWaitForInactive] = React.useState(true);
  const [resetToTimestamp] = React.useState(() =>
    timestampToMillis(message.timestamp)
  );
  const resetOffsets = useResetConsumerGroupOffsetsMutation({
    clusterName,
    consumerGroupID: consumerGroupId || '',
  });

  const resetPayload = React.useMemo<ConsumerGroupOffsetsReset>(() => {
    const payload: ConsumerGroupOffsetsReset = {
      topic: topicName,
      resetType,
      partitions: [message.partition],
    };

    if (resetType === ConsumerGroupOffsetsResetType.OFFSET) {
      payload.partitionsOffsets = [
        {
          partition: message.partition,
          offset: message.offset,
        },
      ];
    }

    if (resetType === ConsumerGroupOffsetsResetType.TIMESTAMP) {
      payload.resetToTimestamp = resetToTimestamp;
    }

    if (waitForInactive) {
      payload.waitForInactive = true;
    }

    return payload;
  }, [
    message.offset,
    message.partition,
    resetToTimestamp,
    resetType,
    topicName,
    waitForInactive,
  ]);

  const {
    data: resetPreview,
    isError: isResetPreviewError,
    isFetching: isResetPreviewFetching,
    isLoading: isResetPreviewLoading,
  } = useConsumerGroupOffsetsResetPreview({
    clusterName,
    consumerGroupID: consumerGroupId || '',
    reset: resetPayload,
    enabled: Boolean(consumerGroupId),
  });

  const partitionPreview = resetPreview?.partitions.find(
    ({ partition }) => partition === message.partition
  );
  const isPreviewLoading = isResetPreviewLoading || isResetPreviewFetching;

  const matchingConsumerGroups = React.useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    if (!normalizedSearch) return consumerGroups;

    return consumerGroups.filter(({ groupId }) =>
      groupId.toLocaleLowerCase().includes(normalizedSearch)
    );
  }, [consumerGroups, search]);

  const selectedConsumerGroup = consumerGroups.find(
    ({ groupId }) => groupId === consumerGroupId
  );
  const visibleConsumerGroups =
    selectedConsumerGroup &&
    !matchingConsumerGroups.some(
      ({ groupId }) => groupId === selectedConsumerGroup.groupId
    )
      ? [selectedConsumerGroup, ...matchingConsumerGroups]
      : matchingConsumerGroups;
  const consumerGroupOptions: SelectOption<string>[] =
    visibleConsumerGroups.map(({ groupId }) => ({
      label: groupId,
      value: groupId,
    }));

  const reset = async () => {
    if (!consumerGroupId) return;

    const completed = await resetOffsets.mutateAsync(resetPayload);
    if (completed === false) return;
    onClose();
  };

  const handleClose = () => {
    if (resetOffsets.isPending) resetOffsets.cancel();
    onClose();
  };

  return (
    <Modal
      isOpen
      onClose={handleClose}
      title="Reset consumer offset"
      maxWidth="640px"
      footer={
        <S.Actions>
          <Button buttonType="secondary" buttonSize="M" onClick={handleClose}>
            Cancel
          </Button>
          <ActionButton
            buttonType="primary"
            buttonSize="M"
            disabled={!consumerGroupId || !partitionPreview || isPreviewLoading}
            inProgress={resetOffsets.isPending}
            onClick={reset}
            permission={{
              resource: ResourceType.CONSUMER,
              action: Action.RESET_OFFSETS,
              value: consumerGroupId,
            }}
          >
            Reset offset
          </ActionButton>
        </S.Actions>
      }
    >
      <S.Description>
        Select a consumer group that consumes this topic, then choose how to
        reset its offset for this message partition.
      </S.Description>
      {resetOffsets.isPending && (
        <p role="status">
          Waiting until the group is inactive. Cancel stops waiting, but cannot
          undo a reset already applied.
        </p>
      )}
      <S.MessagePosition>
        <span>Topic: {topicName}</span>
        <span>Partition: {message.partition}</span>
        <span>Offset: {message.offset}</span>
      </S.MessagePosition>
      <S.Fields>
        <S.Field>
          <Input
            label="Search consumer groups"
            inputSize="M"
            type="text"
            value={search}
            placeholder="Filter by consumer group ID"
            onChange={({ target: { value } }) => setSearch(value)}
          />
        </S.Field>
        <S.Field>
          <S.Label htmlFor="messageConsumerGroup">Consumer group</S.Label>
          <Select
            id="messageConsumerGroup"
            aria-label="Consumer group"
            options={consumerGroupOptions}
            value={consumerGroupId}
            onChange={setConsumerGroupId}
            minWidth="100%"
            placeholder="Select consumer group"
          />
        </S.Field>
        <S.Field>
          <S.Label htmlFor="messageResetType">Reset type</S.Label>
          <Select
            id="messageResetType"
            aria-label="Reset type"
            options={resetTypeOptions}
            value={resetType}
            onChange={setResetType}
            minWidth="100%"
          />
        </S.Field>
        {consumerGroupId && (
          <S.ActiveGroupOption>
            <input
              id="waitForInactive"
              type="checkbox"
              checked={waitForInactive}
              onChange={({ target: { checked } }) =>
                setWaitForInactive(checked)
              }
            />
            <S.ActiveGroupOptionContent>
              <S.ActiveGroupOptionTitle>
                Wait for an active consumer group to become inactive
              </S.ActiveGroupOptionTitle>
              <S.ActiveGroupOptionHint>
                Waits until the group is inactive or you cancel. Never pauses or
                removes consumers.
              </S.ActiveGroupOptionHint>
            </S.ActiveGroupOptionContent>
          </S.ActiveGroupOption>
        )}
        {consumerGroupId && (
          <S.ChangePlan
            aria-live="polite"
            aria-label="Offset reset change plan"
          >
            <S.ChangePlanTitle>Change plan</S.ChangePlanTitle>
            {isPreviewLoading && (
              <S.PlanStatus>
                Calculating the current offset impact.
              </S.PlanStatus>
            )}
            {isResetPreviewError && (
              <S.PlanError role="alert">
                The change plan could not be calculated. Reset stays unavailable
                until a live plan is available.
              </S.PlanError>
            )}
            {partitionPreview && !isPreviewLoading && (
              <>
                <S.PlanGrid>
                  <S.PlanMetric>
                    <dt>Current committed offset</dt>
                    <dd>
                      {partitionPreview.currentCommittedOffset ??
                        'No committed offset'}
                    </dd>
                  </S.PlanMetric>
                  <S.PlanMetric>
                    <dt>Selected message offset</dt>
                    <dd>
                      {partitionPreview.requestedOffset ?? message.offset}
                    </dd>
                  </S.PlanMetric>
                  <S.PlanMetric>
                    <dt>Planned target offset</dt>
                    <dd>{partitionPreview.targetOffset}</dd>
                  </S.PlanMetric>
                  <S.PlanMetric>
                    <dt>Log end offset</dt>
                    <dd>{partitionPreview.logEndOffset} (next offset)</dd>
                  </S.PlanMetric>
                </S.PlanGrid>
                <S.PlanImpact>{impactSummary(partitionPreview)}</S.PlanImpact>
                {partitionPreview.targetAdjusted && (
                  <S.PlanWarning>
                    Kafka will clamp the requested offset to{' '}
                    {partitionPreview.targetOffset} because it is outside the
                    current log range.
                  </S.PlanWarning>
                )}
                <S.PlanNotice>
                  Live estimate only. Kafka offsets can change before the reset
                  is submitted.
                </S.PlanNotice>
              </>
            )}
          </S.ChangePlan>
        )}
        {consumerGroups.length === 0 && (
          <S.Empty>No consumer groups are consuming this topic.</S.Empty>
        )}
      </S.Fields>
    </Modal>
  );
};

export default MessageResetOffsetsModal;
