import React from 'react';
import { render } from 'lib/testHelpers';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TimeRangeSelector from 'components/Topics/Topic/Messages/Filters/TimeRangeSelector';

describe('TimeRangeSelector', () => {
  const setup = (start: Date | null = null, end: Date | null = null) => {
    const onApply = jest.fn();
    render(<TimeRangeSelector start={start} end={end} onApply={onApply} />);
    return { onApply };
  };

  it('renders the compact preset select and the timezone badge', async () => {
    setup();
    const presetSelect = screen.getByTestId('time-range-preset-select');
    expect(presetSelect).toBeInTheDocument();
    expect(screen.getByLabelText('From date and time')).toBeInTheDocument();
    expect(screen.getByLabelText('To date and time')).toBeInTheDocument();

    await userEvent.click(presetSelect);

    ['Last 1h', 'Last 1 day', 'Last 7 days', 'Last 1 month'].forEach(
      (label) => {
        expect(screen.getByRole('option', { name: label })).toBeInTheDocument();
      }
    );
    expect(screen.getByText(/UTC[+-]\d{2}:\d{2}/)).toBeInTheDocument();
  });

  it('labels the badge with the browser timezone used by the date pickers', () => {
    setup();
    const browserTimezone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const badge = screen.getByText(/UTC[+-]\d{2}:\d{2}/);
    expect(badge).toHaveAttribute(
      'title',
      expect.stringContaining(`Browser timezone (${browserTimezone}, UTC`)
    );
    expect(badge.getAttribute('title')).not.toMatch(/Application timezone/);
  });

  it('applies "Last 1 day" preset with a 24h window ending near now', async () => {
    const { onApply } = setup();
    const before = Date.now();
    await userEvent.click(screen.getByTestId('time-range-preset-select'));
    await userEvent.click(screen.getByRole('option', { name: 'Last 1 day' }));
    const after = Date.now();

    expect(onApply).toHaveBeenCalledTimes(1);
    const [start, end] = onApply.mock.calls[0] as [Date, Date];
    expect(start).toBeInstanceOf(Date);
    expect(end).toBeInstanceOf(Date);

    const oneDay = 24 * 60 * 60 * 1000;
    expect(end.getTime() - start.getTime()).toBe(oneDay);
    expect(end.getTime()).toBeGreaterThanOrEqual(before);
    expect(end.getTime()).toBeLessThanOrEqual(after);
  });

  it('applies "Last 7 days" preset with a 7d window', async () => {
    const { onApply } = setup();
    await userEvent.click(screen.getByTestId('time-range-preset-select'));
    await userEvent.click(screen.getByRole('option', { name: 'Last 7 days' }));
    const [start, end] = onApply.mock.calls[0] as [Date, Date];
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('applies "Last 1 month" preset with a 30d window', async () => {
    const { onApply } = setup();
    await userEvent.click(screen.getByTestId('time-range-preset-select'));
    await userEvent.click(screen.getByRole('option', { name: 'Last 1 month' }));
    const [start, end] = onApply.mock.calls[0] as [Date, Date];
    expect(end.getTime() - start.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('shows "Clear" when a range is set and calls onApply(null,null)', async () => {
    const start = new Date(Date.now() - 60 * 60 * 1000);
    const end = new Date();
    const { onApply } = setup(start, end);

    const clear = screen.getByRole('button', { name: /clear time range/i });
    await userEvent.click(clear);

    expect(onApply).toHaveBeenCalledWith(null, null);
  });

  it('hides "Clear" when no range is set', () => {
    setup(null, null);
    expect(
      screen.queryByRole('button', { name: /clear time range/i })
    ).not.toBeInTheDocument();
  });
});
