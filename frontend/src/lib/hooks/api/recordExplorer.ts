import { useQuery } from '@tanstack/react-query';
import { RecordExplorerResponse } from 'generated-sources';
import { recordExplorerApiClient as api } from 'lib/api';
import { apiFetch, ServerResponse } from 'lib/errorHandling';
import { ClusterName } from 'lib/interfaces/cluster';

export interface RecordExplorerFilters {
  query: string;
  topic?: string;
  includeInternal: boolean;
  topicLimit: number;
  perTopicSampleLimit: number;
  resultLimit: number;
}

export function useRecordExplorer(
  clusterName: ClusterName,
  filters: RecordExplorerFilters | undefined
) {
  return useQuery<RecordExplorerResponse, ServerResponse>({
    queryKey: ['clusters', clusterName, 'recordExplorer', filters],
    queryFn: () =>
      apiFetch(() =>
        api.searchRecords({
          clusterName,
          query: filters?.query || '',
          topic: filters?.topic || undefined,
          includeInternal: filters?.includeInternal,
          topicLimit: filters?.topicLimit,
          perTopicSampleLimit: filters?.perTopicSampleLimit,
          resultLimit: filters?.resultLimit,
        })
      ),
    enabled: filters !== undefined,
    placeholderData: (previousData) => previousData,
    // Searches sample many topics; reuse results unless explicitly refreshed.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
