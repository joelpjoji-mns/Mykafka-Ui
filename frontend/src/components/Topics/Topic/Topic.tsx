import React, { Suspense } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import {
  clusterTopicAclsRelativePath,
  clusterTopicConnectorsRelativePath,
  clusterTopicConsumerGroupsRelativePath,
  clusterTopicDataProfileRelativePath,
  clusterTopicDeveloperRelativePath,
  clusterTopicDownloadRelativePath,
  clusterTopicEditRelativePath,
  clusterTopicMessagesRelativePath,
  clusterTopicSearchRelativePath,
  clusterTopicPath,
  clusterTopicSettingsRelativePath,
  clusterTopicsPath,
  clusterTopicStatisticsRelativePath,
  clusterTopicUploadRelativePath,
  RouteParamsClusterTopic,
} from 'lib/paths';
import { getTopicPageTitle } from 'lib/pageTitles';
import ClusterContext from 'components/contexts/ClusterContext';
import {
  ActionButton,
  ActionNavLink,
  ActionDropdownItem,
} from 'components/common/ActionComponent';
import Navbar from 'components/common/Navigation/Navbar.styled';
import useAppParams from 'lib/hooks/useAppParams';
import { Dropdown, DropdownItemHint } from 'components/common/Dropdown';
import {
  useClearTopicMessages,
  useDeleteTopic,
  useRecreateTopic,
  useTopicDetails,
} from 'lib/hooks/api/topics';
import {
  Action,
  CleanUpPolicy,
  PollingMode,
  ResourceType,
  SerdeUsage,
  TopicMessage,
} from 'generated-sources';
import { MessagesFilterKeys } from 'lib/constants';
import { serdesQueryOptions } from 'lib/hooks/api/topicMessages';
import { scheduleIdleTask } from 'lib/utils/scheduleIdleTask';
import PageLoader from 'components/common/PageLoader/PageLoader';
import SlidingSidebar from 'components/common/SlidingSidebar';
import useBoolean from 'lib/hooks/useBoolean';
import { useProduceMessage } from 'lib/hooks/useProduceMessage';
import ResourcePageHeading from 'components/common/ResourcePageHeading/ResourcePageHeading';
import { TopicActionsProvider } from 'components/contexts/TopicActionsContext';
import { showServerError } from 'lib/errorHandling';

const loadErrorPage = () => import('components/ErrorPage/ErrorPage');
const loadMessages = () => import('./Messages/Messages');
const loadOverview = () => import('./Overview/Overview');
const loadSettings = () => import('./Settings/Settings');
const loadTopicConsumerGroups = () =>
  import('./ConsumerGroups/TopicConsumerGroups');
const loadStatistics = () => import('./Statistics/Statistics');
const loadEdit = () => import('./Edit/Edit');
const loadConnectors = () => import('./Connectors/Connectors');
const loadSendMessage = () => import('./SendMessage/SendMessage');
const loadAcls = () => import('./Acls/Acls');
const loadDownload = () => import('./Download/Download');
const loadUpload = () => import('./Upload/Upload');
const loadDataProfile = () => import('./DataProfile/DataProfile');
const loadDeveloperHub = () => import('./DeveloperHub/DeveloperHub');

const ErrorPage = React.lazy(loadErrorPage);
const Messages = React.lazy(loadMessages);
const Overview = React.lazy(loadOverview);
const Settings = React.lazy(loadSettings);
const TopicConsumerGroups = React.lazy(loadTopicConsumerGroups);
const Statistics = React.lazy(loadStatistics);
const Edit = React.lazy(loadEdit);
const Connectors = React.lazy(loadConnectors);
const SendMessage = React.lazy(loadSendMessage);
const Acls = React.lazy(loadAcls);
const Download = React.lazy(loadDownload);
const Upload = React.lazy(loadUpload);
const DataProfile = React.lazy(loadDataProfile);
const DeveloperHub = React.lazy(loadDeveloperHub);

const Topic: React.FC = () => {
  const {
    value: isSidebarOpen,
    setFalse: closeSidebar,
    setTrue: openSidebar,
  } = useBoolean(false);

  const { messageData, setMessage, clearMessage } = useProduceMessage();

  const { clusterName, topicName } = useAppParams<RouteParamsClusterTopic>();
  const queryClient = useQueryClient();
  const { pathname, search } = useLocation();
  const [searchParams] = useSearchParams();
  const topicPath = clusterTopicPath(clusterName, topicName);
  const normalizedPathname = pathname.replace(/\/+$/, '');
  const isMessagesRoute =
    normalizedPathname === `${topicPath}/${clusterTopicMessagesRelativePath}`;
  const isSearchRoute =
    normalizedPathname === `${topicPath}/${clusterTopicSearchRelativePath}`;
  const topicIdentity = `${clusterName}/${topicName}`;
  const [messagesMountedForTopic, setMessagesMountedForTopic] = React.useState(
    isMessagesRoute ? topicIdentity : ''
  );
  React.useEffect(() => {
    if (isMessagesRoute) setMessagesMountedForTopic(topicIdentity);
  }, [isMessagesRoute, topicIdentity]);
  const hasVisitedMessages = messagesMountedForTopic === topicIdentity;
  const messageMode = searchParams.get(MessagesFilterKeys.mode);
  const isFiniteMessageView =
    searchParams.has('orderBy') ||
    (!!messageMode && messageMode !== PollingMode.TAILING);
  const keepSortedScanAlive =
    hasVisitedMessages &&
    isFiniteMessageView &&
    !isMessagesRoute &&
    !isSearchRoute;

  const openSidebarWithMessage = (message: TopicMessage) => {
    setMessage(message);
    openSidebar();
  };

  const handleCloseSidebar = () => {
    clearMessage();
    closeSidebar();
  };

  const navigate = useNavigate();
  const deleteTopic = useDeleteTopic(clusterName);
  const recreateTopic = useRecreateTopic({ clusterName, topicName });
  const { data, error, refetch, isLoading } = useTopicDetails(
    { clusterName, topicName },
    { retry: false }
  );

  const { isReadOnly, isTopicDeletionAllowed, hasKafkaConnectConfigured } =
    React.useContext(ClusterContext);

  const deleteTopicHandler = async () => {
    await deleteTopic.mutateAsync(topicName);
    navigate(clusterTopicsPath(clusterName));
  };

  const clearMessages = useClearTopicMessages(clusterName);
  const clearTopicMessagesHandler = async () => {
    await clearMessages.mutateAsync(topicName);
  };
  const withSearch = (path: string) => `${path}${search}`;
  const canCleanup = data?.cleanUpPolicy === CleanUpPolicy.DELETE;
  const isConnectorsAvailable = hasKafkaConnectConfigured;

  React.useEffect(() => {
    if (!data) return undefined;

    return scheduleIdleTask(() => {
      const tabModules: Array<() => Promise<unknown>> = [
        loadOverview,
        loadMessages,
        loadSettings,
        loadTopicConsumerGroups,
        loadStatistics,
        loadEdit,
        loadAcls,
        loadDownload,
        loadUpload,
        loadDataProfile,
        loadDeveloperHub,
        loadSendMessage,
      ];
      if (isConnectorsAvailable) tabModules.push(loadConnectors);

      Promise.all([
        Promise.all(tabModules.map((loadModule) => loadModule())),
        queryClient.prefetchQuery(
          serdesQueryOptions({
            clusterName,
            topicName,
            use: SerdeUsage.DESERIALIZE,
          })
        ),
        queryClient.prefetchQuery(
          serdesQueryOptions({
            clusterName,
            topicName,
            use: SerdeUsage.SERIALIZE,
          })
        ),
      ]).catch(showServerError);
    });
  }, [
    clusterName,
    data !== undefined,
    isConnectorsAvailable,
    queryClient,
    topicName,
  ]);

  return (
    <>
      <ResourcePageHeading
        text={topicName}
        backText="Topics"
        backTo={clusterTopicsPath(clusterName)}
        documentTitle={getTopicPageTitle(pathname, clusterName, topicName)}
      >
        <ActionButton
          buttonSize="M"
          buttonType="primary"
          onClick={openSidebar}
          disabled={isReadOnly}
          permission={{
            resource: ResourceType.TOPIC,
            action: Action.MESSAGES_PRODUCE,
            value: topicName,
          }}
        >
          Produce Message
        </ActionButton>
        <Dropdown disabled={isReadOnly || data?.internal}>
          <ActionDropdownItem
            onClick={() => navigate(clusterTopicEditRelativePath)}
            permission={{
              resource: ResourceType.TOPIC,
              action: Action.EDIT,
              value: topicName,
            }}
          >
            Edit settings
            <DropdownItemHint>
              Pay attention! This operation has
              <br />
              especially important consequences.
            </DropdownItemHint>
          </ActionDropdownItem>

          <ActionDropdownItem
            onClick={clearTopicMessagesHandler}
            confirm="Are you sure want to clear topic messages?"
            disabled={!canCleanup}
            danger
            permission={{
              resource: ResourceType.TOPIC,
              action: Action.MESSAGES_DELETE,
              value: topicName,
            }}
          >
            Clear messages
            <DropdownItemHint>
              Clearing messages is only allowed for topics
              <br />
              with DELETE policy
            </DropdownItemHint>
          </ActionDropdownItem>

          <ActionDropdownItem
            onClick={recreateTopic.mutateAsync}
            confirm={
              <>
                Are you sure want to recreate <b>{topicName}</b> topic?
              </>
            }
            danger
            permission={{
              resource: ResourceType.TOPIC,
              action: [Action.MESSAGES_READ, Action.CREATE, Action.DELETE],
              value: topicName,
            }}
          >
            Recreate Topic
          </ActionDropdownItem>
          <ActionDropdownItem
            onClick={deleteTopicHandler}
            confirm={
              <>
                Are you sure want to remove <b>{topicName}</b> topic?
              </>
            }
            disabled={!isTopicDeletionAllowed}
            danger
            permission={{
              resource: ResourceType.TOPIC,
              action: Action.DELETE,
              value: topicName,
            }}
          >
            Remove Topic
            {!isTopicDeletionAllowed && (
              <DropdownItemHint>
                The topic deletion is restricted at the broker
                <br />
                configuration level (delete.topic.enable = false)
              </DropdownItemHint>
            )}
          </ActionDropdownItem>
        </Dropdown>
      </ResourcePageHeading>

      {isLoading && !data && <PageLoader />}

      {error && !data && (
        <Suspense fallback={<PageLoader />}>
          <ErrorPage
            status={error.status}
            onClick={refetch}
            resourceName={topicName}
          />
        </Suspense>
      )}

      {data && (
        <>
          <Navbar role="navigation">
            <NavLink
              to={withSearch(topicPath)}
              className={({ isActive }) => (isActive ? 'is-active' : '')}
              end
            >
              Overview
            </NavLink>
            <ActionNavLink
              to={withSearch(
                `${topicPath}/${clusterTopicMessagesRelativePath}`
              )}
              className={({ isActive }) => (isActive ? 'is-active' : '')}
              permission={{
                resource: ResourceType.TOPIC,
                action: Action.MESSAGES_READ,
                value: topicName,
              }}
            >
              Messages
            </ActionNavLink>
            <ActionNavLink
              to={withSearch(`${topicPath}/${clusterTopicSearchRelativePath}`)}
              className={({ isActive }) => (isActive ? 'is-active' : '')}
              permission={{
                resource: ResourceType.TOPIC,
                action: Action.MESSAGES_READ,
                value: topicName,
              }}
            >
              Search
            </ActionNavLink>
            <ActionNavLink
              to={withSearch(
                `${topicPath}/${clusterTopicDownloadRelativePath}`
              )}
              className={({ isActive }) => (isActive ? 'is-active' : '')}
              permission={{
                resource: ResourceType.TOPIC,
                action: Action.MESSAGES_READ,
                value: topicName,
              }}
            >
              Download
            </ActionNavLink>
            <ActionNavLink
              to={withSearch(`${topicPath}/${clusterTopicUploadRelativePath}`)}
              className={({ isActive }) => (isActive ? 'is-active' : '')}
              permission={{
                resource: ResourceType.TOPIC,
                action: Action.MESSAGES_PRODUCE,
                value: topicName,
              }}
            >
              Upload
            </ActionNavLink>
            <NavLink
              to={withSearch(
                `${topicPath}/${clusterTopicConsumerGroupsRelativePath}`
              )}
              className={({ isActive }) => (isActive ? 'is-active' : '')}
            >
              Consumers
            </NavLink>
            <NavLink
              to={withSearch(
                `${topicPath}/${clusterTopicSettingsRelativePath}`
              )}
              className={({ isActive }) => (isActive ? 'is-active' : '')}
            >
              Settings
            </NavLink>
            <ActionNavLink
              to={withSearch(
                `${topicPath}/${clusterTopicStatisticsRelativePath}`
              )}
              className={({ isActive }) => (isActive ? 'is-active' : '')}
              permission={{
                resource: ResourceType.TOPIC,
                action: Action.ANALYSIS_VIEW,
                value: topicName,
              }}
            >
              Statistics
            </ActionNavLink>
            <ActionNavLink
              to={withSearch(
                `${topicPath}/${clusterTopicDataProfileRelativePath}`
              )}
              className={({ isActive }) => (isActive ? 'is-active' : '')}
              permission={{
                resource: ResourceType.TOPIC,
                action: Action.MESSAGES_READ,
                value: topicName,
              }}
            >
              Profile
            </ActionNavLink>
            <ActionNavLink
              to={withSearch(
                `${topicPath}/${clusterTopicDeveloperRelativePath}`
              )}
              className={({ isActive }) => (isActive ? 'is-active' : '')}
              permission={{
                resource: ResourceType.TOPIC,
                action: Action.VIEW,
                value: topicName,
              }}
            >
              Developer
            </ActionNavLink>
            <ActionNavLink
              to={withSearch(`${topicPath}/${clusterTopicAclsRelativePath}`)}
              className={({ isActive }) => (isActive ? 'is-active' : '')}
              permission={{
                resource: ResourceType.ACL,
                action: Action.VIEW,
              }}
            >
              ACLs
            </ActionNavLink>
            {isConnectorsAvailable && (
              <ActionNavLink
                to={withSearch(
                  `${topicPath}/${clusterTopicConnectorsRelativePath}`
                )}
                className={({ isActive }) => (isActive ? 'is-active' : '')}
                permission={{
                  resource: ResourceType.TOPIC,
                  action: Action.VIEW,
                  value: topicName,
                }}
              >
                Connectors
              </ActionNavLink>
            )}
          </Navbar>
          <TopicActionsProvider openSidebarWithMessage={openSidebarWithMessage}>
            <Suspense fallback={null}>
              {hasVisitedMessages && (
                <div hidden={!isMessagesRoute} aria-hidden={!isMessagesRoute}>
                  <Messages enabled={isMessagesRoute || keepSortedScanAlive} />
                </div>
              )}
            </Suspense>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route index element={<Overview />} />
                <Route
                  path={clusterTopicDownloadRelativePath}
                  element={<Download />}
                />
                <Route
                  path={clusterTopicSearchRelativePath}
                  element={<Messages searchPage />}
                />
                <Route
                  path={clusterTopicUploadRelativePath}
                  element={<Upload />}
                />
                <Route
                  path={clusterTopicSettingsRelativePath}
                  element={<Settings />}
                />
                <Route
                  path={clusterTopicConsumerGroupsRelativePath}
                  element={<TopicConsumerGroups />}
                />
                <Route
                  path={clusterTopicStatisticsRelativePath}
                  element={<Statistics />}
                />
                <Route
                  path={clusterTopicDataProfileRelativePath}
                  element={<DataProfile />}
                />
                <Route
                  path={clusterTopicDeveloperRelativePath}
                  element={<DeveloperHub />}
                />
                <Route path={clusterTopicAclsRelativePath} element={<Acls />} />
                {isConnectorsAvailable && (
                  <Route
                    path={clusterTopicConnectorsRelativePath}
                    element={<Connectors />}
                  />
                )}
                <Route path={clusterTopicEditRelativePath} element={<Edit />} />
              </Routes>
            </Suspense>
          </TopicActionsProvider>
        </>
      )}
      <SlidingSidebar
        open={isSidebarOpen}
        onClose={handleCloseSidebar}
        title="Produce Message"
      >
        <Suspense fallback={<PageLoader />}>
          <SendMessage
            key={messageData ? 'with-message' : 'empty'}
            closeSidebar={closeSidebar}
            messageData={messageData}
          />
        </Suspense>
      </SlidingSidebar>
    </>
  );
};

export default Topic;
