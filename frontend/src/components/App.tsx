import React, { Suspense, useContext } from 'react';
import { Routes, Route, Navigate, useMatch } from 'react-router-dom';
import {
  accessErrorPage,
  clusterPath,
  errorPage,
  getNonExactPath,
  clusterNewConfigPath,
} from 'lib/paths';
import PageLoader from 'components/common/PageLoader/PageLoader';
import { ThemeProvider } from 'styled-components';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { showServerError } from 'lib/errorHandling';
import { Toaster } from 'react-hot-toast';
import GlobalCSS from 'components/globalCss';
import * as S from 'components/App.styled';
import { ThemeModeContext } from 'components/contexts/ThemeModeContext';
import { scheduleIdleTask } from 'lib/utils/scheduleIdleTask';

import ConfirmationModal from './common/ConfirmationModal/ConfirmationModal';
import { ConfirmContextProvider } from './contexts/ConfirmContext';
import { GlobalSettingsProvider } from './contexts/GlobalSettingsContext';
import { UserInfoRolesAccessProvider } from './contexts/UserInfoRolesAccessContext';
import PageContainer from './PageContainer/PageContainer';

const loadAuthPage = () => import('components/AuthPage/AuthPage');
const loadDashboard = () => import('components/Dashboard/Dashboard');
const loadClusterPage = () => import('components/ClusterPage/ClusterPage');
const AuthPage = React.lazy(loadAuthPage);
const Dashboard = React.lazy(loadDashboard);
const ClusterPage = React.lazy(loadClusterPage);
const ClusterConfigForm = React.lazy(() => import('widgets/ClusterConfigForm'));
const ErrorPage = React.lazy(() => import('components/ErrorPage/ErrorPage'));
const ReactQueryDevtools = React.lazy(() =>
  import('@tanstack/react-query-devtools').then(
    ({ ReactQueryDevtools: Devtools }) => ({
      default: Devtools,
    })
  )
);

const queryCache = new QueryCache({
  onError: (error) => {
    showServerError(error as unknown as Response);
  },
});

const mutationCache = new MutationCache({
  onError: (error) => {
    showServerError(error as unknown as Response);
  },
});

const queryClient = new QueryClient({
  queryCache,
  mutationCache,
  defaultOptions: {
    queries: {
      networkMode: 'offlineFirst',
      staleTime: 30_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
      retryDelay: 500,
    },
  },
});
const App: React.FC = () => {
  const { activeTheme } = useContext(ThemeModeContext);
  const isAuthRoute = useMatch('/login');

  React.useEffect(() => {
    if (isAuthRoute) return undefined;

    return scheduleIdleTask(() => {
      Promise.all([loadDashboard(), loadClusterPage()]).catch(showServerError);
    });
  }, [isAuthRoute]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={activeTheme}>
        {isAuthRoute ? (
          <AuthPage />
        ) : (
          <GlobalSettingsProvider>
            <Suspense fallback={<PageLoader fullSize />}>
              <UserInfoRolesAccessProvider>
                <ConfirmContextProvider>
                  <GlobalCSS />
                  <S.Layout>
                    <PageContainer>
                      <Routes>
                        {['/', '/ui', '/ui/clusters'].map((path) => (
                          <Route
                            key="Home" // optional: avoid full re-renders on route changes
                            path={path}
                            element={<Dashboard />}
                          />
                        ))}
                        <Route
                          path={getNonExactPath(clusterNewConfigPath)}
                          element={<ClusterConfigForm />}
                        />
                        <Route
                          path={getNonExactPath(clusterPath())}
                          element={<ClusterPage />}
                        />
                        <Route
                          path={accessErrorPage}
                          element={
                            <ErrorPage status={403} text="Access is Denied" />
                          }
                        />
                        <Route path={errorPage} element={<ErrorPage />} />
                        <Route
                          path="*"
                          element={<Navigate to={errorPage} replace />}
                        />
                      </Routes>
                    </PageContainer>
                    <Toaster position="bottom-right" />
                  </S.Layout>
                  <ConfirmationModal />
                </ConfirmContextProvider>
              </UserInfoRolesAccessProvider>
            </Suspense>
          </GlobalSettingsProvider>
        )}
      </ThemeProvider>
      {process.env.NODE_ENV !== 'production' && (
        <Suspense fallback={null}>
          <ReactQueryDevtools
            initialIsOpen={false}
            buttonPosition="bottom-right"
          />
        </Suspense>
      )}
    </QueryClientProvider>
  );
};

export default App;
