package io.kafbat.ui.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.kafbat.ui.util.DynamicConfigOperations;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ApplicationInfoServiceTest {
  private DynamicConfigOperations dynamicConfigOperations;

  @BeforeEach
  void setUp() {
    dynamicConfigOperations = mock(DynamicConfigOperations.class);
    when(dynamicConfigOperations.dynamicConfigEnabled()).thenReturn(false);
  }

  @Test
  void testGithubReleaseInfoDisabledByDefault() {
    var service = applicationInfoService(false, 10);

    assertNull(service.githubReleaseInfo(), "unexpected GitHub release info by default");

    var appInfo = service.getApplicationInfo();
    assertNotNull(appInfo, "application info must not be NULL");
    assertNull(appInfo.getLatestRelease(), "latest release should be NULL by default");
    assertNotNull(appInfo.getBuild(), "build info must not be NULL");
    assertNotNull(appInfo.getEnabledFeatures(), "enabled features must not be NULL");
  }

  @Test
  void testCustomGithubReleaseInfoTimeoutWhenEnabled() {
    var service2 = applicationInfoService(true, 100);

    assertNotNull(service2.githubReleaseInfo(), "expected GitHub release info when enabled");
    assertEquals(100, service2.githubReleaseInfo().getGithubApiMaxWaitTime());
  }

  @Test
  void testDisabledReleaseInfo() {
    var service2 = applicationInfoService(false, 101);

    assertNull(service2.githubReleaseInfo(), "unexpected GitHub release info when disabled");
    var appInfo = service2.getApplicationInfo();
    assertNotNull(appInfo, "application info must not be NULL");
    assertNull(appInfo.getLatestRelease(), "latest release should be NULL when disabled");
    assertNotNull(appInfo.getBuild(), "build info must not be NULL");
    assertNotNull(appInfo.getEnabledFeatures(), "enabled features must not be NULL");
  }

  @Test
  void exposesOnlyDynamicConfigurationWhenEnabled() {
    when(dynamicConfigOperations.dynamicConfigEnabled()).thenReturn(true);
    assertEquals(
        java.util.List.of(io.kafbat.ui.model.ApplicationInfoDTO.EnabledFeaturesEnum.DYNAMIC_CONFIG),
        applicationInfoService(false, 10).getApplicationInfo().getEnabledFeatures());
  }

  private ApplicationInfoService applicationInfoService(boolean githubInfoEnabled, int githubApiMaxWaitTime) {
    return new ApplicationInfoService(
        dynamicConfigOperations,
        null,
        null,
        null,
        githubInfoEnabled,
        githubApiMaxWaitTime
    );
  }

}
