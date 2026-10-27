import { operationsCenterApiClient as api } from 'lib/api';
import { useQuery } from '@tanstack/react-query';
import { ClusterName } from 'lib/interfaces/cluster';

export function useOperationsCenter(
  clusterName: ClusterName,
  includeInternal: boolean,
  limit: number
) {
  return useQuery({
    queryKey: ['clusters', clusterName, 'operations', includeInternal, limit],
    queryFn: () =>
      api.getOperationsCenter({
        clusterName,
        includeInternal,
        limit,
      }),
    refetchInterval: 30_000,
    staleTime: 25_000,
  });
}
