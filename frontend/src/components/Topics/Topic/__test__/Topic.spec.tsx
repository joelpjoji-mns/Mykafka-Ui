import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClusterContext from 'components/contexts/ClusterContext';
import Details from 'components/Topics/Topic/Topic';
import { render, WithRoute } from 'lib/testHelpers';
import {
  clusterTopicConsumerGroupsPath,
  clusterTopicDataProfilePath,
  clusterTopicDeveloperPath,
  clusterTopicEditRelativePath,
  clusterTopicMessagesPath,
  clusterTopicPath,
  clusterTopicSettingsPath,
  clusterTopicsPath,
  clusterTopicStatisticsPath,
  getNonExactPath,
} from 'lib/paths';
import { CleanUpPolicy, Topic } from 'generated-sources';
import { externalTopicPayload } from 'lib/fixtures/topics';
import {
  useClearTopicMessages,
  useDeleteTopic,
  useRecreateTopic,
  useTopicDetails,
  useTopicConnectors,
} from 'lib/hooks/api/topics';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));
jest.mock('lib/hooks/api/topics', () => ({
  useTopicDetails: jest.fn(),
  useDeleteTopic: jest.fn(),
  useRecreateTopic: jest.fn(),
  useClearTopicMessages: jest.fn(),
  useTopicConnectors: jest.fn(),
}));

const clearTopicMessages = jest.fn();

jest.mock('components/Topics/Topic/Overview/Overview', () => () => (
  <>OverviewMock</>
));
jest.mock('components/Topics/Topic/Messages/Messages', () => () => (
  <>MessagesMock</>
));
jest.mock('components/Topics/Topic/SendMessage/SendMessage', () => () => (
  <>SendMessageMock</>
));
jest.mock('components/Topics/Topic/Settings/Settings', () => () => (
  <>SettingsMock</>
));
jest.mock(
  'components/Topics/Topic/ConsumerGroups/TopicConsumerGroups',
  () => () => <>ConsumerGroupsMock</>
);
jest.mock('components/Topics/Topic/Statistics/Statistics', () => () => (
  <>StatisticsMock</>
));
jest.mock('components/Topics/Topic/DataProfile/DataProfile', () => () => (
  <>DataProfileMock</>
));
jest.mock('components/Topics/Topic/DeveloperHub/DeveloperHub', () => () => (
  <>DeveloperHubMock</>
));

const mockDelete = jest.fn();
const mockRecreate = jest.fn();
const mockClusterName = 'local';
const topic: Topic = {
  ...externalTopicPayload,
  cleanUpPolicy: CleanUpPolicy.DELETE,
};
const defaultPath = clusterTopicPath(mockClusterName, topic.name);

describe('Details', () => {
  const renderComponent = (isReadOnly = false, path = defaultPath) => {
    render(
      <ClusterContext.Provider
        value={{
          isReadOnly,
          hasKafkaConnectConfigured: true,
          hasSchemaRegistryConfigured: true,
          isTopicDeletionAllowed: true,
          ftsEnabled: false,
          ftsDefaultEnabled: false,
        }}
      >
        <WithRoute path={getNonExactPath(clusterTopicPath())}>
          <Details />
        </WithRoute>
      </ClusterContext.Provider>,
      { initialEntries: [path] }
    );
  };

  beforeEach(async () => {
    (useTopicDetails as jest.Mock).mockImplementation(() => ({
      data: topic,
      isSuccess: true,
    }));
    (useDeleteTopic as jest.Mock).mockImplementation(() => ({
      mutateAsync: mockDelete,
    }));
    (useRecreateTopic as jest.Mock).mockImplementation(() => ({
      mutateAsync: mockRecreate,
    }));
    (useClearTopicMessages as jest.Mock).mockImplementation(() => ({
      mutateAsync: clearTopicMessages,
    }));
    (useTopicConnectors as jest.Mock).mockImplementation(() => ({
      data: [],
      isSuccess: true,
    }));
  });
  describe('Action Bar', () => {
    describe('when it has readonly flag', () => {
      it('renders disabled the Action button', () => {
        renderComponent(true);
        expect(
          screen.getByRole('button', { name: 'Produce Message' })
        ).toBeDisabled();
      });
    });

    describe('when remove topic modal is open', () => {
      beforeEach(async () => {
        renderComponent();
        const openModalButton = screen.getAllByText('Remove Topic')[0];
        await userEvent.click(openModalButton);
      });

      it('calls deleteTopic on confirm', async () => {
        const submitButton = screen.getAllByRole('button', {
          name: 'Confirm',
        })[0];
        await userEvent.click(submitButton);
        expect(mockDelete).toHaveBeenCalledWith(topic.name);
      });
      it('closes the modal when cancel button is clicked', async () => {
        const cancelButton = screen.getAllByText('Cancel')[0];
        await waitFor(() => userEvent.click(cancelButton));
        expect(cancelButton).not.toBeInTheDocument();
      });
    });

    describe('when clear messages modal is open', () => {
      beforeEach(async () => {
        renderComponent();
        const confirmButton = screen.getAllByText('Clear messages')[0];
        await userEvent.click(confirmButton);
      });

      it('it calls clearTopicMessages on confirm', async () => {
        const submitButton = screen.getAllByRole('button', {
          name: 'Confirm',
        })[0];
        await waitFor(() => userEvent.click(submitButton));
        expect(clearTopicMessages).toHaveBeenCalledTimes(1);
      });

      it('closes the modal when cancel button is clicked', async () => {
        const cancelButton = screen.getAllByText('Cancel')[0];
        await waitFor(() => userEvent.click(cancelButton));

        expect(cancelButton).not.toBeInTheDocument();
      });
    });

    describe('when edit settings is clicked', () => {
      it('redirects to the edit page', async () => {
        renderComponent();
        const button = screen.getAllByText('Edit settings')[0];
        await userEvent.click(button);
        expect(mockNavigate).toHaveBeenCalledWith(clusterTopicEditRelativePath);
      });
    });

    it('redirects to the correct route if topic is deleted', async () => {
      renderComponent();
      const deleteTopicButton = screen.getByText(/Remove topic/i);
      await waitFor(() => userEvent.click(deleteTopicButton));
      const submitDeleteButton = screen.getByRole('button', {
        name: 'Confirm',
      });
      await userEvent.click(submitDeleteButton);
      expect(mockNavigate).toHaveBeenCalledWith(
        clusterTopicsPath(mockClusterName)
      );
    });

    it('shows a confirmation popup on deleting topic messages', async () => {
      renderComponent();
      const clearMessagesButton = screen.getAllByText(/Clear messages/i)[0];
      await userEvent.click(clearMessagesButton);

      expect(
        screen.getByText(/Are you sure want to clear topic messages?/i)
      ).toBeInTheDocument();
    });

    it('shows a confirmation popup on recreating topic', async () => {
      renderComponent();
      const recreateTopicButton = screen.getByText(/Recreate topic/i);
      await userEvent.click(recreateTopicButton);
      expect(
        screen.getByText(/Are you sure want to recreate topic?/i)
      ).toBeInTheDocument();
    });

    it('is calling recreation function after click on Submit button', async () => {
      renderComponent();
      const recreateTopicButton = screen.getByText(/Recreate topic/i);
      await userEvent.click(recreateTopicButton);
      const confirmBtn = screen.getByRole('button', { name: /Confirm/i });

      await waitFor(() => userEvent.click(confirmBtn));
      expect(mockRecreate).toHaveBeenCalledTimes(1);
    });

    it('closes popup confirmation window after click on Cancel button', async () => {
      renderComponent();
      const recreateTopicButton = screen.getByText(/Recreate topic/i);
      await userEvent.click(recreateTopicButton);
      const cancelBtn = screen.getByRole('button', { name: /cancel/i });
      await userEvent.click(cancelBtn);
      expect(
        screen.queryByText(/Are you sure want to recreate topic?/i)
      ).not.toBeInTheDocument();
    });
  });

  describe('Internal routing', () => {
    const itExpectsCorrectPageRendered = async (
      path: string,
      tab: string,
      selector: string
    ) => {
      renderComponent(false, path);
      expect(screen.getByText(tab)).toHaveClass('is-active');
      await waitFor(() =>
        expect(screen.getByText(selector)).toBeInTheDocument()
      );
    };

    it('renders Overview tab by default', async () => {
      await itExpectsCorrectPageRendered(
        defaultPath,
        'Overview',
        'OverviewMock'
      );
    });
    it('keeps the topic page visible while details refresh in the background', async () => {
      (useTopicDetails as jest.Mock).mockReturnValue({
        data: topic,
        isSuccess: false,
        isLoading: false,
        isRefetching: true,
      });

      renderComponent(false, defaultPath);

      await waitFor(() =>
        expect(screen.getByText('OverviewMock')).toBeInTheDocument()
      );
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    it('renders Messages tabs', async () => {
      await itExpectsCorrectPageRendered(
        clusterTopicMessagesPath(),
        'Messages',
        'MessagesMock'
      );
    });
    it('renders Consumers tab', async () => {
      await itExpectsCorrectPageRendered(
        clusterTopicConsumerGroupsPath(),
        'Consumers',
        'ConsumerGroupsMock'
      );
    });
    it('renders Settings tab', async () => {
      await itExpectsCorrectPageRendered(
        clusterTopicSettingsPath(),
        'Settings',
        'SettingsMock'
      );
    });
    it('renders Statistics tab', async () => {
      await itExpectsCorrectPageRendered(
        clusterTopicStatisticsPath(),
        'Statistics',
        'StatisticsMock'
      );
    });
    it('renders Profile tab', async () => {
      await itExpectsCorrectPageRendered(
        clusterTopicDataProfilePath(),
        'Profile',
        'DataProfileMock'
      );
    });
    it('renders Developer tab', async () => {
      await itExpectsCorrectPageRendered(
        clusterTopicDeveloperPath(),
        'Developer',
        'DeveloperHubMock'
      );
    });

    it('keeps Messages mounted while switching between topic tabs', async () => {
      renderComponent(false, defaultPath);

      await userEvent.click(screen.getByRole('link', { name: 'Messages' }));
      expect(await screen.findByText('MessagesMock')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('link', { name: 'Settings' }));
      expect(await screen.findByText('SettingsMock')).toBeInTheDocument();
      expect(screen.getByText('MessagesMock')).toBeInTheDocument();
    });
  });
});
