import React from 'react';
import Filters, {
  FiltersProps,
} from 'components/Topics/Topic/Messages/Filters/Filters';
import { render, WithRoute } from 'lib/testHelpers';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clusterTopicPath } from 'lib/paths';
import { useTopicDetails } from 'lib/hooks/api/topics';
import { externalTopicPayload } from 'lib/fixtures/topics';
import { useSerdes } from 'lib/hooks/api/topicMessages';
import { serdesPayload } from 'lib/fixtures/topicMessages';
import { PollingMode } from 'generated-sources';
import { ModeOptions } from 'lib/hooks/filterUtils';
import { MessagesFilterKeysTypes } from 'lib/types';
import { MessagesFilterKeys } from 'lib/constants';
import { useSearchParams } from 'react-router-dom';

const closeIconMock = 'closeIconMock';
const filtersSideBarMock = 'filtersSideBarMock';
const filterMetricsMock = 'filterMetricsMock';

jest.mock('lib/hooks/api/topics', () => ({
  useTopicDetails: jest.fn(),
}));

jest.mock('lib/hooks/api/topicMessages', () => ({
  useSerdes: jest.fn(),
}));

jest.mock('components/common/Icons/CloseIcon', () => () => (
  <div>{closeIconMock}</div>
));

jest.mock('use-debounce', () => ({
  useDebouncedCallback: (fn: (e: Event) => void) => fn,
}));

jest.mock(
  'components/Topics/Topic/Messages/Filters/FiltersSideBar',
  () => () => <div>{filtersSideBarMock}</div>
);

jest.mock(
  'components/Topics/Topic/Messages/Filters/FiltersMetrics',
  () => () => <div>{filterMetricsMock}</div>
);

const clusterName = 'cluster-name';
const topicName = 'topic-name';

const SearchParamsProbe = () => {
  const [searchParams] = useSearchParams();

  return <output data-testid="search-params">{searchParams.toString()}</output>;
};

interface StatefulFiltersProps {
  initialStringFilters: string[];
}

const StatefulFilters: React.FC<StatefulFiltersProps> = ({
  initialStringFilters,
}) => {
  const [stringFilters, setStringFilters] =
    React.useState<string[]>(initialStringFilters);

  return (
    <Filters
      isFetching={false}
      abortFetchData={jest.fn()}
      stringFilters={stringFilters}
      setStringFilter={(index, value) => {
        setStringFilters((currentStringFilters) => {
          if (!value) {
            return currentStringFilters.slice(0, index);
          }

          const nextStringFilters = currentStringFilters.slice();
          nextStringFilters[index] = value;
          return nextStringFilters;
        });
      }}
    />
  );
};

const renderComponent = (
  props?: Partial<FiltersProps>,
  queryParams?: Partial<Record<MessagesFilterKeysTypes, string>>
) => {
  const urlParams = new URLSearchParams({ ...queryParams });

  return render(
    <WithRoute path={clusterTopicPath()}>
      <Filters
        isFetching={false}
        abortFetchData={jest.fn()}
        stringFilters={[]}
        setStringFilter={jest.fn()}
        {...props}
      />
    </WithRoute>,
    {
      initialEntries: [
        `${clusterTopicPath(clusterName, topicName)}?${urlParams.toString()}`,
      ],
    }
  );
};

const renderStatefulComponent = (
  queryParams?: Partial<Record<MessagesFilterKeysTypes, string>>,
  initialStringFilters: string[] = []
) => {
  const urlParams = new URLSearchParams({ ...queryParams });

  return render(
    <WithRoute path={clusterTopicPath()}>
      <StatefulFilters initialStringFilters={initialStringFilters} />
    </WithRoute>,
    {
      initialEntries: [
        `${clusterTopicPath(clusterName, topicName)}?${urlParams.toString()}`,
      ],
    }
  );
};

beforeEach(async () => {
  (useTopicDetails as jest.Mock).mockImplementation(() => ({
    data: externalTopicPayload,
  }));
  (useSerdes as jest.Mock).mockImplementation(() => ({
    data: serdesPayload,
  }));
});

describe('Filters component', () => {
  const getSeekTypeSelect = () => screen.getAllByRole('listbox')[0];
  const getKeySerdeDropdown = () => screen.getAllByRole('listbox')[1];
  const getValueSerdeDropdown = () => screen.getAllByRole('listbox')[2];

  it('shows refresh button', () => {
    renderComponent();
    expect(screen.getByText('Refresh')).toBeInTheDocument();
  });

  it('defaults to live updates and can switch back to newest messages', async () => {
    renderComponent();

    const liveUpdates = screen.getByRole('checkbox', {
      name: 'Live updates',
    });
    expect(liveUpdates).toBeChecked();
    expect(getSeekTypeSelect()).toHaveTextContent('Live');

    await userEvent.click(liveUpdates);

    await waitFor(() => {
      expect(liveUpdates).not.toBeChecked();
      expect(getSeekTypeSelect()).toHaveTextContent('Newest');
    });
  });

  it('defaults the message limit to 500 and caps it at 5000', async () => {
    renderComponent();
    const messageLimit = screen.getByLabelText('Message limit');

    expect(messageLimit).toHaveValue('500');

    await userEvent.clear(messageLimit);
    await userEvent.type(messageLimit, '9999');

    expect(messageLimit).toHaveValue('5000');
  });

  describe('refinement search inputs', () => {
    it('does not show refinement search before primary search has text', () => {
      renderComponent();
      expect(
        screen.queryByPlaceholderText('Refine search')
      ).not.toBeInTheDocument();
    });

    it('shows refinement search when primary search has text', () => {
      renderComponent({}, { [MessagesFilterKeys.stringFilter]: 'first' });
      expect(screen.getByPlaceholderText('Refine search')).toBeInTheDocument();
    });

    it('adds another refinement search after typing in the current one', async () => {
      renderStatefulComponent({ [MessagesFilterKeys.stringFilter]: 'first' });

      await userEvent.type(
        screen.getByPlaceholderText('Refine search'),
        'second'
      );

      expect(screen.getAllByPlaceholderText('Refine search')).toHaveLength(2);
    });

    it('removes later refinement searches when an earlier one is cleared', async () => {
      renderStatefulComponent({ [MessagesFilterKeys.stringFilter]: 'first' }, [
        'second',
        'third',
      ]);

      const refinementSearches =
        screen.getAllByPlaceholderText('Refine search');
      expect(refinementSearches).toHaveLength(3);

      await userEvent.clear(refinementSearches[0]);

      expect(screen.getAllByPlaceholderText('Refine search')).toHaveLength(1);
    });

    it('resets refinement searches when primary search is cleared', async () => {
      renderStatefulComponent({ [MessagesFilterKeys.stringFilter]: 'first' }, [
        'second',
      ]);

      fireEvent.change(screen.getByPlaceholderText('Search'), {
        target: { value: '' },
      });

      await waitFor(() => {
        expect(
          screen.queryByPlaceholderText('Refine search')
        ).not.toBeInTheDocument();
      });
    });

    it('preserves refinements and resets the cursor when primary search changes', async () => {
      render(
        <WithRoute path={clusterTopicPath()}>
          <Filters
            isFetching={false}
            abortFetchData={jest.fn()}
            stringFilters={[]}
            setStringFilter={jest.fn()}
          />
          <SearchParamsProbe />
        </WithRoute>,
        {
          initialEntries: [
            `${clusterTopicPath(
              clusterName,
              topicName
            )}?stringFilter=first&stringFilter=second&cursor=3`,
          ],
        }
      );

      fireEvent.change(screen.getByPlaceholderText('Search'), {
        target: { value: 'updated' },
      });

      await waitFor(() => {
        const searchParams = new URLSearchParams(
          screen.getByTestId('search-params').textContent || ''
        );

        expect(searchParams.getAll(MessagesFilterKeys.stringFilter)).toEqual([
          'updated',
          'second',
        ]);
        expect(searchParams.has(MessagesFilterKeys.cursor)).toBe(false);
      });
    });

    it('clears primary and refinement search filters together', async () => {
      render(
        <WithRoute path={clusterTopicPath()}>
          <Filters
            isFetching={false}
            abortFetchData={jest.fn()}
            stringFilters={[]}
            setStringFilter={jest.fn()}
          />
          <SearchParamsProbe />
        </WithRoute>,
        {
          initialEntries: [
            `${clusterTopicPath(
              clusterName,
              topicName
            )}?stringFilter=first&stringFilter=second&cursor=3`,
          ],
        }
      );

      fireEvent.change(screen.getByPlaceholderText('Search'), {
        target: { value: '' },
      });

      await waitFor(() => {
        const searchParams = new URLSearchParams(
          screen.getByTestId('search-params').textContent || ''
        );

        expect(searchParams.getAll(MessagesFilterKeys.stringFilter)).toEqual(
          []
        );
        expect(searchParams.has(MessagesFilterKeys.cursor)).toBe(false);
      });
    });
  });

  describe('Filter Input default elements', () => {
    const inputValue = 'Hello World!';

    const selectDropdownAndCheckInput = async (
      value: string,
      placeholder: string
    ) => {
      const seekTypeSelect = getSeekTypeSelect();
      const option = screen.getAllByRole('option');

      await userEvent.click(seekTypeSelect);

      await userEvent.selectOptions(seekTypeSelect, [value]);

      expect(option[0]).toHaveTextContent(value);
      const timestampInput = screen.getByPlaceholderText(placeholder);
      expect(timestampInput).toHaveValue('');

      await userEvent.type(timestampInput, inputValue);

      expect(timestampInput).toHaveValue(inputValue);
    };

    beforeEach(() => {
      renderComponent();
    });

    it('search input and selectable mode', async () => {
      const searchInput = screen.getByPlaceholderText('Search');
      expect(searchInput).toHaveValue('');
      await userEvent.type(searchInput, inputValue);
      expect(searchInput).toHaveValue(inputValue);
    });

    it('offset input from offset option', async () => {
      await selectDropdownAndCheckInput('From offset', 'Offset');
    });

    it('timestamp input since time', async () => {
      await selectDropdownAndCheckInput('Since time', 'Select timestamp');
    });

    it('timestamp input since time', async () => {
      await selectDropdownAndCheckInput('To time', 'Select timestamp');
    });

    it('shows compact range controls from the time range mode', async () => {
      const seekTypeSelect = getSeekTypeSelect();

      await userEvent.click(seekTypeSelect);
      await userEvent.click(screen.getByRole('option', { name: 'Time range' }));

      await waitFor(() => {
        expect(seekTypeSelect).toHaveTextContent('Time range');
        expect(
          screen.getByTestId('time-range-preset-select')
        ).toBeInTheDocument();
      });
    });
  });

  describe('change from and to offset filter', () => {
    const inputValue = 'Hello World!';

    it('saves filter value', async () => {
      await act(() => renderComponent());

      const seekTypeSelect = getSeekTypeSelect();
      const option = screen.getAllByRole('option');

      await userEvent.click(seekTypeSelect);
      await userEvent.selectOptions(seekTypeSelect, ['From offset']);

      expect(option[0]).toHaveTextContent('From offset');
      const timestampInput = screen.getByPlaceholderText('Offset');
      expect(timestampInput).toHaveValue('');
      await userEvent.type(timestampInput, inputValue);

      expect(timestampInput).toHaveValue(inputValue);

      await userEvent.click(seekTypeSelect);
      await userEvent.selectOptions(seekTypeSelect, ['To offset']);

      expect(timestampInput).toHaveValue(inputValue);
    });
  });

  describe('checks the input values when data comes from the url', () => {
    const renderAndCheckSelectType = (
      mode: PollingMode,
      { timestamp, offset }: { timestamp?: string; offset?: string }
    ) => {
      renderComponent(
        {},
        {
          [MessagesFilterKeys.mode]: mode.toString(),
          [MessagesFilterKeys.timestamp]: timestamp,
          [MessagesFilterKeys.offset]: offset,
        }
      );
      const item = ModeOptions.find((i) => i.value === mode);
      expect(getSeekTypeSelect()).toHaveTextContent(item?.label || '');
    };

    describe('modes and the related inputs', () => {
      it('should check the mode input value latest', () => {
        renderAndCheckSelectType(PollingMode.LATEST, {});
      });

      it('should check the mode input value earliest', () => {
        renderAndCheckSelectType(PollingMode.EARLIEST, {});
      });

      it('should check the mode input value tailest', () => {
        renderAndCheckSelectType(PollingMode.TAILING, {});
      });

      it('should check the mode input value from offset', () => {
        const offset = '2';
        renderAndCheckSelectType(PollingMode.FROM_OFFSET, { offset });
        expect(screen.getAllByRole('textbox')[0]).toHaveValue(offset);
      });

      it('should check the mode input value to offset', () => {
        const offset = '2';
        renderAndCheckSelectType(PollingMode.TO_OFFSET, { offset });
        expect(screen.getAllByRole('textbox')[0]).toHaveValue(offset);
      });

      it('should check the mode input value to timestamp', () => {
        const currentDate = new Date(1707940800000);
        renderAndCheckSelectType(PollingMode.TO_TIMESTAMP, {
          timestamp: currentDate.getTime().toString(),
        });

        // DatePicker uses format "MMM d, yyyy HH:mm" - verify timestamp input has a value
        const timestampInput = screen.getByPlaceholderText('Select timestamp');
        expect(timestampInput).not.toHaveValue('');
      });

      it('should check the mode input value from timestamp', () => {
        const currentDate = new Date(1707940800000);
        renderAndCheckSelectType(PollingMode.FROM_TIMESTAMP, {
          timestamp: currentDate.getTime().toString(),
        });

        // DatePicker uses format "MMM d, yyyy HH:mm" - verify timestamp input has a value
        const timestampInput = screen.getByPlaceholderText('Select timestamp');
        expect(timestampInput).not.toHaveValue('');
      });

      it('should show time range mode when start and end timestamps are in the url', () => {
        const start = new Date(1707940800000);
        const end = new Date(1708027200000);
        renderComponent(
          {},
          {
            [MessagesFilterKeys.mode]: PollingMode.FROM_TIMESTAMP,
            [MessagesFilterKeys.timestamp]: start.getTime().toString(),
            [MessagesFilterKeys.timestampTo]: end.getTime().toString(),
          }
        );

        expect(getSeekTypeSelect()).toHaveTextContent('Time range');
        expect(
          screen.getByTestId('time-range-preset-select')
        ).toBeInTheDocument();
      });
    });

    it('should check the search value', () => {
      const searchFilter = 'searchFilter';
      renderComponent({}, { [MessagesFilterKeys.stringFilter]: searchFilter });
      expect(screen.getByPlaceholderText('Search')).toHaveValue(searchFilter);
    });

    describe('Serde dropdown', () => {
      beforeEach(async () => {
        (useSerdes as jest.Mock).mockImplementation(() => ({
          data: serdesPayload,
        }));
      });

      it('should check the keySerde', () => {
        if (!serdesPayload.key || !serdesPayload.key[0]) return;

        renderComponent(
          {},
          { [MessagesFilterKeys.keySerde]: serdesPayload.key[0].name }
        );
        expect(getKeySerdeDropdown()).toHaveTextContent(
          serdesPayload.key[0].name || ''
        );
      });

      it('should check the valueSerde', () => {
        if (!serdesPayload.value || !serdesPayload.value[0]) return;

        renderComponent(
          {},
          { [MessagesFilterKeys.valueSerde]: serdesPayload.value[0].name }
        );

        expect(getValueSerdeDropdown()).toHaveTextContent(
          serdesPayload.value[0].name || ''
        );
      });
    });
  });
});
