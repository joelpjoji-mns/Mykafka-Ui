/* eslint-disable @typescript-eslint/no-use-before-define */
/* eslint-disable react/no-array-index-key -- refinement inputs are append-only controlled fields. */
import React, { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { PollingMode, SerdeUsage } from 'generated-sources';
import styled from 'styled-components';
import { Button } from 'components/common/Button/Button';
import FlexBox from 'components/common/FlexBox/FlexBox';
import Input from 'components/common/Input/Input';
import MultiSelect from 'components/common/MultiSelect/MultiSelect.styled';
import Select from 'components/common/Select/Select';
import {
  getPreferredDescription,
  getSerdeOptions,
} from 'components/Topics/Topic/SendMessage/utils';
import { useTopicDetails } from 'lib/hooks/api/topics';
import {
  useDownloadMessagesZip,
  useDownloadSettings,
  useSerdes,
} from 'lib/hooks/api/topicMessages';
import useAppParams from 'lib/hooks/useAppParams';
import { RouteParamsClusterTopic } from 'lib/paths';
import { MessagesFilterKeys } from 'lib/constants';
import { getMessageViewFilterSnapshot } from 'lib/messageViewFilterSnapshot';

import DownloadPresets, { DownloadConfig } from './DownloadPresets';

interface Option<T> {
  label: string;
  value: T;
}

type PartitionOption = Option<number>;

type DownloadMode =
  | 'LATEST'
  | 'EARLIEST'
  | 'FROM_OFFSET'
  | 'TO_OFFSET'
  | 'FROM_TIMESTAMP'
  | 'TO_TIMESTAMP'
  | 'TIMEFRAME'
  | 'PARTITION_OFFSETS'
  | 'PARTITION_OFFSET_RANGES';

type PartitionOffsetRangeValues = {
  start?: string;
  end?: string;
};

const downloadModeOptions: Option<DownloadMode>[] = [
  { label: 'Newest / last N', value: 'LATEST' },
  { label: 'Oldest / first N', value: 'EARLIEST' },
  { label: 'From offset', value: 'FROM_OFFSET' },
  { label: 'To offset', value: 'TO_OFFSET' },
  { label: 'From time', value: 'FROM_TIMESTAMP' },
  { label: 'To time', value: 'TO_TIMESTAMP' },
  { label: 'Time frame', value: 'TIMEFRAME' },
  { label: 'Per-partition start offsets', value: 'PARTITION_OFFSETS' },
  { label: 'Per-partition offset ranges', value: 'PARTITION_OFFSET_RANGES' },
];

const formatOptions: Option<string>[] = [
  { label: 'Text export (ZIP, one file per message)', value: 'TEXT' },
  { label: 'JSON metadata + payload (ZIP)', value: 'JSON' },
  { label: 'Payload only (ZIP)', value: 'VALUE_ONLY' },
  { label: 'CSV (single file)', value: 'CSV' },
  { label: 'NDJSON (single file)', value: 'NDJSON' },
];

const singleFileFormats = new Set(['CSV', 'NDJSON']);

const partitionModeOptions: Option<string>[] = [
  { label: 'All partitions', value: 'ALL' },
  { label: 'Selected partitions', value: 'SELECTED' },
];

const filterOptions = (options: PartitionOption[], filter: string) =>
  options.filter(({ label }) =>
    label.toLowerCase().includes(filter.toLowerCase())
  );

const toEpochMillis = (value: string) => {
  if (!value) return undefined;

  const date = new Date(value);
  const timestamp = date.getTime();
  return Number.isNaN(timestamp) ? undefined : timestamp.toString();
};

const numericValue = (value: string, fallback: number, maxLimit: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(Math.trunc(parsed), maxLimit)
    : fallback;
};

const normalizeLimitInput = (value: string, maxLimit: number) => {
  const numericInput = value.replace(/\D/g, '');
  return numericInput
    ? Math.min(Number(numericInput), maxLimit).toString()
    : '';
};

const toDateTimeLocalValue = (epochMillis: string | null) => {
  if (!epochMillis) return '';

  const timestamp = Number(epochMillis);
  if (!Number.isFinite(timestamp)) return '';

  const date = new Date(timestamp);
  const timezoneOffset = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
};

const toPartitionOptions = (partitions: string | null): PartitionOption[] => {
  if (!partitions) return [];

  return partitions
    .split(',')
    .reduce<PartitionOption[]>((options, rawValue) => {
      const partition = Number(rawValue);
      if (Number.isInteger(partition) && partition >= 0) {
        options.push({
          label: `Partition #${partition}`,
          value: partition,
        });
      }
      return options;
    }, []);
};

const isDownloadMode = (mode: string | null): mode is DownloadMode =>
  mode !== null && downloadModeOptions.some(({ value }) => value === mode);
const digitsOnly = (value: string) => value.replace(/\D/g, '');

const Download: React.FC = () => {
  const { clusterName, topicName } = useAppParams<RouteParamsClusterTopic>();
  const { data: downloadSettings } = useDownloadSettings(
    clusterName,
    topicName
  );
  const { data: topic } = useTopicDetails({ clusterName, topicName });
  const { data: serdes = {} } = useSerdes({
    clusterName,
    topicName,
    use: SerdeUsage.DESERIALIZE,
  });
  const downloadMessagesZip = useDownloadMessagesZip();

  const [partitionMode, setPartitionMode] = useState('ALL');
  const [selectedPartitions, setSelectedPartitions] = useState<
    PartitionOption[]
  >([]);
  const [downloadMode, setDownloadMode] = useState<DownloadMode>('LATEST');
  const [limit, setLimit] = useState(downloadSettings.defaultLimit.toString());
  const [searchMatch, setSearchMatch] = useState('ALL');
  const [searchScope, setSearchScope] = useState('ALL');
  const [offset, setOffset] = useState('0');
  const [partitionOffsets, setPartitionOffsets] = useState<Record<number, string>>({});
  const [partitionOffsetRanges, setPartitionOffsetRanges] = useState<
    Record<number, PartitionOffsetRangeValues>
  >({});
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');
  const [format, setFormat] = useState('VALUE_ONLY');
  const [searchFilters, setSearchFilters] = useState<string[]>([]);
  const [smartFilterId, setSmartFilterId] = useState('');
  const [keySerde, setKeySerde] = useState<string | undefined>();
  const [valueSerde, setValueSerde] = useState<string | undefined>();

  const partitionOptions = useMemo<PartitionOption[]>(() => {
    return (topic?.partitions || []).map(({ partition }) => ({
      label: `Partition #${partition}`,
      value: partition,
    }));
  }, [topic?.partitions]);

  const advancedPartitionOptions = useMemo<PartitionOption[]>(() => {
    return partitionMode === 'SELECTED' ? selectedPartitions : partitionOptions;
  }, [partitionMode, partitionOptions, selectedPartitions]);

  const preferredKeySerde = getPreferredDescription(serdes.key || [])?.name;
  const preferredValueSerde = getPreferredDescription(serdes.value || [])?.name;

  useEffect(() => {
    if (!keySerde) setKeySerde(preferredKeySerde);
    if (!valueSerde) setValueSerde(preferredValueSerde);
  }, [keySerde, preferredKeySerde, preferredValueSerde, valueSerde]);

  const isOffsetMode =
    downloadMode === 'FROM_OFFSET' || downloadMode === 'TO_OFFSET';
  const isPartitionOffsetsMode = downloadMode === 'PARTITION_OFFSETS';
  const isPartitionOffsetRangesMode =
    downloadMode === 'PARTITION_OFFSET_RANGES';
  const isAdvancedOffsetMode =
    isPartitionOffsetsMode || isPartitionOffsetRangesMode;
  const isFromTimeVisible =
    downloadMode === 'FROM_TIMESTAMP' || downloadMode === 'TIMEFRAME';
  const isToTimeVisible =
    downloadMode === 'TO_TIMESTAMP' || downloadMode === 'TIMEFRAME';
  const resolvedLimit = numericValue(
    limit,
    downloadSettings.defaultLimit,
    downloadSettings.maxLimit
  );
  const selectedPartitionValues =
    partitionMode === 'SELECTED'
      ? selectedPartitions.map(({ value }) => value)
      : undefined;

  const isSingleFileFormat = singleFileFormats.has(format);
  const downloadKind = isSingleFileFormat ? format : 'ZIP';
  const hasMessageViewFilterSnapshot = Boolean(
    getMessageViewFilterSnapshot(clusterName, topicName)
  );
  const primarySearchFilter = searchFilters[0] || '';
  const displayedRefinementFilters = primarySearchFilter
    ? [...searchFilters.slice(1), '']
    : [];

  const setSearchFilter = (index: number, value: string) => {
    setSearchFilters((currentFilters) => {
      if (!value) {
        return index === 0 ? [] : currentFilters.slice(0, index);
      }

      const nextFilters = currentFilters.slice();
      nextFilters[index] = value;
      return nextFilters;
    });
  };

  const currentConfig: DownloadConfig = {
    partitionMode,
    selectedPartitions,
    downloadMode,
    limit,
    offset,
    fromTime,
    toTime,
    format,
    searchFilters,
    smartFilterId,
    keySerde,
    valueSerde,
    searchMatch,
    searchScope,
  };

  const applyPreset = (config: DownloadConfig) => {
    setPartitionMode(config.partitionMode);
    setSelectedPartitions(config.selectedPartitions ?? []);
    setDownloadMode(config.downloadMode as DownloadMode);
    setLimit(normalizeLimitInput(config.limit, downloadSettings.maxLimit));
    setOffset(config.offset);
    setFromTime(config.fromTime);
    setToTime(config.toTime);
    setFormat(config.format);
    setSearchFilters(config.searchFilters);
    setSmartFilterId(config.smartFilterId);
    setKeySerde(config.keySerde);
    setValueSerde(config.valueSerde);
    setSearchMatch(config.searchMatch || 'ALL');
    setSearchScope(config.searchScope || 'ALL');
  };

  const importMessageViewFilters = () => {
    const snapshot = getMessageViewFilterSnapshot(clusterName, topicName);
    if (!snapshot) return;
    setSearchMatch(snapshot.get('searchMatch') || 'ALL');
    setSearchScope(snapshot.get('searchScope') || 'ALL');

    const importedPartitions = toPartitionOptions(
      snapshot.get(MessagesFilterKeys.partitions)
    );
    const mode = snapshot.get(MessagesFilterKeys.mode);
    const timestamp = snapshot.get(MessagesFilterKeys.timestamp);
    const timestampTo = snapshot.get(MessagesFilterKeys.timestampTo);

    setPartitionMode(importedPartitions.length ? 'SELECTED' : 'ALL');
    setSelectedPartitions(importedPartitions);
    setSearchFilters(
      snapshot.getAll(MessagesFilterKeys.stringFilter).filter(Boolean)
    );
    setSmartFilterId(snapshot.get(MessagesFilterKeys.smartFilterId) || '');
    setKeySerde(snapshot.get(MessagesFilterKeys.keySerde) || undefined);
    setValueSerde(snapshot.get(MessagesFilterKeys.valueSerde) || undefined);
    setOffset(snapshot.get(MessagesFilterKeys.offset) || '0');
    setFromTime('');
    setToTime('');

    if (mode === PollingMode.FROM_TIMESTAMP && timestampTo) {
      setDownloadMode('TIMEFRAME');
      setFromTime(toDateTimeLocalValue(timestamp));
      setToTime(toDateTimeLocalValue(timestampTo));
      return;
    }

    if (mode === PollingMode.FROM_TIMESTAMP) {
      setDownloadMode('FROM_TIMESTAMP');
      setFromTime(toDateTimeLocalValue(timestamp));
      return;
    }

    if (mode === PollingMode.TO_TIMESTAMP) {
      setDownloadMode('TO_TIMESTAMP');
      setToTime(toDateTimeLocalValue(timestamp));
      return;
    }

    if (mode === PollingMode.TAILING) {
      setDownloadMode('LATEST');
      return;
    }

    setDownloadMode(isDownloadMode(mode) ? mode : 'LATEST');
  };

  const updatePartitionOffset = (partition: number, value: string) => {
    setPartitionOffsets((current) => ({
      ...current,
      [partition]: digitsOnly(value),
    }));
  };

  const updatePartitionOffsetRange = (
    partition: number,
    field: keyof PartitionOffsetRangeValues,
    value: string
  ) => {
    setPartitionOffsetRanges((current) => ({
      ...current,
      [partition]: {
        ...current[partition],
        [field]: digitsOnly(value),
      },
    }));
  };

  const partitionOffsetsQuery = () => {
    return advancedPartitionOptions
      .map(({ value }) => `p${value}:${partitionOffsets[value] || '0'}`)
      .join(',');
  };

  const partitionOffsetRangesQuery = () => {
    return advancedPartitionOptions
      .map(({ value }) => {
        const range = partitionOffsetRanges[value] || {};
        const start = range.start || '0';
        const end = range.end || start;
        return `p${value}:${start}-${end}`;
      })
      .join(',');
  };

  const handleDownload = () => {
    let resolvedMode: string = downloadMode;
    if (downloadMode === 'TIMEFRAME') {
      resolvedMode = 'FROM_TIMESTAMP';
    }
    if (isAdvancedOffsetMode) {
      resolvedMode = 'FROM_OFFSET';
    }
    const timestamp =
      !isAdvancedOffsetMode && downloadMode === 'TO_TIMESTAMP'
        ? toEpochMillis(toTime)
        : toEpochMillis(fromTime);
    const timestampTo =
      !isAdvancedOffsetMode && downloadMode === 'TIMEFRAME'
        ? toEpochMillis(toTime)
        : undefined;

    downloadMessagesZip.mutate({
      clusterName,
      topicName,
      limit: resolvedLimit,
      partitions: isAdvancedOffsetMode ? undefined : selectedPartitionValues,
      stringFilters: searchFilters.length ? searchFilters : undefined,
      smartFilterId: smartFilterId || undefined,
      keySerde,
      valueSerde,
      downloadMode: resolvedMode,
      offset: !isAdvancedOffsetMode && isOffsetMode ? offset : undefined,
      timestamp: isAdvancedOffsetMode ? undefined : timestamp,
      timestampTo,
      format,
      searchMatch,
      searchScope,
      partitionOffsets:
        isPartitionOffsetsMode && advancedPartitionOptions.length
          ? partitionOffsetsQuery()
          : undefined,
      partitionOffsetRanges:
        isPartitionOffsetRangesMode && advancedPartitionOptions.length
          ? partitionOffsetRangesQuery()
          : undefined,
    });
  };

  return (
    <Page>
      <Hero>
        <div>
          <Eyebrow>Topic export center</Eyebrow>
          <Title>Download messages</Title>
          <Description>
            Export Kafka messages as a ZIP (one file per message) or as a single
            CSV or NDJSON file, with partition, offset, timestamp, serde-aware
            payloads, filters, and window controls.
          </Description>
        </div>
        <HeroActions>
          <Button
            buttonType="secondary"
            buttonSize="M"
            onClick={importMessageViewFilters}
            disabled={!hasMessageViewFilterSnapshot}
          >
            Import Message View filters
          </Button>
          <Button
            buttonType="primary"
            buttonSize="M"
            onClick={handleDownload}
            disabled={
              downloadMessagesZip.isPending ||
              (isAdvancedOffsetMode && !advancedPartitionOptions.length)
            }
          >
            {downloadMessagesZip.isPending
              ? `Preparing ${downloadKind}...`
              : `Download ${downloadKind}`}
          </Button>
        </HeroActions>
      </Hero>

      <Grid>
        <Card>
          <CardTitle>1. Partitions</CardTitle>
          <Field>
            <Label>Scope</Label>
            <Select
              id="downloadPartitionMode"
              options={partitionModeOptions}
              value={partitionMode}
              onChange={setPartitionMode}
              minWidth="100%"
            />
          </Field>
          {partitionMode === 'SELECTED' && (
            <Field>
              <Label>Partition picker</Label>
              <MultiSelect
                options={partitionOptions}
                filterOptions={filterOptions}
                onChange={(value: PartitionOption[]) =>
                  setSelectedPartitions(value)
                }
                value={selectedPartitions}
                minWidth="100%"
                labelledBy="downloadPartitionOptions"
                overrideStrings={{
                  selectSomeItems: 'Select partitions',
                }}
              />
            </Field>
          )}
        </Card>

        <Card>
          <CardTitle>2. Window</CardTitle>
          <FlexBox gap="12px" flexWrap="wrap" alignItems="flex-end">
            <Field>
              <Label>Mode</Label>
              <Select
                id="downloadMode"
                options={downloadModeOptions}
                value={downloadMode}
                onChange={setDownloadMode}
                minWidth="100%"
              />
            </Field>
            <Field>
              <Label>Max messages</Label>
              <Input
                inputSize="M"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={limit}
                onChange={({
                  target: { value },
                }: ChangeEvent<HTMLInputElement>) => {
                  setLimit(
                    normalizeLimitInput(value, downloadSettings.maxLimit)
                  );
                }}
              />
            </Field>
            {isOffsetMode && (
              <Field>
                <Label>Offset</Label>
                <Input
                  inputSize="M"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={offset}
                  onChange={({
                    target: { value },
                  }: ChangeEvent<HTMLInputElement>) => {
                    setOffset(value.replace(/\D/g, ''));
                  }}
                />
              </Field>
            )}
            {isAdvancedOffsetMode && (
              <AdvancedOffsets>
                <HelperText>
                  {partitionMode === 'SELECTED'
                    ? 'Advanced offsets use the selected partitions below.'
                    : 'Advanced offsets use every partition in this topic.'}{' '}
                  The max messages value is a total ZIP cap across all partitions.
                </HelperText>
                {advancedPartitionOptions.length ? (
                  <OffsetRows>
                    {advancedPartitionOptions.map(({ label, value }) => (
                      <OffsetRow key={value} $range={isPartitionOffsetRangesMode}>
                        <PartitionBadge>{label}</PartitionBadge>
                        {isPartitionOffsetsMode && (
                          <OffsetField>
                            <Label>Start offset</Label>
                            <Input
                              inputSize="M"
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={partitionOffsets[value] || '0'}
                              onChange={({ target }: ChangeEvent<HTMLInputElement>) => {
                                updatePartitionOffset(value, target.value);
                              }}
                            />
                          </OffsetField>
                        )}
                        {isPartitionOffsetRangesMode && (
                          <>
                            <OffsetField>
                              <Label>Start offset</Label>
                              <Input
                                inputSize="M"
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={partitionOffsetRanges[value]?.start || '0'}
                                onChange={({ target }: ChangeEvent<HTMLInputElement>) => {
                                  updatePartitionOffsetRange(value, 'start', target.value);
                                }}
                              />
                            </OffsetField>
                            <OffsetField>
                              <Label>End offset (inclusive)</Label>
                              <Input
                                inputSize="M"
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={
                                  partitionOffsetRanges[value]?.end ||
                                  partitionOffsetRanges[value]?.start ||
                                  '0'
                                }
                                onChange={({ target }: ChangeEvent<HTMLInputElement>) => {
                                  updatePartitionOffsetRange(value, 'end', target.value);
                                }}
                              />
                            </OffsetField>
                          </>
                        )}
                      </OffsetRow>
                    ))}
                  </OffsetRows>
                ) : (
                  <HelperText>Select at least one partition to use this mode.</HelperText>
                )}
              </AdvancedOffsets>
            )}
            {isFromTimeVisible && (
              <Field>
                <Label>From time</Label>
                <Input
                  inputSize="M"
                  type="datetime-local"
                  value={fromTime}
                  onChange={({
                    target: { value },
                  }: ChangeEvent<HTMLInputElement>) => {
                    setFromTime(value);
                  }}
                />
              </Field>
            )}
            {isToTimeVisible && (
              <Field>
                <Label>
                  {downloadMode === 'TIMEFRAME'
                    ? 'To time'
                    : 'At / before time'}
                </Label>
                <Input
                  inputSize="M"
                  type="datetime-local"
                  value={toTime}
                  onChange={({
                    target: { value },
                  }: ChangeEvent<HTMLInputElement>) => {
                    setToTime(value);
                  }}
                />
              </Field>
            )}
          </FlexBox>
          <Description>
            Configured export maximum: {downloadSettings.maxLimit} messages.
          </Description>
        </Card>

        <Card>
          <CardTitle>3. Payload rendering</CardTitle>
          <FlexBox gap="12px" flexWrap="wrap" alignItems="flex-end">
            <Field>
              <Label>Output format</Label>
              <Select
                id="downloadFormat"
                options={formatOptions}
                value={format}
                onChange={setFormat}
                minWidth="100%"
              />
            </Field>
            <Field>
              <Label>Key serde</Label>
              <Select
                id="downloadKeySerde"
                options={getSerdeOptions(serdes.key || [])}
                value={keySerde}
                onChange={setKeySerde}
                minWidth="100%"
                placeholder="Key Serde"
              />
            </Field>
            <Field>
              <Label>Value serde</Label>
              <Select
                id="downloadValueSerde"
                options={getSerdeOptions(serdes.value || [])}
                value={valueSerde}
                onChange={setValueSerde}
                minWidth="100%"
                placeholder="Value Serde"
              />
            </Field>
          </FlexBox>
        </Card>

        <Card>
          <CardTitle>4. Refine export</CardTitle>
          <FlexBox gap="12px" flexWrap="wrap">
            <Select
              id="downloadSearchMatch"
              value={searchMatch}
              onChange={setSearchMatch}
              options={[
                { label: 'Match all terms (AND)', value: 'ALL' },
                { label: 'Match any term (OR)', value: 'ANY' },
              ]}
            />
            <Select
              id="downloadSearchScope"
              value={searchScope}
              onChange={setSearchScope}
              options={[
                { label: 'Key, value and headers', value: 'ALL' },
                { label: 'Headers only', value: 'HEADERS' },
              ]}
            />
          </FlexBox>
          <FlexBox gap="12px" flexWrap="wrap" alignItems="flex-end">
            <Field>
              <Label>Search messages</Label>
              <Input
                inputSize="M"
                type="text"
                value={primarySearchFilter}
                placeholder="Search payload/key/header text"
                onChange={({
                  target: { value },
                }: ChangeEvent<HTMLInputElement>) => {
                  setSearchFilter(0, value);
                }}
              />
            </Field>
            {displayedRefinementFilters.map((searchFilter, index) => (
              <Field key={`download-refine-search-${index}`}>
                <Label>Refine search</Label>
                <Input
                  inputSize="M"
                  type="text"
                  value={searchFilter}
                  placeholder="Further narrow the export"
                  onChange={({
                    target: { value },
                  }: ChangeEvent<HTMLInputElement>) => {
                    setSearchFilter(index + 1, value);
                  }}
                />
              </Field>
            ))}
            <Field>
              <Label>Smart filter id</Label>
              <Input
                inputSize="M"
                type="text"
                value={smartFilterId}
                placeholder="Optional registered filter id"
                onChange={({
                  target: { value },
                }: ChangeEvent<HTMLInputElement>) => {
                  setSmartFilterId(value);
                }}
              />
            </Field>
          </FlexBox>
        </Card>

        <Card>
          <CardTitle>5. Presets</CardTitle>
          <DownloadPresets
            currentConfig={currentConfig}
            onApply={applyPreset}
          />
        </Card>
      </Grid>
    </Page>
  );
};

const Page = styled.div`
  width: 100%;
  max-width: 1400px;
  min-width: 0;
  box-sizing: border-box;
  margin: 0 auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;

  @media screen and (max-width: ${({ theme }) => theme.breakpoints.S}px) {
    padding: 12px;
  }
`;

const Hero = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  padding: 20px;
  border: 1px solid ${({ theme }) => theme.modal.border.contrast};
  border-radius: 12px;
  background-color: ${({ theme }) => theme.modal.backgroundColor};
  color: ${({ theme }) => theme.default.color.normal};

  & > div:first-child {
    flex: 1 1 360px;
    min-width: 0;
    max-width: 100%;
  }

  @media screen and (max-width: ${({ theme }) => theme.breakpoints.M}px) {
    flex-direction: column;
    align-items: stretch;
  }
`;

const HeroActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;

  & > button {
    white-space: nowrap;
  }

  @media screen and (max-width: ${({ theme }) => theme.breakpoints.M}px) {
    width: 100%;
    flex-direction: column;

    & > button {
      width: 100%;
    }
  }
`;

const Eyebrow = styled.div`
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.input.label.color};
`;

const Title = styled.h2`
  margin: 4px 0;
  color: ${({ theme }) => theme.default.color.normal};
  overflow-wrap: anywhere;
`;

const Description = styled.p`
  margin: 0;
  max-width: 760px;
  color: ${({ theme }) => theme.modal.contentColor};
  line-height: 1.5;
  overflow-wrap: anywhere;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 16px;
  min-width: 0;
  max-width: 100%;

  @media screen and (max-width: ${({ theme }) => theme.breakpoints.S}px) {
    grid-template-columns: 1fr;
  }
`;

const Card = styled.div`
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  padding: 16px;
  border: 1px solid ${({ theme }) => theme.modal.border.contrast};
  border-radius: 12px;
  background-color: ${({ theme }) => theme.modal.backgroundColor};
  color: ${({ theme }) => theme.default.color.normal};
`;

const CardTitle = styled.h3`
  margin: 0 0 14px;
  color: ${({ theme }) => theme.default.color.normal};
  overflow-wrap: anywhere;
`;

const Field = styled.label`
  display: flex;
  flex-direction: column;
  flex: 1 1 220px;
  gap: 6px;
  min-width: 0;
  max-width: 100%;

  & > div {
    width: 100%;
    min-width: 0;
    max-width: 100%;
  }

  & > div > ul[role='listbox'] {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
  }

  & > div > ul[role='listbox'] [role='option'] {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dropdown-container {
    max-width: 100%;
  }

  @media screen and (max-width: ${({ theme }) => theme.breakpoints.S}px) {
    flex-basis: 100%;
    width: 100%;
  }
`;

const Label = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.input.label.color};
  overflow-wrap: anywhere;
`;

const HelperText = styled.p`
  margin: 0;
  color: ${({ theme }) => theme.modal.contentColor};
  font-size: 13px;
  line-height: 1.45;
  overflow-wrap: anywhere;
`;

const AdvancedOffsets = styled.div`
  flex: 1 1 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 4px;
`;

const OffsetRows = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  max-height: 360px;
  overflow: auto;
  padding-right: 2px;
`;

const OffsetRow = styled.div<{ $range: boolean }>`
  display: grid;
  grid-template-columns: ${({ $range }) =>
    $range
      ? 'minmax(140px, 1fr) minmax(120px, 1fr) minmax(120px, 1fr)'
      : 'minmax(140px, 1fr) minmax(120px, 2fr)'};
  gap: 12px;
  align-items: end;
  min-width: 0;
  padding: 10px;
  border: 1px solid ${({ theme }) => theme.modal.border.contrast};
  border-radius: 10px;
  background-color: ${({ theme }) => theme.modal.backgroundColor};

  @media screen and (max-width: ${({ theme }) => theme.breakpoints.S}px) {
    grid-template-columns: 1fr;
  }
`;

const PartitionBadge = styled.div`
  min-width: 0;
  color: ${({ theme }) => theme.default.color.normal};
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const OffsetField = styled.label`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

export default Download;
