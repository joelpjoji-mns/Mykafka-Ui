package io.kafbat.ui.service.profile;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.kafbat.ui.model.TopicDataProfileDTO;
import io.kafbat.ui.model.TopicDataProfileFieldDTO;
import io.kafbat.ui.model.TopicDataProfileHeaderDTO;
import io.kafbat.ui.model.TopicDataProfileHeadersDTO;
import io.kafbat.ui.model.TopicDataProfileJsonDTO;
import io.kafbat.ui.model.TopicDataProfileJsonFieldDTO;
import io.kafbat.ui.model.TopicDataProfileJsonTypeDTO;
import io.kafbat.ui.model.TopicDataProfileSizeDTO;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.common.header.Header;
import org.apache.kafka.common.utils.Bytes;

final class TopicDataProfileAccumulator {
  private static final int MAX_TRACKED_HEADER_NAMES = 50;
  private static final int MAX_TRACKED_JSON_FIELDS = 50;

  private final ObjectMapper objectMapper;
  private final SizeStats keySizes = new SizeStats();
  private final SizeStats valueSizes = new SizeStats();
  private final Map<String, Integer> headerNames = new HashMap<>();
  private final Map<String, JsonFieldStats> jsonFields = new HashMap<>();
  private final Set<Integer> sampledPartitions = new HashSet<>();

  private int sampledRecords;
  private int nullKeys;
  private int nullValues;
  private int recordsWithHeaders;
  private int totalHeaders;
  private int parsedValueCount;
  private int objectValueCount;

  TopicDataProfileAccumulator(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
  }

  void apply(ConsumerRecord<Bytes, Bytes> record) {
    sampledRecords++;
    sampledPartitions.add(record.partition());
    applyKey(record);
    applyValue(record);
    applyHeaders(record);
  }

  int sampledRecords() {
    return sampledRecords;
  }

  TopicDataProfileDTO toDto(int sampleLimit, int totalPartitions) {
    return new TopicDataProfileDTO()
        .sampled(true)
        .sampledAtMs(System.currentTimeMillis())
        .sampleLimit(sampleLimit)
        .sampleLimitReached(sampledRecords >= sampleLimit)
        .sampledRecords(sampledRecords)
        .totalPartitions(totalPartitions)
        .sampledPartitions(sampledPartitions.size())
        .key(field(keySizes, sampledRecords - nullKeys, nullKeys))
        .value(field(valueSizes, sampledRecords - nullValues, nullValues))
        .headers(headers())
        .json(json());
  }

  private void applyKey(ConsumerRecord<Bytes, Bytes> record) {
    if (record.key() == null) {
      nullKeys++;
      return;
    }
    keySizes.add(serializedSize(record.serializedKeySize(), record.key()));
  }

  private void applyValue(ConsumerRecord<Bytes, Bytes> record) {
    if (record.value() == null) {
      nullValues++;
      return;
    }
    valueSizes.add(serializedSize(record.serializedValueSize(), record.value()));
    applyJson(record.value().get());
  }

  private void applyHeaders(ConsumerRecord<Bytes, Bytes> record) {
    int recordHeaders = 0;
    for (Header header : record.headers()) {
      recordHeaders++;
      totalHeaders++;
      if (headerNames.containsKey(header.key()) || headerNames.size() < MAX_TRACKED_HEADER_NAMES) {
        headerNames.merge(header.key(), 1, Integer::sum);
      }
    }
    if (recordHeaders > 0) {
      recordsWithHeaders++;
    }
  }

  private void applyJson(byte[] value) {
    try {
      JsonNode root = objectMapper.readTree(value);
      // Empty payloads yield a MissingNode, which is not a parsed JSON value.
      if (root == null || root.isMissingNode()) {
        return;
      }
      parsedValueCount++;
      if (!root.isObject()) {
        return;
      }
      objectValueCount++;
      root.properties().forEach(field -> {
        String name = field.getKey();
        if (jsonFields.containsKey(name) || jsonFields.size() < MAX_TRACKED_JSON_FIELDS) {
          jsonFields.computeIfAbsent(name, ignored -> new JsonFieldStats()).apply(field.getValue());
        }
      });
    } catch (Exception ignored) {
    }
  }

  private TopicDataProfileFieldDTO field(SizeStats sizes, int presentCount, int nullCount) {
    return new TopicDataProfileFieldDTO()
        .presentCount(presentCount)
        .nullCount(nullCount)
        .size(sizes.toDto());
  }

  private TopicDataProfileHeadersDTO headers() {
    List<TopicDataProfileHeaderDTO> names = headerNames.entrySet().stream()
        .sorted(Map.Entry.<String, Integer>comparingByValue().reversed()
            .thenComparing(Map.Entry.comparingByKey()))
        .map(entry -> new TopicDataProfileHeaderDTO()
            .name(entry.getKey())
            .occurrenceCount(entry.getValue()))
        .toList();
    return new TopicDataProfileHeadersDTO()
        .recordsWithHeaders(recordsWithHeaders)
        .totalHeaders(totalHeaders)
        .names(names);
  }

  private TopicDataProfileJsonDTO json() {
    List<TopicDataProfileJsonFieldDTO> fields = jsonFields.entrySet().stream()
        .sorted(Comparator.comparing(Map.Entry::getKey))
        .map(entry -> entry.getValue().toDto(entry.getKey()))
        .toList();
    return new TopicDataProfileJsonDTO()
        .parsedValueCount(parsedValueCount)
        .objectValueCount(objectValueCount)
        .topLevelFields(fields);
  }

  private int serializedSize(int serializedSize, Bytes value) {
    return serializedSize >= 0 ? serializedSize : value.get().length;
  }

  private static class SizeStats {
    private final List<Integer> values = new ArrayList<>();
    private long total;
    private Integer min;
    private Integer max;

    void add(int value) {
      values.add(value);
      total += value;
      min = min == null ? value : Math.min(min, value);
      max = max == null ? value : Math.max(max, value);
    }

    TopicDataProfileSizeDTO toDto() {
      if (values.isEmpty()) {
        return new TopicDataProfileSizeDTO().observedCount(0);
      }
      List<Integer> sorted = values.stream().sorted().toList();
      int percentileIndex = Math.max(0, (int) Math.ceil(sorted.size() * 0.95) - 1);
      return new TopicDataProfileSizeDTO()
          .observedCount(values.size())
          .minBytes(min.longValue())
          .maxBytes(max.longValue())
          .averageBytes(total / values.size())
          .p95Bytes(sorted.get(percentileIndex).longValue());
    }
  }

  private static class JsonFieldStats {
    private final Set<TopicDataProfileJsonTypeDTO> types = EnumSet.noneOf(
        TopicDataProfileJsonTypeDTO.class);
    private int presentCount;
    private int nullCount;

    void apply(JsonNode value) {
      presentCount++;
      TopicDataProfileJsonTypeDTO type = type(value);
      types.add(type);
      if (type == TopicDataProfileJsonTypeDTO.NULL) {
        nullCount++;
      }
    }

    TopicDataProfileJsonFieldDTO toDto(String name) {
      return new TopicDataProfileJsonFieldDTO()
          .name(name)
          .presentCount(presentCount)
          .nullCount(nullCount)
          .types(types.stream().sorted().toList());
    }

    private TopicDataProfileJsonTypeDTO type(JsonNode value) {
      if (value.isNull()) {
        return TopicDataProfileJsonTypeDTO.NULL;
      }
      if (value.isBoolean()) {
        return TopicDataProfileJsonTypeDTO.BOOLEAN;
      }
      if (value.isNumber()) {
        return TopicDataProfileJsonTypeDTO.NUMBER;
      }
      if (value.isArray()) {
        return TopicDataProfileJsonTypeDTO.ARRAY;
      }
      if (value.isObject()) {
        return TopicDataProfileJsonTypeDTO.OBJECT;
      }
      return TopicDataProfileJsonTypeDTO.STRING;
    }
  }
}