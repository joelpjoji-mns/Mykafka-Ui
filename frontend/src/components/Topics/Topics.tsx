import React, { Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import PageLoader from 'components/common/PageLoader/PageLoader';
import {
  clusterTopicCopyRelativePath,
  clusterTopicNewRelativePath,
  getNonExactPath,
  RouteParams,
} from 'lib/paths';
import SuspenseQueryComponent from 'components/common/SuspenseQueryComponent/SuspenseQueryComponent';

const loadNew = () => import('./New/New');
const loadListPage = () => import('./List/ListPage');
const loadTopic = () => import('./Topic/Topic');

const New = React.lazy(loadNew);
const ListPage = React.lazy(loadListPage);
const Topic = React.lazy(loadTopic);

export const preloadTopicsRoutes = () =>
  Promise.all([loadListPage(), loadTopic()]);

const Topics: React.FC = () => (
  <Suspense fallback={<PageLoader />}>
    <Routes>
      <Route index element={<ListPage />} />
      <Route path={clusterTopicNewRelativePath} element={<New />} />
      <Route path={clusterTopicCopyRelativePath} element={<New />} />
      <Route
        path={getNonExactPath(RouteParams.topicName)}
        element={
          <SuspenseQueryComponent>
            <Topic />
          </SuspenseQueryComponent>
        }
      />
    </Routes>
  </Suspense>
);

export default Topics;
