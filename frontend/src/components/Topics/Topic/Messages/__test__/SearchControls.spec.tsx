import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, WithRoute } from 'lib/testHelpers';
import { clusterTopicPath } from 'lib/paths';
import SearchControls from 'components/Topics/Topic/Messages/SearchControls';

const mutate = jest.fn();
const onSearch = jest.fn();
jest.mock('lib/hooks/api/topicMessages', () => ({
  useDownloadSettings: () => ({
    data: { defaultLimit: 10000, maxLimit: 25000 },
  }),
  useDownloadMessagesZip: () => ({ mutate, isPending: false }),
}));

const renderControls = (query = '?mode=EARLIEST', hasSearched = true) =>
  render(
    <WithRoute path={`${clusterTopicPath()}/search`}>
      <SearchControls hasSearched={hasSearched} onSearch={onSearch} />
    </WithRoute>,
    {
      initialEntries: [
        `${clusterTopicPath('cluster', 'topic')}/search${query}`,
      ],
    }
  );

describe('Search controls', () => {
  beforeEach(() => {
    mutate.mockClear();
    onSearch.mockClear();
    localStorage.clear();
  });

  it('searches individual comma-separated terms with ANY semantics and exports the same search', async () => {
    renderControls();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Search terms' }),
      '1,2,3,4,2'
    );
    await waitFor(() =>
      expect(onSearch).toHaveBeenLastCalledWith(
        JSON.stringify([['1', '2', '3', '4'], 'ANY', 'ALL'])
      )
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Download matching results (NDJSON)' })
    );
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        stringFilters: ['1', '2', '3', '4'],
        searchMatch: 'ANY',
        searchScope: 'ALL',
        downloadMode: 'EARLIEST',
        limit: 10000,
      })
    );
  });

  it('shows an example placeholder and prevents empty searches', async () => {
    renderControls('', false);
    expect(
      screen.getByRole('textbox', { name: 'Search terms' })
    ).toHaveAttribute('placeholder', 'e.g. order-123, customer-456, trace-id');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Search terms' }),
      ' , , '
    );
    await waitFor(() => expect(onSearch).toHaveBeenLastCalledWith(null));
    expect(
      screen.queryByRole('button', { name: 'Search' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('spinbutton', { name: 'Export result limit' })
    ).not.toBeInTheDocument();
  });

  it('preserves header-only searches and the time window in exports', async () => {
    renderControls(
      '?mode=FROM_TIMESTAMP&timestamp=123&timestampTo=456&searchScope=HEADERS&searchMatch=ALL&stringFilter=trace&stringFilter=request&partitions=0,2'
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Download matching results (NDJSON)' })
    );
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        stringFilters: ['trace', 'request'],
        searchScope: 'HEADERS',
        searchMatch: 'ALL',
        timestamp: '123',
        timestampTo: '456',
        partitions: ['0', '2'],
      })
    );
  });

  it('enforces the server maximum rather than a fixed 5000 limit', async () => {
    renderControls();
    const input = screen.getByRole('spinbutton', {
      name: 'Export result limit',
    });
    await userEvent.clear(input);
    await userEvent.type(input, '25001');
    expect(
      screen.getByRole('button', { name: 'Download matching results (NDJSON)' })
    ).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, '20000');
    await userEvent.click(
      screen.getByRole('button', { name: 'Download matching results (NDJSON)' })
    );
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20000 })
    );
  });

  it('searches all 500 distinct terms without dropping any', async () => {
    renderControls('', false);
    const terms = Array.from({ length: 500 }, (_, index) => `id-${index}`);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search terms' }), {
      target: { value: terms.join(',') },
    });
    await waitFor(() =>
      expect(onSearch).toHaveBeenLastCalledWith(
        JSON.stringify([terms, 'ANY', 'ALL'])
      )
    );
    expect(screen.getByText('500 / 500 search terms')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('blocks 501 distinct terms and resumes automatically once the count is valid', async () => {
    renderControls('', false);
    const terms = Array.from({ length: 501 }, (_, index) => `id-${index}`);
    const input = screen.getByRole('textbox', { name: 'Search terms' });
    fireEvent.change(input, { target: { value: terms.join(',') } });
    expect(screen.getByRole('alert')).toHaveTextContent('501 distinct terms');
    await waitFor(() => expect(onSearch).toHaveBeenLastCalledWith(null));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(input, {
      target: { value: terms.slice(0, 500).join(',') },
    });
    await waitFor(() =>
      expect(onSearch).toHaveBeenLastCalledWith(
        JSON.stringify([terms.slice(0, 500), 'ANY', 'ALL'])
      )
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
