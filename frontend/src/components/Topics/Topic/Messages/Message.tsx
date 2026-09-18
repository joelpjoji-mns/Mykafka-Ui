import React from 'react';
import { TopicMessage } from 'generated-sources';
import MessageToggleIcon from 'components/common/Icons/MessageToggleIcon';
import IconButtonWrapper from 'components/common/Icons/IconButtonWrapper';
import { formatTimestamp, timeAgo } from 'lib/dateTimeHelpers';
import { JSONPath } from 'jsonpath-plus';
import Ellipsis from 'components/common/Ellipsis/Ellipsis';
import WarningRedIcon from 'components/common/Icons/WarningRedIcon';
import Tooltip from 'components/common/Tooltip/Tooltip';
import BytesFormatted from 'components/common/BytesFormatted/BytesFormatted';
import { useTimezone } from 'lib/hooks/useTimezones';
import ClusterContext from 'components/contexts/ClusterContext';

import MessageContent from './MessageContent/MessageContent';
import MessageActions from './MessageActions';
import * as S from './MessageContent/MessageContent.styled';

export interface PreviewFilter {
  field: string;
  path: string;
}

export interface Props {
  keyFilters: PreviewFilter[];
  headersFilters: PreviewFilter[];
  contentFilters: PreviewFilter[];
  message: TopicMessage;
  isLiveArrival?: boolean;
}

const Message: React.FC<Props> = ({
  message,
  keyFilters,
  headersFilters,
  contentFilters,
  isLiveArrival = false,
}) => {
  const { currentTimezone } = useTimezone();
  const [isOpen, setIsOpen] = React.useState(false);
  const { messageRelativeTimestamp } = React.useContext(ClusterContext);

  const {
    timestamp,
    timestampType,
    offset,
    key,
    keySize,
    partition,
    value,
    valueSize,
    headersSize,
    headers,
    valueSerde,
    keySerde,
    valueDeserializeProperties,
    keyDeserializeProperties,
  } = message;

  const toggleIsOpen = () => setIsOpen(!isOpen);

  const [vEllipsisOpen, setVEllipsisOpen] = React.useState(false);

  const getParsedJson = (jsonValue: string) => {
    try {
      return JSON.parse(jsonValue);
    } catch {
      return {};
    }
  };

  const renderFilteredJson = (
    jsonValue?: string,
    filters?: PreviewFilter[]
  ) => {
    if (!filters?.length || !jsonValue) return jsonValue;
    const parsedJson = getParsedJson(jsonValue);

    return (
      <>
        {filters.map((item) => {
          return (
            <div key={`${item.path}--${item.field}`}>
              {item.field}:{' '}
              {JSON.stringify(
                JSONPath({ path: item.path, json: parsedJson, wrap: false })
              )}
            </div>
          );
        })}
      </>
    );
  };

  const messageTimestamp = formatTimestamp({
    timestamp,
    timezone: currentTimezone.value,
    withMilliseconds: true,
  });
  const serializedHeaders = JSON.stringify(headers || {});
  const messageId = `${partition}:${offset}`;
  const messageSize =
    keySize !== undefined ||
    valueSize !== undefined ||
    headersSize !== undefined
      ? (keySize || 0) + (valueSize || 0) + (headersSize || 0)
      : undefined;
  const messageSizeBreakdown = [
    `Key: ${keySize ?? '-'} bytes`,
    `Value: ${valueSize ?? '-'} bytes`,
    `Headers: ${headersSize ?? '-'} bytes`,
  ].join(', ');

  return (
    <>
      <S.ClickableRow
        $isLiveArrival={isLiveArrival}
        data-live-arrival={isLiveArrival || undefined}
        onMouseEnter={() => setVEllipsisOpen(true)}
        onMouseLeave={() => setVEllipsisOpen(false)}
        onClick={toggleIsOpen}
      >
        <td>
          <IconButtonWrapper aria-hidden>
            <MessageToggleIcon isOpen={isOpen} />
          </IconButtonWrapper>
        </td>
        <td title="Partition:Offset">{messageId}</td>
        <td>{offset}</td>
        <td>{partition}</td>
        <td>
          {messageRelativeTimestamp ? (
            <Tooltip value={timeAgo(timestamp)} content={messageTimestamp} />
          ) : (
            <div>{messageTimestamp}</div>
          )}
        </td>
        <td title={messageSizeBreakdown}>
          {messageSize === undefined ? (
            '-'
          ) : (
            <BytesFormatted value={messageSize} />
          )}
        </td>
        <S.DataCell title={key}>
          <Ellipsis text={renderFilteredJson(key, keyFilters)}>
            {keySerde === 'Fallback' && (
              <Tooltip
                value={<WarningRedIcon />}
                content="Fallback serde was used"
                placement="left"
              />
            )}
          </Ellipsis>
        </S.DataCell>
        <S.DataCell title={serializedHeaders}>
          <Ellipsis
            text={renderFilteredJson(serializedHeaders, headersFilters)}
          />
        </S.DataCell>
        <S.DataCell title={value}>
          <S.Metadata>
            <S.MetadataValue>
              <Ellipsis text={renderFilteredJson(value, contentFilters)}>
                {valueSerde === 'Fallback' && (
                  <Tooltip
                    value={<WarningRedIcon />}
                    content="Fallback serde was used"
                    placement="left"
                  />
                )}
              </Ellipsis>
            </S.MetadataValue>
          </S.Metadata>
        </S.DataCell>
        <td>
          <div style={{ visibility: vEllipsisOpen ? 'visible' : 'hidden' }}>
            <MessageActions message={message} />
          </div>
        </td>
      </S.ClickableRow>
      {isOpen && (
        <MessageContent
          messageKey={key}
          messageContent={value}
          headers={headers}
          timestamp={timestamp}
          timestampType={timestampType}
          keySize={keySize}
          contentSize={valueSize}
          keySerde={keySerde}
          valueSerde={valueSerde}
          valueDeserializeProperties={valueDeserializeProperties}
          keyDeserializeProperties={keyDeserializeProperties}
          actions={<MessageActions message={message} />}
        />
      )}
    </>
  );
};

export default React.memo(Message);
