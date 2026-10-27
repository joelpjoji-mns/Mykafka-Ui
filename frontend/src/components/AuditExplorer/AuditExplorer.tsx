import React from 'react';
import { Button } from 'components/common/Button/Button';
import ErrorPage from 'components/ErrorPage/ErrorPage';
import PageLoader from 'components/common/PageLoader/PageLoader';
import ResourcePageHeading from 'components/common/ResourcePageHeading/ResourcePageHeading';
import {
  AuditTrailEvent,
  AuditTrailEventOutcomeEnum,
  AuditTrailResource,
  AuditTrailResponseStatusEnum,
  GetAuditTrailOutcomeEnum,
} from 'generated-sources';
import useAppParams from 'lib/hooks/useAppParams';
import { useAuditTrail } from 'lib/hooks/api/audit';
import { uniqueKeys } from 'lib/utils/uniqueKeys';
import {
  clusterBrokerPath,
  clusterConsumerGroupDetailsPath,
  clusterTopicPath,
  ClusterNameRoute,
} from 'lib/paths';

import * as S from './AuditExplorer.styled';

const DEFAULT_LIMIT = 25;

type FilterState = {
  from: string;
  to: string;
  resource: string;
  operation: string;
  outcome: '' | GetAuditTrailOutcomeEnum;
};

const emptyFilters: FilterState = {
  from: '',
  to: '',
  resource: '',
  operation: '',
  outcome: '',
};

const toDate = (value: string) => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const resourcePath = (clusterName: string, resource: AuditTrailResource) => {
  if (!resource.resourceId) return undefined;
  if (resource.type === 'TOPIC') {
    return clusterTopicPath(clusterName, resource.resourceId);
  }
  if (resource.type === 'CONSUMER') {
    return clusterConsumerGroupDetailsPath(clusterName, resource.resourceId);
  }
  if (resource.type === 'BROKER' && /^\d+$/.test(resource.resourceId)) {
    return clusterBrokerPath(clusterName, Number(resource.resourceId));
  }
  return undefined;
};

const resourceLabel = (resource: AuditTrailResource) =>
  resource.resourceId
    ? `${resource.type}: ${resource.resourceId}`
    : resource.type;

const formatTimestamp = (timestamp: Date) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(timestamp);

const AuditResources: React.FC<{
  clusterName: string;
  resources: AuditTrailEvent['resources'];
}> = ({ clusterName, resources }) => {
  if (resources.length === 0) return <>No resource</>;

  return (
    <S.ResourceList>
      {resources.map((resource, index) => {
        const label = resourceLabel(resource);
        const path = resourcePath(clusterName, resource);
        return (
          <S.ResourceRow
            key={`${resource.type}-${resource.resourceId || index}`}
          >
            {path ? (
              <S.ResourceLink to={path}>{label}</S.ResourceLink>
            ) : (
              <S.ResourceName>{label}</S.ResourceName>
            )}
            {resource.accessType.length > 0 && (
              <S.Access>{resource.accessType.join(', ')}</S.Access>
            )}
          </S.ResourceRow>
        );
      })}
    </S.ResourceList>
  );
};

type PaginationState = {
  cursors: Array<string | undefined>;
  pageIndex: number;
};

const firstPage: PaginationState = { cursors: [undefined], pageIndex: 0 };

const AuditExplorer: React.FC = () => {
  const { clusterName } = useAppParams<ClusterNameRoute>();
  const [draft, setDraft] = React.useState<FilterState>(emptyFilters);
  const [filters, setFilters] = React.useState<FilterState>(emptyFilters);
  const [limit, setLimit] = React.useState(DEFAULT_LIMIT);
  const [{ cursors, pageIndex }, setPagination] =
    React.useState<PaginationState>(firstPage);
  const cursor = cursors[pageIndex];
  const { data, error, isLoading, isFetching, isPlaceholderData, refetch } =
    useAuditTrail(clusterName, {
      from: toDate(filters.from),
      to: toDate(filters.to),
      resource: filters.resource || undefined,
      operation: filters.operation || undefined,
      outcome: filters.outcome || undefined,
      cursor,
      limit,
    });
  // While a page loads, the previous page is still displayed; its cursor must not
  // be used to advance again.
  const isPageLoading = isFetching || isPlaceholderData;

  const applyFilters = () => {
    setFilters(draft);
    setPagination(firstPage);
  };

  const clearFilters = () => {
    setDraft(emptyFilters);
    setFilters(emptyFilters);
    setPagination(firstPage);
  };

  const changeLimit = (value: number) => {
    setLimit(value);
    setPagination(firstPage);
  };

  const nextPage = () => {
    const nextCursor = data?.nextCursor;
    if (!nextCursor || isPageLoading) return;
    setPagination((current) => ({
      cursors: [...current.cursors.slice(0, current.pageIndex + 1), nextCursor],
      pageIndex: current.pageIndex + 1,
    }));
  };

  const previousPage = () => {
    if (isPageLoading) return;
    setPagination((current) => ({
      ...current,
      pageIndex: Math.max(0, current.pageIndex - 1),
    }));
  };

  if (isLoading) {
    return <PageLoader offsetY={260} />;
  }

  if (!data) {
    return (
      <ErrorPage
        text={
          error?.message || 'Audit evidence is unavailable for this cluster.'
        }
        onClick={() => refetch()}
      />
    );
  }

  const isUnavailable =
    data.status === AuditTrailResponseStatusEnum.UNAVAILABLE;
  const eventRowKeys = uniqueKeys(
    data.events.map(
      (event) =>
        `${event.timestamp.toISOString()}-${event.operator}-${event.operation}`
    )
  );

  return (
    <>
      <ResourcePageHeading text="Audit Explorer">
        <Button buttonType="secondary" buttonSize="M" onClick={() => refetch()}>
          Refresh
        </Button>
      </ResourcePageHeading>
      <S.Page>
        <S.Controls aria-label="Audit filters">
          <S.FilterLabel>
            <span>From</span>
            <S.FilterInput
              aria-label="From"
              type="datetime-local"
              value={draft.from}
              onChange={({ target }) =>
                setDraft({ ...draft, from: target.value })
              }
            />
          </S.FilterLabel>
          <S.FilterLabel>
            <span>To</span>
            <S.FilterInput
              aria-label="To"
              type="datetime-local"
              value={draft.to}
              onChange={({ target }) =>
                setDraft({ ...draft, to: target.value })
              }
            />
          </S.FilterLabel>
          <S.FilterLabel>
            <span>Resource</span>
            <S.FilterInput
              aria-label="Resource"
              placeholder="Type or identifier"
              value={draft.resource}
              onChange={({ target }) =>
                setDraft({ ...draft, resource: target.value })
              }
            />
          </S.FilterLabel>
          <S.FilterLabel>
            <span>Operation</span>
            <S.FilterInput
              aria-label="Operation"
              placeholder="e.g. deleteTopic"
              value={draft.operation}
              onChange={({ target }) =>
                setDraft({ ...draft, operation: target.value })
              }
            />
          </S.FilterLabel>
          <S.FilterLabel>
            <span>Outcome</span>
            <S.FilterSelect
              aria-label="Outcome"
              value={draft.outcome}
              onChange={({ target }) =>
                setDraft({
                  ...draft,
                  outcome: target.value as FilterState['outcome'],
                })
              }
            >
              <option value="">All outcomes</option>
              <option value={GetAuditTrailOutcomeEnum.SUCCESS}>Success</option>
              <option value={GetAuditTrailOutcomeEnum.FAILURE}>Failure</option>
            </S.FilterSelect>
          </S.FilterLabel>
          <S.FilterLabel>
            <span>Rows per page</span>
            <S.FilterSelect
              aria-label="Rows per page"
              value={limit}
              onChange={({ target }) => changeLimit(Number(target.value))}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </S.FilterSelect>
          </S.FilterLabel>
          <S.Actions>
            <Button buttonType="primary" buttonSize="M" onClick={applyFilters}>
              Apply filters
            </Button>
            <Button
              buttonType="secondary"
              buttonSize="M"
              onClick={clearFilters}
            >
              Clear
            </Button>
          </S.Actions>
        </S.Controls>

        {isUnavailable ? (
          <S.Unavailable role="status">
            <h2>Audit evidence is unavailable</h2>
            <p>{data.unavailableReason}</p>
          </S.Unavailable>
        ) : (
          <>
            {data.truncated && (
              <S.Notice role="status">
                The explorer searched a bounded recent audit window. Older
                matching evidence may not be included.
              </S.Notice>
            )}
            <S.Evidence
              aria-labelledby="audit-evidence-heading"
              aria-busy={isPageLoading}
            >
              <S.EvidenceHeader>
                <S.EvidenceTitle id="audit-evidence-heading">
                  Change evidence
                </S.EvidenceTitle>
                <S.PageState aria-live="polite">
                  {isPageLoading
                    ? `Loading page ${pageIndex + 1}…`
                    : `Page ${pageIndex + 1}`}
                </S.PageState>
              </S.EvidenceHeader>
              <S.TableViewport>
                {data.events.length === 0 ? (
                  <S.Empty>
                    No audit evidence matched the active filters.
                  </S.Empty>
                ) : (
                  <S.Table>
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Operator</th>
                        <th>Resource</th>
                        <th>Operation</th>
                        <th>Outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.events.map((event, index) => (
                        <tr key={eventRowKeys[index]}>
                          <td>{formatTimestamp(event.timestamp)}</td>
                          <td>{event.operator}</td>
                          <td>
                            <AuditResources
                              clusterName={clusterName}
                              resources={event.resources}
                            />
                          </td>
                          <td>{event.operation}</td>
                          <td>
                            <S.Outcome
                              $failed={
                                event.outcome ===
                                AuditTrailEventOutcomeEnum.FAILURE
                              }
                            >
                              {event.outcome}
                              {event.error ? ` (${event.error})` : ''}
                            </S.Outcome>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </S.Table>
                )}
              </S.TableViewport>
              <S.Pagination>
                <Button
                  buttonType="secondary"
                  buttonSize="M"
                  disabled={pageIndex === 0 || isPageLoading}
                  onClick={previousPage}
                >
                  Previous
                </Button>
                <Button
                  buttonType="secondary"
                  buttonSize="M"
                  disabled={!data.nextCursor || isPageLoading}
                  onClick={nextPage}
                >
                  Next
                </Button>
              </S.Pagination>
            </S.Evidence>
          </>
        )}
      </S.Page>
    </>
  );
};

export default AuditExplorer;
