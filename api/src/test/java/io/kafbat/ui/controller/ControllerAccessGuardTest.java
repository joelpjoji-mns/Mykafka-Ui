package io.kafbat.ui.controller;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import io.kafbat.ui.config.ClustersProperties;
import io.kafbat.ui.mapper.DynamicConfigMapper;
import io.kafbat.ui.model.ApplicationConfigDTO;
import io.kafbat.ui.model.rbac.AccessContext;
import io.kafbat.ui.service.ApplicationInfoService;
import io.kafbat.ui.service.ConnectorTriageService;
import io.kafbat.ui.service.KafkaClusterFactory;
import io.kafbat.ui.service.KafkaConnectService;
import io.kafbat.ui.service.SchemaRegistryService;
import io.kafbat.ui.service.audit.AuditService;
import io.kafbat.ui.service.rbac.AccessControlService;
import io.kafbat.ui.util.ApplicationRestarter;
import io.kafbat.ui.util.DynamicConfigOperations;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;
import reactor.core.publisher.Mono;

class ControllerAccessGuardTest {

  @Test
  void configValidationRejectsDisabledDynamicConfigBeforeMappingRequest() {
    var accessControlService = mock(AccessControlService.class);
    when(accessControlService.validateAccess(any(AccessContext.class))).thenReturn(Mono.empty());

    var dynamicConfigOperations = mock(DynamicConfigOperations.class);
    doThrow(new IllegalStateException("Dynamic configuration is disabled"))
        .when(dynamicConfigOperations)
        .checkIfDynamicConfigEnabled();
    var configMapper = mock(DynamicConfigMapper.class);
    var controller = new ApplicationConfigController(
        dynamicConfigOperations,
        mock(ApplicationRestarter.class),
        mock(KafkaClusterFactory.class),
        mock(ApplicationInfoService.class),
        configMapper);
    controller.setAccessControlService(accessControlService);
    controller.setAuditService(mock(AuditService.class));

    assertThatThrownBy(() -> controller.validateConfig(Mono.just(new ApplicationConfigDTO()), null).block())
        .isInstanceOf(IllegalStateException.class)
        .hasMessage("Dynamic configuration is disabled");

    verifyNoInteractions(configMapper);
  }

  @Test
  void connectorPluginValidationRejectsUnauthorizedRequestBeforeCallingService() {
    var accessControlService = mock(AccessControlService.class);
    when(accessControlService.validateAccess(any(AccessContext.class)))
        .thenReturn(Mono.error(new AccessDeniedException("denied")));

    var kafkaConnectService = mock(KafkaConnectService.class);
    var controller = new KafkaConnectController(kafkaConnectService, mock(ConnectorTriageService.class));
    controller.setAccessControlService(accessControlService);
    controller.setAuditService(mock(AuditService.class));

    assertThatThrownBy(() -> controller.validateConnectorPluginConfig(
        "cluster",
        "connect",
        "plugin",
        Mono.just(Map.of()),
        null).block())
        .isInstanceOf(AccessDeniedException.class);

    verifyNoInteractions(kafkaConnectService);
  }

  @Test
  void globalSchemaCompatibilityReadRejectsUnauthorizedRequestBeforeCallingService() {
    var accessControlService = mock(AccessControlService.class);
    when(accessControlService.validateAccess(any(AccessContext.class)))
        .thenReturn(Mono.error(new AccessDeniedException("denied")));

    var schemaRegistryService = mock(SchemaRegistryService.class);
    var controller = new SchemasController(schemaRegistryService, new ClustersProperties());
    controller.setAccessControlService(accessControlService);
    controller.setAuditService(mock(AuditService.class));

    assertThatThrownBy(() -> controller.getGlobalSchemaCompatibilityLevel("cluster", null).block())
        .isInstanceOf(AccessDeniedException.class);

    verifyNoInteractions(schemaRegistryService);
  }
}
