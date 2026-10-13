package io.kafbat.ui.service.index;

import io.kafbat.ui.config.ClustersProperties;
import java.util.Arrays;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import org.apache.kafka.clients.admin.ConsumerGroupListing;
import reactor.util.function.Tuple2;
import reactor.util.function.Tuples;

public class ConsumerGroupFilter extends NgramFilter<ConsumerGroupListing> {
  private final List<Tuple2<List<String>, ConsumerGroupListing>> groups;

  public ConsumerGroupFilter(Collection<ConsumerGroupListing> groups) {
    this(groups, true, new ClustersProperties.NgramProperties(1, 4, true));
  }

  public ConsumerGroupFilter(
      Collection<ConsumerGroupListing> groups,
      boolean enabled,
      ClustersProperties.NgramProperties properties) {
    super(properties, enabled);
    this.groups = groups.stream().map(g -> Tuples.of(List.of(g.groupId()), g)).toList();
  }

  @Override
  protected List<Tuple2<List<String>, ConsumerGroupListing>> getItems() {
    return this.groups;
  }

  @Override
  public List<ConsumerGroupListing> find(String search, Comparator<ConsumerGroupListing> comparator) {
    if (search == null || !search.contains(",")) {
      return super.find(search, comparator);
    }
    var matches = new LinkedHashMap<String, ConsumerGroupListing>();
    Arrays.stream(search.split(","))
        .map(String::trim)
        .filter(term -> !term.isEmpty())
        .distinct()
        .forEach(term -> super.find(term, null)
            .forEach(group -> matches.putIfAbsent(group.groupId(), group)));
    var result = matches.values().stream();
    return (comparator == null ? result : result.sorted(comparator)).toList();
  }
}
