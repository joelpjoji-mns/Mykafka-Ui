import 'react-datepicker/dist/react-datepicker.css';

/* eslint-disable react/no-array-index-key -- refinement inputs are append-only controlled fields. */

import {
  SerdeUsage,
  PollingMode,
  TopicMessageConsuming,
} from 'generated-sources';
import React, { ChangeEvent, useMemo, useState } from 'react';
import MultiSelect from 'components/common/MultiSelect/MultiSelect.styled';
import Select, { SelectOption } from 'components/common/Select/Select';
import { Button } from 'components/common/Button/Button';
import Search from 'components/common/Search/Search';
import Switch from 'components/common/Switch/Switch';
import PlusIcon from 'components/common/Icons/PlusIcon';
import { getSerdeOptions } from 'components/Topics/Topic/SendMessage/utils';
import { useSerdes } from 'lib/hooks/api/topicMessages';
import useAppParams from 'lib/hooks/useAppParams';
import { RouteParamsClusterTopic } from 'lib/paths';
import { useMessagesFilters } from 'lib/hooks/useMessagesFilters';
import { ModeOptions } from 'lib/hooks/filterUtils';
import { useTopicDetails } from 'lib/hooks/api/topics';
import EditIcon from 'components/common/Icons/EditIcon';
import CloseIcon from 'components/common/Icons/CloseIcon';
import FlexBox from 'components/common/FlexBox/FlexBox';

import * as S from './Filters.styled';
import {
  ADD_FILTER_ID,
  filterOptions,
  isLiveMode,
  isModeOffsetSelector,
  isModeOptionWithInput,
  SeekModeValue,
  TIME_RANGE_MODE,
} from './utils';
import FiltersSideBar from './FiltersSideBar';
import FiltersMetrics from './FiltersMetrics';
import TimeRangeSelector from './TimeRangeSelector';

export interface FiltersProps {
  phaseMessage?: string;
  consumptionStats?: TopicMessageConsuming;
  isFetching: boolean;
  abortFetchData: () => void;
  stringFilters: string[];
  setStringFilter: (index: number, value: string) => void;
}

const DEFAULT_TIME_RANGE_MS = 24 * 60 * 60 * 1000;

const SeekModeOptions: SelectOption<SeekModeValue>[] = [
  ...ModeOptions,
  { value: TIME_RANGE_MODE, label: 'Time range' },
];

const Filters: React.FC<FiltersProps> = ({
  consumptionStats,
  isFetching,
  abortFetchData,
  phaseMessage,
  stringFilters,
  setStringFilter,
}) => {
  const { clusterName, topicName } = useAppParams<RouteParamsClusterTopic>();

  const {
    mode,
    setMode,
    date,
    setTimeStamp,
    timestampTo,
    setTimeRange,
    keySerde,
    setKeySerde,
    valueSerde,
    setValueSerde,
    offset,
    setOffsetValue,
    limit,
    setLimit,
    search,
    setSearch,
    partitions: p,
    setPartition,
    smartFilter,
    setSmartFilter,
    refreshData,
  } = useMessagesFilters(topicName);

  const { data: topic } = useTopicDetails({ clusterName, topicName });
  const [createdEditedSmartId, setCreatedEditedSmartId] = useState<string>();
  const handleTimestampChange = (value: Date | null) => setTimeStamp(value);

  const partitions = useMemo(() => {
    return (topic?.partitions || []).reduce<{
      dict: Record<string, { label: string; value: number }>;
      list: { label: string; value: number }[];
    }>(
      (acc, currentValue) => {
        const label = {
          label: `Partition #${currentValue.partition.toString()}`,
          value: currentValue.partition,
        };

        acc.dict[label.value] = label;
        acc.list.push(label);
        return acc;
      },
      { dict: {}, list: [] }
    );
  }, [topic?.partitions]);

  const partitionValue = useMemo(() => {
    return p.map((value) => partitions.dict[value]);
  }, [p, partitions]);

  const { data: serdes = {}, isLoading } = useSerdes({
    clusterName,
    topicName,
    use: SerdeUsage.DESERIALIZE,
  });

  const handleRefresh = () => {
    if (isLiveMode(mode) && isFetching) {
      abortFetchData();
    }
    refreshData();
  };

  const handleLiveUpdatesChange = () => {
    setMode(
      mode === PollingMode.TAILING ? PollingMode.LATEST : PollingMode.TAILING
    );
  };

  const selectedSeekMode: SeekModeValue =
    mode === PollingMode.FROM_TIMESTAMP && timestampTo ? TIME_RANGE_MODE : mode;

  const handleModeChange = (newMode: SeekModeValue) => {
    if (newMode === TIME_RANGE_MODE) {
      const end = timestampTo || new Date();
      const start = date || new Date(end.getTime() - DEFAULT_TIME_RANGE_MS);
      setTimeRange(start, end);
      return;
    }

    setMode(newMode);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
  };

  const displayedStringFilters = search ? [...stringFilters, ''] : [];

  return (
    <FlexBox flexDirection="column" padding="0 16px">
      <S.Toolbar>
        <S.ToolbarControls>
          <S.FilterModeTypeSelectorWrapper>
            <S.FilterModeTypeSelect
              id="selectSeekType"
              onChange={handleModeChange}
              value={selectedSeekMode}
              selectSize="M"
              minWidth="100px"
              options={SeekModeOptions}
            />

            {selectedSeekMode === TIME_RANGE_MODE ? (
              <TimeRangeSelector
                start={date}
                end={timestampTo}
                onApply={setTimeRange}
                disabled={isFetching}
              />
            ) : (
              isModeOptionWithInput(mode) &&
              (isModeOffsetSelector(mode) ? (
                <S.OffsetSelector
                  id="offset"
                  type="text"
                  inputSize="M"
                  value={offset}
                  placeholder="Offset"
                  onChange={({
                    target: { value },
                  }: ChangeEvent<HTMLInputElement>) => {
                    setOffsetValue(value);
                  }}
                />
              ) : (
                <S.DatePickerInput
                  selected={date}
                  onChange={handleTimestampChange}
                  showTimeInput
                  timeInputLabel="Time:"
                  dateFormat="MMM d, yyyy"
                  placeholderText="Select timestamp"
                />
              ))
            )}
          </S.FilterModeTypeSelectorWrapper>
          <S.LiveUpdatesControl title="New messages appear at the top">
            <Switch
              name="liveUpdates"
              ariaLabel="Live updates"
              checked={mode === PollingMode.TAILING}
              onChange={handleLiveUpdatesChange}
            />
            <S.LiveUpdatesLabel>Live</S.LiveUpdatesLabel>
            <S.LiveUpdatesIndicator
              $active={mode === PollingMode.TAILING}
              aria-hidden
            />
          </S.LiveUpdatesControl>
          <MultiSelect
            disabled={isLoading}
            options={partitions.list}
            filterOptions={filterOptions}
            onChange={setPartition}
            value={partitionValue}
            labelledBy="partitionsOptions"
            overrideStrings={{
              selectSomeItems: 'Select partitions',
            }}
          />
          <Select
            id="selectKeySerdeOptions"
            aria-labelledby="selectKeySerdeOptions"
            onChange={setKeySerde}
            minWidth="170px"
            options={getSerdeOptions(serdes.key || [])}
            value={keySerde}
            selectSize="M"
            placeholder="Key Serde"
          />
          <Select
            id="selectValueSerdeOptions"
            aria-labelledby="selectValueSerdeOptions"
            onChange={setValueSerde}
            options={getSerdeOptions(serdes.value || [])}
            value={valueSerde}
            minWidth="170px"
            selectSize="M"
            placeholder="Value Serde"
          />
          <S.MessageLimitInput
            id="messageLimit"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            inputSize="M"
            value={limit}
            aria-label="Message limit"
            placeholder="Limit"
            onChange={({
              target: { value },
            }: ChangeEvent<HTMLInputElement>) => {
              setLimit(value.replace(/\D/g, ''));
            }}
          />
          <Button
            type="submit"
            buttonType="secondary"
            buttonSize="M"
            onClick={handleRefresh}
            style={{ fontWeight: 500 }}
          >
            Refresh
          </Button>
        </S.ToolbarControls>

        <S.ToolbarSearch>
          <Search
            placeholder="Search"
            value={search}
            onChange={handleSearchChange}
          />
        </S.ToolbarSearch>
      </S.Toolbar>
      {displayedStringFilters.length > 0 && (
        <FlexBox
          width="100%"
          justifyContent="flex-end"
          gap="8px"
          flexWrap="wrap"
          margin="8px 0 0"
        >
          {displayedStringFilters.map((stringFilter, index) => (
            <Search
              key={`refine-search-${index}`}
              placeholder="Refine search"
              value={stringFilter}
              onChange={(value) => setStringFilter(index, value)}
            />
          ))}
        </FlexBox>
      )}
      <FlexBox
        gap="10px"
        alignItems="center"
        justifyContent="flex-start"
        flexWrap="wrap"
        padding="8px 0 5px"
      >
        <Button
          buttonType="secondary"
          buttonSize="M"
          onClick={() => setCreatedEditedSmartId(ADD_FILTER_ID)}
        >
          <PlusIcon />
          Add Filters
        </Button>
        {smartFilter && (
          <S.ActiveSmartFilter data-testid="activeSmartFilter">
            <S.SmartFilterName>{smartFilter.id}</S.SmartFilterName>
            <S.EditSmartFilterIcon
              onClick={() => setCreatedEditedSmartId(smartFilter.id)}
              disabled={!!createdEditedSmartId}
            >
              <EditIcon />
            </S.EditSmartFilterIcon>
            <S.DeleteSmartFilterIcon
              onClick={() => {
                setSmartFilter(null);
              }}
              disabled={!!createdEditedSmartId}
            >
              <CloseIcon />
            </S.DeleteSmartFilterIcon>
          </S.ActiveSmartFilter>
        )}
      </FlexBox>
      <FiltersSideBar
        setClose={() => setCreatedEditedSmartId('')}
        smartFilter={smartFilter}
        setSmartFilter={setSmartFilter}
        setFilterName={setCreatedEditedSmartId}
        filterName={createdEditedSmartId}
      />
      {consumptionStats && (
        <FiltersMetrics
          mode={mode}
          isFetching={isFetching}
          phaseMessage={phaseMessage}
          abortFetchData={abortFetchData}
          consumptionStats={consumptionStats}
        />
      )}
    </FlexBox>
  );
};

export default Filters;
