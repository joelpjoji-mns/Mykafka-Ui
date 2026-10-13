import React, { ChangeEvent, useState } from 'react';
import styled from 'styled-components';
import { Button } from 'components/common/Button/Button';
import Input from 'components/common/Input/Input';
import { useLocalStorage } from 'lib/hooks/useLocalStorage';

interface Option<T> {
  label: string;
  value: T;
}

type PartitionOption = Option<number>;

export interface DownloadConfig {
  partitionMode: string;
  selectedPartitions: PartitionOption[];
  downloadMode: string;
  limit: string;
  offset: string;
  fromTime: string;
  toTime: string;
  format: string;
  searchFilters: string[];
  smartFilterId: string;
  keySerde?: string;
  valueSerde?: string;
  searchMatch?: string;
  searchScope?: string;
}

type LegacyDownloadConfig = Omit<DownloadConfig, 'searchFilters'> & {
  search?: unknown;
  searchFilters?: unknown;
};

interface DownloadPreset {
  name: string;
  config: LegacyDownloadConfig;
}

interface DownloadPresetsProps {
  currentConfig: DownloadConfig;
  onApply: (config: DownloadConfig) => void;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

export const normalizeDownloadConfig = (
  config: LegacyDownloadConfig
): DownloadConfig => {
  const { search, searchFilters, ...settings } = config;
  let normalizedSearchFilters: string[] = [];

  if (Array.isArray(searchFilters)) {
    normalizedSearchFilters = searchFilters.filter(isNonEmptyString);
  } else if (isNonEmptyString(search)) {
    normalizedSearchFilters = [search];
  }

  return {
    ...settings,
    searchFilters: normalizedSearchFilters,
  };
};

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const PresetName = styled.span`
  flex-grow: 1;
  min-width: 120px;
  font-size: 14px;
  color: ${({ theme }) => theme.default.color.normal};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Empty = styled.p`
  font-size: 13px;
  color: ${({ theme }) => theme.default.color.normal};
  opacity: 0.7;
`;

const SaveRow = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-top: 4px;
  flex-wrap: wrap;
`;

const DownloadPresets: React.FC<DownloadPresetsProps> = ({
  currentConfig,
  onApply,
}) => {
  const [presets, setPresets] = useLocalStorage<DownloadPreset[]>(
    'download-presets',
    []
  );
  const [name, setName] = useState('');

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    setPresets((prev) => {
      const withoutDuplicate = prev.filter((p) => p.name !== trimmed);
      return [...withoutDuplicate, { name: trimmed, config: currentConfig }];
    });
    setName('');
  };

  const handleDelete = (presetName: string) => {
    setPresets((prev) => prev.filter((p) => p.name !== presetName));
  };

  return (
    <List>
      {presets.length === 0 && <Empty>No saved presets yet.</Empty>}
      {presets.map((preset) => (
        <Row key={preset.name}>
          <PresetName title={preset.name}>{preset.name}</PresetName>
          <Button
            buttonType="secondary"
            buttonSize="S"
            aria-label={`Apply preset ${preset.name}`}
            onClick={() => onApply(normalizeDownloadConfig(preset.config))}
          >
            Apply
          </Button>
          <Button
            buttonType="secondary"
            buttonSize="S"
            aria-label={`Delete preset ${preset.name}`}
            onClick={() => handleDelete(preset.name)}
          >
            Delete
          </Button>
        </Row>
      ))}
      <SaveRow>
        <Input
          inputSize="M"
          type="text"
          value={name}
          placeholder="Preset name"
          aria-label="New preset name"
          onChange={({ target: { value } }: ChangeEvent<HTMLInputElement>) =>
            setName(value)
          }
        />
        <Button
          buttonType="primary"
          buttonSize="S"
          aria-label="Save download preset"
          disabled={!name.trim()}
          onClick={handleSave}
        >
          Save current settings
        </Button>
      </SaveRow>
    </List>
  );
};

export default DownloadPresets;
