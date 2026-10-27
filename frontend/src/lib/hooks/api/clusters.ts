import { clustersApiClient as api } from 'lib/api';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { ClusterName } from 'lib/interfaces/cluster';
import { ServerStatus } from 'generated-sources';

export function useClusters(options: { waitForCluster?: ClusterName } = {}) {
  const { waitForCluster } = options;
  return useQuery({
    queryKey: ['clusters'],
    queryFn: () => api.getClusters(),
    refetchOnMount: waitForCluster ? 'always' : undefined,
    refetchInterval: waitForCluster
      ? (query) => {
          if (query.state.error) return 5_000;
          const cluster = query.state.data?.find(
            ({ name }) => name === waitForCluster
          );
          if (!cluster) return false;
          const status = cluster.connectionStatus ?? cluster.status;
          if (status === ServerStatus.INITIALIZING) return 1_000;
          if (status === ServerStatus.OFFLINE) return 5_000;
          return 15_000;
        }
      : false,
  });
}
export const clusterStatsQueryOptions = (clusterName: ClusterName) => ({
  queryKey: ['clusterStats', clusterName] as const,
  queryFn: () => api.getClusterStats({ clusterName }),
  staleTime: 30_000,
});

export function useClusterStats(clusterName: ClusterName) {
  return useSuspenseQuery({
    ...clusterStatsQueryOptions(clusterName),
    // The backend serves stats from a periodically refreshed cache.
    refetchInterval: 10_000,
  });
}
