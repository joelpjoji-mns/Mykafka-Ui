import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from 'lib/testHelpers';
import Download from 'components/Topics/Topic/Download/Download';
import { useTopicDetails } from 'lib/hooks/api/topics';
import {
  useDownloadMessagesZip,
  useDownloadSettings,
  useSerdes,
} from 'lib/hooks/api/topicMessages';
import useAppParams from 'lib/hooks/useAppParams';
import { MessagesFilterKeys } from 'lib/constants';
import { saveMessageViewFilterSnapshot } from 'lib/messageViewFilterSnapshot';
import { PollingMode } from 'generated-sources';

const mutate = jest.fn();

jest.mock('lib/hooks/api/topics', () => ({
  useTopicDetails: jest.fn(),
}));

jest.mock('lib/hooks/api/topicMessages', () => ({
  useDownloadMessagesZip: jest.fn(),
  useSerdes: jest.fn(),
  useDownloadSettings: jest.fn(),
}));

jest.mock('lib/hooks/useAppParams', () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe('Download', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mutate.mockReset();
    (useDownloadSettings as jest.Mock).mockReturnValue({
      data: { defaultLimit: 5000, maxLimit: 5000 },
    });
    (useAppParams as jest.Mock).mockReturnValue({
      clusterName: 'test-cluster',
      topicName: 'test-topic',
    });
    (useTopicDetails as jest.Mock).mockReturnValue({
      data: { partitions: [] },
    });
    (useSerdes as jest.Mock).mockReturnValue({
      data: { key: [], value: [] },
    });
    (useDownloadMessagesZip as jest.Mock).mockReturnValue({
      mutate,
      isPending: false,
    });
  });

  it('adds and removes progressive refinement searches', async () => {
    render(<Download />);

    await userEvent.type(screen.getByLabelText('Search messages'), 'primary');
    const firstRefinement = screen.getByLabelText('Refine search');
    await userEvent.type(firstRefinement, 'secondary');

    expect(screen.getAllByLabelText('Refine search')).toHaveLength(2);

    await userEvent.clear(firstRefinement);

    expect(screen.getAllByLabelText('Refine search')).toHaveLength(1);
  });

  it('disables filter import until Message View has a snapshot', () => {
    render(<Download />);

    expect(
      screen.getByRole('button', { name: 'Import Message View filters' })
    ).toBeDisabled();
  });

  it('sends every populated search filter with the export request', async () => {
    render(<Download />);

    await userEvent.type(screen.getByLabelText('Search messages'), 'primary');
    await userEvent.type(screen.getByLabelText('Refine search'), 'secondary');

    await userEvent.click(screen.getByRole('button', { name: 'Download ZIP' }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterName: 'test-cluster',
        topicName: 'test-topic',
        stringFilters: ['primary', 'secondary'],
      })
    );
  });

  it('caps the download limit at 5000', async () => {
    render(<Download />);
    const messageLimit = screen.getByLabelText('Max messages');

    expect(messageLimit).toHaveValue('5000');

    await userEvent.clear(messageLimit);
    await userEvent.type(messageLimit, '9999');
    await userEvent.click(screen.getByRole('button', { name: 'Download ZIP' }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 5000,
      })
    );
  });

  it('imports compatible Message View filters before downloading', async () => {
    const fromTimestamp = Date.UTC(2024, 0, 1, 10, 0);
    const toTimestamp = Date.UTC(2024, 0, 1, 11, 0);
    const messageViewParams = new URLSearchParams();
    messageViewParams.set(MessagesFilterKeys.mode, PollingMode.FROM_TIMESTAMP);
    messageViewParams.set(
      MessagesFilterKeys.timestamp,
      fromTimestamp.toString()
    );
    messageViewParams.set(
      MessagesFilterKeys.timestampTo,
      toTimestamp.toString()
    );
    messageViewParams.set(MessagesFilterKeys.partitions, '0,2');
    messageViewParams.set(MessagesFilterKeys.keySerde, 'KeySerde');
    messageViewParams.set(MessagesFilterKeys.valueSerde, 'ValueSerde');
    messageViewParams.set(MessagesFilterKeys.smartFilterId, 'smart-filter-id');
    messageViewParams.append(MessagesFilterKeys.stringFilter, 'primary');
    messageViewParams.append(MessagesFilterKeys.stringFilter, 'secondary');
    saveMessageViewFilterSnapshot(
      'test-cluster',
      'test-topic',
      messageViewParams
    );

    render(<Download />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Import Message View filters' })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Download ZIP' }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        downloadMode: 'FROM_TIMESTAMP',
        keySerde: 'KeySerde',
        partitions: [0, 2],
        smartFilterId: 'smart-filter-id',
        stringFilters: ['primary', 'secondary'],
        timestamp: fromTimestamp.toString(),
        timestampTo: toTimestamp.toString(),
        valueSerde: 'ValueSerde',
      })
    );
  });

  it('converts a live Message View import to a finite latest download', async () => {
    const messageViewParams = new URLSearchParams();
    messageViewParams.set(MessagesFilterKeys.mode, PollingMode.TAILING);
    saveMessageViewFilterSnapshot(
      'test-cluster',
      'test-topic',
      messageViewParams
    );

    render(<Download />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Import Message View filters' })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Download ZIP' }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        downloadMode: 'LATEST',
      })
    );
  });
});
