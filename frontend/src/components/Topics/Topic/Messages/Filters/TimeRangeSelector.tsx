import 'react-datepicker/dist/react-datepicker.css';

import React, { useMemo } from 'react';
import styled from 'styled-components';
import Select, { SelectOption } from 'components/common/Select/Select';
import SingleDatePicker from 'components/common/SingleDatePicker/SingleDatePicker';

export interface TimeRangeSelectorProps {
  start: Date | null;
  end: Date | null;
  onApply: (start: Date | null, end: Date | null) => void;
  disabled?: boolean;
}

interface Preset {
  label: string;
  value: string;
  ms: number;
}

const CUSTOM_RANGE = 'custom';

const PRESETS: Preset[] = [
  { label: 'Last 1h', value: 'last-1h', ms: 60 * 60 * 1000 },
  { label: 'Last 1 day', value: 'last-1-day', ms: 24 * 60 * 60 * 1000 },
  { label: 'Last 7 days', value: 'last-7-days', ms: 7 * 24 * 60 * 60 * 1000 },
  {
    label: 'Last 1 month',
    value: 'last-1-month',
    ms: 30 * 24 * 60 * 60 * 1000,
  },
];

const PRESET_OPTIONS: SelectOption<string>[] = [
  { label: 'Custom', value: CUSTOM_RANGE },
  ...PRESETS.map(({ label, value }) => ({ label, value })),
];

const RangeRoot = styled.div`
  display: flex;
  align-items: center;
  gap: 0;
  flex-wrap: wrap;

  & > div:first-child > ul {
    border-left: none;
    border-radius: 0;
  }
`;

const RangeFields = styled.div`
  display: flex;
  align-items: center;
  height: 32px;
  border: 1px solid ${({ theme }) => theme.select.borderColor.normal};
  border-left: none;
  border-radius: 4px;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  background-color: ${({ theme }) => theme.input.backgroundColor.normal};
  overflow: hidden;

  .react-datepicker-wrapper {
    width: 122px;
  }
`;

const RangeLabel = styled.span`
  display: inline-flex;
  align-items: center;
  align-self: stretch;
  font-size: 12px;
  color: ${({ theme }) => theme.metrics.filters.color.normal};
  padding: 0 6px;
  background-color: ${({ theme }) => theme.layout.stuffColor};

  & + .react-datepicker-wrapper {
    border-right: 1px solid ${({ theme }) => theme.select.borderColor.normal};
  }
`;

const RangeDate = styled(SingleDatePicker)`
  height: 30px;
  border: none;
  outline: none;
  background-color: transparent;
  color: ${({ theme }) => theme.input.color.normal};
  font-size: 12px;
  width: 122px;
  padding: 0 6px;

  &::placeholder {
    color: ${({ theme }) => theme.input.color.normal};
    opacity: 0.6;
  }
`;

const TimezoneBadge = styled.span`
  display: inline-flex;
  align-items: center;
  align-self: stretch;
  font-size: 11px;
  color: ${({ theme }) => theme.metrics.filters.color.normal};
  padding: 0 8px;
  white-space: nowrap;
  background-color: ${({ theme }) => theme.layout.stuffColor};
`;

const ClearButton = styled.button`
  height: 32px;
  margin-left: 6px;
  padding: 0 8px;
  border: 1px solid ${({ theme }) => theme.select.borderColor.normal};
  border-radius: 4px;
  background-color: transparent;
  color: ${({ theme }) => theme.input.color.normal};
  font-size: 12px;
  cursor: pointer;

  &:hover:not(:disabled) {
    background-color: ${({ theme }) => theme.layout.stuffColor};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

// The date pickers work in the browser's local time, so the badge must
// describe the browser timezone rather than the app-selected display timezone.
const detectTimezone = (): { tz: string; offset: string } => {
  let tz = 'UTC';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    tz = 'UTC';
  }
  // Format the current offset as +HH:MM / -HH:MM
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return { tz, offset: `UTC${sign}${hh}:${mm}` };
};

const TimeRangeSelector: React.FC<TimeRangeSelectorProps> = ({
  start,
  end,
  onApply,
  disabled,
}) => {
  const { tz, offset } = useMemo(detectTimezone, []);

  const activePresetValue = useMemo(() => {
    if (!start || !end) return CUSTOM_RANGE;
    const diff = end.getTime() - start.getTime();
    const now = Date.now();
    const endIsNow = Math.abs(now - end.getTime()) < 60 * 1000;
    if (!endIsNow) return CUSTOM_RANGE;
    const match = PRESETS.find((p) => Math.abs(p.ms - diff) < 1000);
    return match?.value ?? CUSTOM_RANGE;
  }, [start, end]);

  const applyPreset = (value: string) => {
    const preset = PRESETS.find((p) => p.value === value);
    if (!preset) return;
    const now = new Date();
    const from = new Date(now.getTime() - preset.ms);
    onApply(from, now);
  };

  const setStart = (value: Date | null) => onApply(value, end);
  const setEnd = (value: Date | null) => onApply(start, value);

  return (
    <RangeRoot>
      <Select<string>
        data-testid="time-range-preset-select"
        selectSize="M"
        minWidth="108px"
        options={PRESET_OPTIONS}
        value={activePresetValue}
        disabled={disabled}
        onChange={applyPreset}
      />
      <RangeFields>
        <RangeLabel>From</RangeLabel>
        <RangeDate
          selected={start}
          onChange={setStart}
          showTimeInput
          timeInputLabel="Time:"
          dateFormat="MMM d, yyyy HH:mm"
          placeholderText="From date & time"
          aria-label="From date and time"
          disabled={disabled}
          isClearable
        />
        <RangeLabel>To</RangeLabel>
        <RangeDate
          selected={end}
          onChange={setEnd}
          showTimeInput
          timeInputLabel="Time:"
          dateFormat="MMM d, yyyy HH:mm"
          placeholderText="To date & time"
          aria-label="To date and time"
          disabled={disabled}
          isClearable
        />
        <TimezoneBadge title={`Browser timezone (${tz}, ${offset})`}>
          {offset}
        </TimezoneBadge>
      </RangeFields>
      {(start || end) && (
        <ClearButton
          type="button"
          aria-label="Clear time range"
          onClick={() => onApply(null, null)}
        >
          Clear
        </ClearButton>
      )}
    </RangeRoot>
  );
};

export default TimeRangeSelector;
