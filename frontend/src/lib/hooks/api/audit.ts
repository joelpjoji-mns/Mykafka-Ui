import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { GetAuditTrailOutcomeEnum } from 'generated-sources';
import { auditApiClient as api } from 'lib/api';
import { ClusterName } from 'lib/interfaces/cluster';

export interface AuditTrailFilters {
  from?: Date;
  to?: Date;
  resource?: string;
  operation?: string;
  outcome?: GetAuditTrailOutcomeEnum;
  cursor?: string;
  limit: number;
}

export function useAuditTrail(
  clusterName: ClusterName,
  filters: AuditTrailFilters
) {
  return useQuery({
    queryKey: [
      'clusters',
      clusterName,
      'audit',
      filters.from?.toISOString(),
      filters.to?.toISOString(),
      filters.resource,
      filters.operation,
      filters.outcome,
      filters.cursor,
      filters.limit,
    ],
    queryFn: () => api.getAuditTrail({ clusterName, ...filters }),
    placeholderData: keepPreviousData,
  });
}
