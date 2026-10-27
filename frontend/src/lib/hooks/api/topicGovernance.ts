import { useQuery } from '@tanstack/react-query';
import { topicGovernanceApiClient as api } from 'lib/api';
import { ClusterName } from 'lib/interfaces/cluster';

export function useTopicGovernance(
  clusterName: ClusterName,
  includeInternal: boolean
) {
  return useQuery({
    queryKey: ['clusters', clusterName, 'topic-governance', includeInternal],
    queryFn: () =>
      api.getTopicGovernanceReport({
        clusterName,
        includeInternal,
      }),
    refetchInterval: 30_000,
    staleTime: 25_000,
  });
}
