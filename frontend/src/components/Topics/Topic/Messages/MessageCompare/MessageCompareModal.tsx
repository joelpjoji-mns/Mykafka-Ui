import React from 'react';
import { SchemaType, TopicMessage } from 'generated-sources';
import { Modal } from 'components/common/Modal';
import { Button } from 'components/common/Button/Button';
import DiffViewer from 'components/common/DiffViewer/DiffViewer';
import { formatTimestamp } from 'lib/dateTimeHelpers';
import { useTimezone } from 'lib/hooks/useTimezones';
import { prettyPrintJson } from 'lib/utils/prettyPrintJson';

import * as S from './MessageCompareModal.styled';

type ComparedField = 'value' | 'key' | 'headers';

const COMPARED_FIELDS: { id: ComparedField; label: string }[] = [
  { id: 'value', label: 'Value' },
  { id: 'key', label: 'Key' },
  { id: 'headers', label: 'Headers' },
];

const sortedHeaders = (headers: TopicMessage['headers']) =>
  Object.fromEntries(
    Object.entries(headers ?? {}).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );

export const comparedFieldText = (
  message: TopicMessage,
  field: ComparedField
) => {
  switch (field) {
    case 'key':
      return prettyPrintJson(message.key ?? '', '  ');
    case 'headers':
      return JSON.stringify(sortedHeaders(message.headers), null, 2);
    default:
      return prettyPrintJson(message.value ?? '', '  ');
  }
};

interface MessageCompareModalProps {
  messages: [TopicMessage, TopicMessage];
  onClose: () => void;
}

const MessageCompareModal: React.FC<MessageCompareModalProps> = ({
  messages,
  onClose,
}) => {
  const { currentTimezone } = useTimezone();
  const [swapped, setSwapped] = React.useState(false);
  const [field, setField] = React.useState<ComparedField>('value');
  const [left, right] = swapped ? [messages[1], messages[0]] : messages;

  const formatTime = (message: TopicMessage) =>
    formatTimestamp({
      timestamp: message.timestamp,
      timezone: currentTimezone.value,
      withMilliseconds: true,
    });

  const metadata: { label: string; values: [string, string] }[] = [
    {
      label: 'Message ID',
      values: [
        `${left.partition}:${left.offset}`,
        `${right.partition}:${right.offset}`,
      ],
    },
    { label: 'Timestamp', values: [formatTime(left), formatTime(right)] },
    {
      label: 'Key size (bytes)',
      values: [String(left.keySize ?? '-'), String(right.keySize ?? '-')],
    },
    {
      label: 'Value size (bytes)',
      values: [String(left.valueSize ?? '-'), String(right.valueSize ?? '-')],
    },
    {
      label: 'Headers size (bytes)',
      values: [
        String(left.headersSize ?? '-'),
        String(right.headersSize ?? '-'),
      ],
    },
    {
      label: 'Key serde',
      values: [left.keySerde ?? '-', right.keySerde ?? '-'],
    },
    {
      label: 'Value serde',
      values: [left.valueSerde ?? '-', right.valueSerde ?? '-'],
    },
  ];

  const texts = React.useMemo(
    () =>
      Object.fromEntries(
        COMPARED_FIELDS.map(({ id }) => [
          id,
          [comparedFieldText(left, id), comparedFieldText(right, id)],
        ])
      ) as Record<ComparedField, [string, string]>,
    [left, right]
  );
  const [leftText, rightText] = texts[field];
  const fieldLabel =
    COMPARED_FIELDS.find(({ id }) => id === field)?.label ?? '';

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Compare messages"
      maxWidth="90vw"
      maxHeight="90vh"
      footer={
        <>
          <Button
            buttonType="secondary"
            buttonSize="M"
            onClick={() => setSwapped((value) => !value)}
          >
            Swap sides
          </Button>
          <Button buttonType="primary" buttonSize="M" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <S.Section>
        <S.MetadataTable aria-label="Compared message metadata">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Left</th>
              <th scope="col">Right</th>
            </tr>
          </thead>
          <tbody>
            {metadata.map(({ label, values }) => (
              <S.MetadataRow key={label} $differs={values[0] !== values[1]}>
                <th scope="row">{label}</th>
                <td>{values[0]}</td>
                <td>{values[1]}</td>
              </S.MetadataRow>
            ))}
          </tbody>
        </S.MetadataTable>
        <S.FieldTabs role="group" aria-label="Compared field">
          {COMPARED_FIELDS.map(({ id, label }) => {
            const differs = texts[id][0] !== texts[id][1];
            return (
              <Button
                key={id}
                buttonType={field === id ? 'primary' : 'secondary'}
                buttonSize="S"
                aria-pressed={field === id}
                onClick={() => setField(id)}
              >
                {differs ? `${label} (differs)` : label}
              </Button>
            );
          })}
        </S.FieldTabs>
        {leftText === rightText ? (
          <S.Summary role="status">
            {fieldLabel} values are identical.
          </S.Summary>
        ) : (
          <DiffViewer
            value={[leftText, rightText]}
            name="message-compare-diff"
            schemaType={SchemaType.JSON}
          />
        )}
      </S.Section>
    </Modal>
  );
};

export default MessageCompareModal;
