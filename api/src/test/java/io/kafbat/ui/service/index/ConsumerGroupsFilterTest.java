package io.kafbat.ui.service.index;

import static org.assertj.core.api.Assertions.assertThat;

import io.kafbat.ui.config.ClustersProperties;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.apache.kafka.clients.admin.ConsumerGroupListing;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class ConsumerGroupsFilterTest {
  private final List<String> names = List.of(
      "connect-test-10",
      "connect-test-9",
      "connect-test-90",
      "connect-local-file-sink",
      "martech-mt0-data-integration-platform-rapi-orders",
      "pmp-recon-connect.payments.crypto.ctt.agent.created.v1",
      "rmd-flink.volatility.trigger.v26",
      "iat-ntapi-account-dd-consumer-prod"
  );

  @Test
  void testFindTopicsByName() throws Exception {
    List<ConsumerGroupListing> groups =
        names.stream().map(n -> new ConsumerGroupListing(n, true)).toList();

    ConsumerGroupFilter filter = new ConsumerGroupFilter(groups);

    Map<String, Integer> tests = Map.of(
        "test 10", 1,
        "test", 3,
        "payment created", 1,
        "test 9", 2,
        "volatility 26", 1
    );

    for (Map.Entry<String, Integer> entry : tests.entrySet()) {
      List<ConsumerGroupListing> result = filter.find(entry.getKey());
      assertThat(result).size()
          .withFailMessage("Expected %d results for '%s', but got %s", entry.getValue(), entry.getKey(), result)
          .isEqualTo(entry.getValue());
    }
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void combinesExactlyTheIndependentSearchResults(boolean fts) {
    var groups = List.of("abcd-orders", "uhdg-payments", "abcd-uhdg", "unrelated")
        .stream().map(name -> new ConsumerGroupListing(name, true)).toList();
    var filter = new ConsumerGroupFilter(groups, fts, new ClustersProperties.NgramProperties());
    var expected = Stream.concat(
        filter.find("abcd").stream(), filter.find("uhdg").stream()).distinct().toList();

    assertThat(filter.find("abcd, uhdg")).containsExactlyElementsOf(expected);
    assertThat(filter.find(" , abcd, , uhdg, abcd, "))
        .containsExactlyElementsOf(expected);
    assertThat(filter.find("abcd, no-such-consumer")).containsExactlyElementsOf(filter.find("abcd"));
    assertThat(filter.find("no-such-consumer, not-found")).isEmpty();
    assertThat(filter.find(" , , ")).isEmpty();
    assertThat(filter.find("")).containsExactlyElementsOf(groups);
    assertThat(filter.find("uhdg, abcd", Comparator.comparing(ConsumerGroupListing::groupId)))
        .containsExactlyElementsOf(expected.stream()
            .sorted(Comparator.comparing(ConsumerGroupListing::groupId)).toList());
  }

}
