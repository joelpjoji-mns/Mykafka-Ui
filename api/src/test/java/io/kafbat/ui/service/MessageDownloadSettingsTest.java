package io.kafbat.ui.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.kafbat.ui.config.ClustersProperties;
import io.kafbat.ui.exception.ValidationException;
import org.junit.jupiter.api.Test;

class MessageDownloadSettingsTest {

  private MessagesService service(ClustersProperties properties) {
    return new MessagesService(null, null, null, properties);
  }

  @Test
  void defaultsToFiveThousandWithoutChangingTheBrowseDefault() {
    var service = service(new ClustersProperties());
    assertThat(service.resolveDownloadLimit(null)).isEqualTo(5_000);
    assertThat(service.downloadSettings()).isEqualTo(new MessagesService.DownloadSettings(5_000, 5_000));
    assertThatThrownBy(() -> service.resolveDownloadLimit(5_001)).isInstanceOf(ValidationException.class);
    assertThatThrownBy(() -> service.resolveDownloadLimit(0)).isInstanceOf(ValidationException.class);
  }

  @Test
  void acceptsHigherYamlLimitsAndExportsThemToTheUi() {
    var properties = new ClustersProperties();
    properties.getPolling().setMaxPageSize(25_000);
    properties.getPolling().setDefaultDownloadLimit(10_000);
    var service = service(properties);
    assertThat(service.resolveDownloadLimit(null)).isEqualTo(10_000);
    assertThat(service.resolveDownloadLimit(25_000)).isEqualTo(25_000);
    assertThat(service.downloadSettings()).isEqualTo(new MessagesService.DownloadSettings(10_000, 25_000));
    assertThatThrownBy(() -> service.resolveDownloadLimit(25_001)).isInstanceOf(ValidationException.class);
  }

  @Test
  void respectsSmallerConfiguredMaximumAndRejectsInvalidConfiguration() {
    var properties = new ClustersProperties();
    properties.getPolling().setMaxPageSize(200);
    assertThat(service(properties).resolveDownloadLimit(null)).isEqualTo(200);
    properties.getPolling().setDefaultDownloadLimit(-1);
    assertThatThrownBy(() -> service(properties)).isInstanceOf(IllegalArgumentException.class);
  }
}
