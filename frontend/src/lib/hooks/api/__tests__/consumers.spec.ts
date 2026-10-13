import {
  getConsumerGroupLagPollingInterval,
  isRetryableConsumerGroupLagError,
  useResetConsumerGroupOffsetsMutation,
} from 'lib/hooks/api/consumers';
import { act, renderHook, waitFor } from '@testing-library/react';
import { TestQueryClientProvider } from 'lib/testHelpers';
import { consumerGroupsApiClient } from 'lib/api';
import { ConsumerGroupOffsetsResetType } from 'generated-sources';

describe('Cancellable offset reset', () => {
  it('aborts the HTTP request and does not report reset success', async () => {
    let signal: AbortSignal | null | undefined;
    const request = jest
      .spyOn(consumerGroupsApiClient, 'resetConsumerGroupOffsets')
      .mockImplementation((_params, init) => {
        signal = init?.signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Cancelled', 'AbortError'))
          );
        });
      });
    const { result } = renderHook(
      () =>
        useResetConsumerGroupOffsetsMutation({
          clusterName: 'cluster',
          consumerGroupID: 'group',
        }),
      { wrapper: TestQueryClientProvider }
    );
    let outcome: boolean | undefined;
    act(() => {
      result.current
        .mutateAsync({
          topic: 'topic',
          resetType: ConsumerGroupOffsetsResetType.EARLIEST,
          waitForInactive: true,
        })
        .then((completed) => {
          outcome = completed;
        });
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    act(() => result.current.cancel());
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(signal?.aborted).toBe(true);
    expect(outcome).toBe(false);
    request.mockRestore();
  });
});

describe('Consumer group lag polling', () => {
  it.each([
    [{ statusText: 'Network error' }, true],
    [{ status: 408, statusText: 'Request timeout' }, true],
    [{ status: 429, statusText: 'Too many requests' }, true],
    [{ status: 500, statusText: 'Server error' }, true],
    [{ status: 400, statusText: 'Bad request' }, false],
    [{ status: 403, statusText: 'Forbidden' }, false],
  ])('retries transient status %#', (error, expected) => {
    expect(isRetryableConsumerGroupLagError(error)).toBe(expected);
  });

  it('backs off polling after failures and caps the delay', () => {
    expect(getConsumerGroupLagPollingInterval(0, 0)).toBe(false);
    expect(getConsumerGroupLagPollingInterval(2, 0)).toBe(2_000);
    expect(getConsumerGroupLagPollingInterval(2, 1)).toBe(4_000);
    expect(getConsumerGroupLagPollingInterval(2, 4)).toBe(30_000);
  });
});
