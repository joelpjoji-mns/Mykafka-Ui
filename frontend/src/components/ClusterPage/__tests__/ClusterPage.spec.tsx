import React from 'react';
import { Cluster, ClusterFeaturesEnum, ServerStatus } from 'generated-sources';
import ClusterPageComponent from 'components/ClusterPage/ClusterPage';
import { screen, waitFor } from '@testing-library/react';
import { render, WithRoute } from 'lib/testHelpers';
import {
  clusterBrokersPath,
  clusterConnectorsPath,
  clusterConsumerGroupsPath,
  clusterKsqlDbPath,
  clusterPath,
  clusterSchemasPath,
  clusterTopicsPath,
  kafkaConnectPath,
} from 'lib/paths';
import { useClusters } from 'lib/hooks/api/clusters';
import { onlineClusterPayload } from 'lib/fixtures/clusters';

const CLusterCompText = {
  Topics: 'Topics',
  Schemas: 'Schemas',
  Connect: 'Kafka Connect',
  Brokers: 'Brokers',
  ConsumerGroups: 'ConsumerGroups',
  KsqlDb: 'KsqlDb',
};

jest.mock('components/Topics/Topics', () => () => (
  <div>{CLusterCompText.Topics}</div>
));
jest.mock('components/Schemas/Schemas', () => () => (
  <div>{CLusterCompText.Schemas}</div>
));
jest.mock('components/Connect/Connect', () => () => (
  <div>{CLusterCompText.Connect}</div>
));
jest.mock('components/Brokers/Brokers', () => () => (
  <div>{CLusterCompText.Brokers}</div>
));
jest.mock('components/ConsumerGroups/ConsumerGroups', () => () => (
  <div>{CLusterCompText.ConsumerGroups}</div>
));
jest.mock('components/KsqlDb/KsqlDb', () => () => (
  <div>{CLusterCompText.KsqlDb}</div>
));

jest.mock('lib/hooks/api/clusters', () => ({
  useClusters: jest.fn(),
}));

describe('ClusterPage', () => {
  const renderComponent = async (pathname: string, payload: Cluster[] = []) => {
    (useClusters as jest.Mock).mockImplementation(() => ({
      data:
        payload.length > 0
          ? payload
          : [{ ...onlineClusterPayload, name: 'second' }],
      isFetched: true,
      isFetchedAfterMount: true,
    }));
    await render(
      <WithRoute path={`${clusterPath()}/*`}>
        <ClusterPageComponent />
      </WithRoute>,
      { initialEntries: [pathname] }
    );
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
  };

  it('renders Brokers', async () => {
    await renderComponent(clusterBrokersPath('second'));
    expect(screen.getByText(CLusterCompText.Brokers)).toBeInTheDocument();
  });
  it('renders Topics', async () => {
    await renderComponent(clusterTopicsPath('second'));
    expect(screen.getByText(CLusterCompText.Topics)).toBeInTheDocument();
  });
  it('renders ConsumerGroups', async () => {
    await renderComponent(clusterConsumerGroupsPath('second'));
    expect(
      screen.getByText(CLusterCompText.ConsumerGroups)
    ).toBeInTheDocument();
  });

  it('keeps cached cluster pages visible when the status refresh fails', async () => {
    (useClusters as jest.Mock).mockReturnValue({
      data: [{ ...onlineClusterPayload, name: 'second' }],
      isFetched: true,
      isFetchedAfterMount: true,
      isFetching: false,
      error: new Error('temporary status refresh failure'),
    });
    await render(
      <WithRoute path={`${clusterPath()}/*`}>
        <ClusterPageComponent />
      </WithRoute>,
      { initialEntries: [clusterBrokersPath('second')] }
    );

    expect(screen.getByText(CLusterCompText.Brokers)).toBeInTheDocument();
    expect(
      screen.queryByText('Connecting to Kafka cluster second...')
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('waits for an initializing cluster before rendering cluster pages', async () => {
    (useClusters as jest.Mock).mockReturnValue({
      data: [
        {
          ...onlineClusterPayload,
          name: 'second',
          status: ServerStatus.INITIALIZING,
          connectionStatus: ServerStatus.INITIALIZING,
        },
      ],
      isFetched: true,
      isFetchedAfterMount: true,
    });
    await render(
      <WithRoute path={`${clusterPath()}/*`}>
        <ClusterPageComponent />
      </WithRoute>,
      { initialEntries: [clusterBrokersPath('second')] }
    );

    expect(
      screen.getByText('Connecting to Kafka cluster second...')
    ).toBeInTheDocument();
    expect(screen.queryByText(CLusterCompText.Brokers)).not.toBeInTheDocument();
  });

  it('shows a retry state when the cluster is offline', async () => {
    (useClusters as jest.Mock).mockReturnValue({
      data: [
        {
          ...onlineClusterPayload,
          name: 'second',
          status: ServerStatus.OFFLINE,
          connectionStatus: ServerStatus.OFFLINE,
        },
      ],
      isFetched: true,
      isFetchedAfterMount: true,
      refetch: jest.fn(),
    });
    await render(
      <WithRoute path={`${clusterPath()}/*`}>
        <ClusterPageComponent />
      </WithRoute>,
      { initialEntries: [clusterBrokersPath('second')] }
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Kafka cluster is not connected'
    );
    expect(
      screen.getByRole('button', { name: 'Check connection' })
    ).toBeInTheDocument();
    expect(screen.queryByText(CLusterCompText.Brokers)).not.toBeInTheDocument();
  });

  describe('configured features', () => {
    const itCorrectlyHandlesConfiguredSchema = (
      feature: ClusterFeaturesEnum,
      text: string,
      path: string
    ) => {
      it(`renders Schemas if ${feature} is configured`, async () => {
        await renderComponent(path, [
          {
            ...onlineClusterPayload,
            features: [feature],
          },
        ]);
        expect(screen.getByText(text)).toBeInTheDocument();
      });

      it(`does not render Schemas if ${feature} is not configured`, async () => {
        await renderComponent(path, [
          { ...onlineClusterPayload, features: [] },
        ]);
        expect(screen.queryByText(text)).not.toBeInTheDocument();
      });
    };

    itCorrectlyHandlesConfiguredSchema(
      ClusterFeaturesEnum.SCHEMA_REGISTRY,
      CLusterCompText.Schemas,
      clusterSchemasPath(onlineClusterPayload.name)
    );
    itCorrectlyHandlesConfiguredSchema(
      ClusterFeaturesEnum.KAFKA_CONNECT,
      CLusterCompText.Connect,
      kafkaConnectPath(onlineClusterPayload.name)
    );
    itCorrectlyHandlesConfiguredSchema(
      ClusterFeaturesEnum.KAFKA_CONNECT,
      CLusterCompText.Connect,
      clusterConnectorsPath(onlineClusterPayload.name)
    );
    itCorrectlyHandlesConfiguredSchema(
      ClusterFeaturesEnum.KSQL_DB,
      CLusterCompText.KsqlDb,
      clusterKsqlDbPath(onlineClusterPayload.name)
    );
  });
});
