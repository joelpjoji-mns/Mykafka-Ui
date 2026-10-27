import {
  getConsumerGroupLagPollingInterval,
  isRetryableConsumerGroupLagError,
  useGetConsumerGroupsLag,
  useResetConsumerGroupOffsetsMutation,
} from 'lib/hooks/api/consumers';
import { act, renderHook, waitFor } from '@testing-library/react';
import { TestQueryClientProvider } from 'lib/testHelpers';
import { consumerGroupsApiClient } from 'lib/api';
import {
  ConsumerGroupOffsetsResetType,
  ConsumerGroupsLagResponse,
} from 'generated-sources';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type PropsWithChildren } from 'react';

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

describe('useGetConsumerGroupsLag', () => {
  const lagResponse = (
    updateTimestamp: number,
    consumerGroups: Record<string, { lag: number }>
  ) => ({ updateTimestamp, consumerGroups }) as ConsumerGroupsLagResponse;

  it('tracks lastUpdate per query key and keeps lag when nothing changed', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const request = jest
      .spyOn(consumerGroupsApiClient, 'getConsumerGroupsLag')
      .mockResolvedValueOnce(lagResponse(100, { group: { lag: 5 } }))
      .mockResolvedValueOnce(lagResponse(100, {}))
      .mockResolvedValueOnce(lagResponse(100, { group: { lag: 5 } }));

    const { result } = renderHook(
      () => useGetConsumerGroupsLag({ clusterName: 'cluster', ids: ['group'] }),
      { wrapper }
    );
    await waitFor(() =>
      expect(result.current.data?.consumerGroups.group?.lag).toBe(5)
    );
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({ lastUpdate: undefined })
    );

    await act(async () => {
      await result.current.refetch();
    });
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({ lastUpdate: 100 })
    );
    expect(result.current.data?.consumerGroups.group?.lag).toBe(5);

    const withPartitions = renderHook(
      () =>
        useGetConsumerGroupsLag({
          clusterName: 'cluster',
          ids: ['group'],
          includePartitions: true,
        }),
      { wrapper }
    );
    await waitFor(() =>
      expect(withPartitions.result.current.isSuccess).toBe(true)
    );
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        includePartitions: true,
        lastUpdate: undefined,
      })
    );
    request.mockRestore();
  });
});
