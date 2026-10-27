import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import {
  AuditTrailEventOutcomeEnum,
  AuditTrailResponse,
  AuditTrailResponseStatusEnum,
} from 'generated-sources';
import AuditExplorer from 'components/AuditExplorer/AuditExplorer';
import useAppParams from 'lib/hooks/useAppParams';
import { useAuditTrail } from 'lib/hooks/api/audit';
import { render } from 'lib/testHelpers';

const refetch = jest.fn();

jest.mock('lib/hooks/api/audit', () => ({
  useAuditTrail: jest.fn(),
}));

jest.mock('lib/hooks/useAppParams', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const response: AuditTrailResponse = {
  status: AuditTrailResponseStatusEnum.AVAILABLE,
  events: [
    {
      timestamp: new Date('2026-08-15T12:00:00Z'),
      operator: 'operator@example.com',
      resources: [
        {
          type: 'TOPIC',
          resourceId: 'orders',
          alter: true,
          accessType: ['DELETE'],
        },
        {
          type: 'CONSUMER',
          resourceId: 'orders-worker',
          alter: true,
          accessType: ['RESET_OFFSETS'],
        },
      ],
      operation: 'deleteTopic',
      outcome: AuditTrailEventOutcomeEnum.SUCCESS,
    },
  ],
  nextCursor: 'page-two',
  truncated: true,
};

describe('AuditExplorer', () => {
  beforeEach(() => {
    refetch.mockReset();
    (useAppParams as jest.Mock).mockReturnValue({ clusterName: 'local' });
    (useAuditTrail as jest.Mock).mockReturnValue({
      data: response,
      error: undefined,
      isLoading: false,
      refetch,
    });
  });

  it('renders evidence, reliable drilldowns, and the bounded-window notice', () => {
    render(<AuditExplorer />);

    expect(screen.getByText('Change evidence')).toBeInTheDocument();
    expect(screen.getByText('operator@example.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'TOPIC: orders' })).toHaveAttribute(
      'href',
      '/ui/clusters/local/all-topics/orders'
    );
    expect(
      screen.getByRole('link', { name: 'CONSUMER: orders-worker' })
    ).toHaveAttribute(
      'href',
      '/ui/clusters/local/consumer-groups/orders-worker'
    );
    expect(
      screen.getByText(/bounded recent audit window/i)
    ).toBeInTheDocument();
  });

  it('applies filters and advances through the cursor trail', async () => {
    render(<AuditExplorer />);

    fireEvent.change(screen.getByLabelText('Resource'), {
      target: { value: 'orders' },
    });
    fireEvent.change(screen.getByLabelText('Operation'), {
      target: { value: 'delete' },
    });
    fireEvent.change(screen.getByLabelText('Outcome'), {
      target: { value: 'SUCCESS' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() =>
      expect(useAuditTrail).toHaveBeenLastCalledWith(
        'local',
        expect.objectContaining({
          resource: 'orders',
          operation: 'delete',
          outcome: 'SUCCESS',
          cursor: undefined,
          limit: 25,
        })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() =>
      expect(useAuditTrail).toHaveBeenLastCalledWith(
        'local',
        expect.objectContaining({ cursor: 'page-two' })
      )
    );
  });

  it('keeps filters visible and blocks paging while the next page loads', async () => {
    const { rerender } = render(<AuditExplorer />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(useAuditTrail).toHaveBeenLastCalledWith(
        'local',
        expect.objectContaining({ cursor: 'page-two' })
      )
    );

    (useAuditTrail as jest.Mock).mockReturnValue({
      data: response,
      error: undefined,
      isLoading: false,
      isFetching: true,
      isPlaceholderData: true,
      refetch,
    });
    rerender(<AuditExplorer />);

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Resource')).toBeInTheDocument();
    expect(screen.getByText('Loading page 2…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(useAuditTrail).toHaveBeenLastCalledWith(
      'local',
      expect.objectContaining({ cursor: 'page-two' })
    );
  });

  it('renders events that share timestamp, operator and operation', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation();
    (useAuditTrail as jest.Mock).mockReturnValue({
      data: { ...response, events: [response.events[0], response.events[0]] },
      error: undefined,
      isLoading: false,
      refetch,
    });

    render(<AuditExplorer />);

    expect(screen.getAllByText('operator@example.com')).toHaveLength(2);
    expect(
      consoleError.mock.calls.some((args) =>
        args.some((arg) => String(arg).includes('same key'))
      )
    ).toBe(false);
    consoleError.mockRestore();
  });

  it('shows the truthful unavailable state from the API', () => {
    (useAuditTrail as jest.Mock).mockReturnValue({
      data: {
        status: AuditTrailResponseStatusEnum.UNAVAILABLE,
        unavailableReason:
          'Audit topic recording is not enabled for this cluster.',
        events: [],
        truncated: false,
      },
      error: undefined,
      isLoading: false,
      refetch,
    });

    render(<AuditExplorer />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Audit evidence is unavailable'
    );
    expect(screen.getByText(/not enabled/i)).toBeInTheDocument();
  });
});
