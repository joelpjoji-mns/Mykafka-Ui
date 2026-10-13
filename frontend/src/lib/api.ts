import {
  KsqlApi,
  TopicsApi,
  SchemasApi,
  BrokersApi,
  MessagesApi,
  ClustersApi,
  Configuration,
  KafkaConnectApi,
  ConsumerGroupsApi,
  AuthorizationApi,
  ApplicationConfigApi,
  AclsApi,
  UnmappedApi,
  OperationsCenterApi,
  TopicGovernanceAdvisorApi,
  AuditApi,
  RecordExplorerApi,
} from 'generated-sources';
import { BASE_PARAMS } from 'lib/constants';

const apiClientConf = new Configuration(BASE_PARAMS);

export const ksqlDbApiClient = new KsqlApi(apiClientConf);
export const topicsApiClient = new TopicsApi(apiClientConf);
export const brokersApiClient = new BrokersApi(apiClientConf);
export const schemasApiClient = new SchemasApi(apiClientConf);
export const messagesApiClient = new MessagesApi(apiClientConf);
export const clustersApiClient = new ClustersApi(apiClientConf);
export const kafkaConnectApiClient = new KafkaConnectApi(apiClientConf);
export const consumerGroupsApiClient = new ConsumerGroupsApi(apiClientConf);
export const authApiClient = new AuthorizationApi(apiClientConf);
export const appConfigApiClient = new ApplicationConfigApi(apiClientConf);
export const aclApiClient = new AclsApi(apiClientConf);
export const internalApiClient = new UnmappedApi(apiClientConf);
export const operationsCenterApiClient = new OperationsCenterApi(apiClientConf);
export const topicGovernanceApiClient = new TopicGovernanceAdvisorApi(
  apiClientConf
);
export const auditApiClient = new AuditApi(apiClientConf);
export const recordExplorerApiClient = new RecordExplorerApi(apiClientConf);
