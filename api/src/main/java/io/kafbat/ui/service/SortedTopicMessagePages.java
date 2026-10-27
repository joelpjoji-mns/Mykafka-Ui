package io.kafbat.ui.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.google.common.cache.Cache;
import com.google.common.cache.CacheBuilder;
import io.kafbat.ui.exception.ValidationException;
import io.kafbat.ui.model.TopicMessageDTO;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.PriorityQueue;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.zip.Deflater;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

public class SortedTopicMessagePages implements AutoCloseable {

  private static final int MAX_CACHED_MESSAGES = 1_000_000;
  private static final long MAX_CACHE_WEIGHT = 512L * 1024 * 1024;
  private static final long MAX_PAGE_BYTES = 16L * 1024 * 1024;
  private static final int DEFAULT_PREVIEW_LIMIT = 1_000;
  private static final int CURSOR_CACHE_SIZE = 10_000;
  private static final int CACHE_EXPIRY_MINUTES = 30;

  private final ObjectMapper mapper = new ObjectMapper().registerModule(new JavaTimeModule());
  // Bytes held by writers that are still scanning. Shared so concurrent sorted scans cannot each
  // buffer MAX_CACHE_WEIGHT on the heap before their results are handed to the bounded cache.
  private final AtomicLong inFlightWeight = new AtomicLong();
  // A single segment keeps the full weight budget available to one scan; Guava otherwise divides
  // maximumWeight across segments and silently evicts any scan larger than one segment's share.
  private final Cache<String, SortedScan> scans = CacheBuilder.newBuilder()
      .concurrencyLevel(1)
      .maximumWeight(MAX_CACHE_WEIGHT)
      .weigher((String scanId, SortedScan scan) ->
          (int) Math.min(scan.cacheWeight(), MAX_CACHE_WEIGHT))
      .expireAfterAccess(CACHE_EXPIRY_MINUTES, TimeUnit.MINUTES)
      .build();
  private final Cache<String, PageCursor> cursors = CacheBuilder.newBuilder()
      .maximumSize(CURSOR_CACHE_SIZE)
      .expireAfterAccess(CACHE_EXPIRY_MINUTES, TimeUnit.MINUTES)
      .build();

  public Writer newWriter() {
    return new Writer(false, DEFAULT_PREVIEW_LIMIT);
  }

  public Writer newWriter(boolean descending, int previewLimit) {
    return new Writer(descending, previewLimit);
  }

  public Page readPage(
      String cursorId, String clusterName, String topicName, String signature, int pageSize) {
    PageCursor cursor = cursors.getIfPresent(cursorId);
    if (cursor == null) {
      throw new ValidationException("Sorted message page cursor is invalid or expired. Sort again.");
    }
    SortedScan scan = scans.getIfPresent(cursor.scanId());
    if (scan == null
        || !scan.clusterName().equals(clusterName)
        || !scan.topicName().equals(topicName)
        || !scan.signature().equals(signature)
        || scan.pageSize() != pageSize
        || cursor.nextIndex() < 0
        || cursor.nextIndex() >= scan.references().size()) {
      throw new ValidationException("Sorted message page cursor does not match this request. Sort again.");
    }

    int endIndex = pageEnd(scan.references(), cursor.nextIndex(), pageSize, MAX_PAGE_BYTES);
    List<TopicMessageDTO> messages = new ArrayList<>(endIndex - cursor.nextIndex());
    for (int index = cursor.nextIndex(); index < endIndex; index++) {
      SizeReference reference = scan.references().get(index);
      messages.add(readMessage(scan.compressedMessages().get(reference.messageIndex())));
    }

    String nextCursor = endIndex < scan.references().size()
        ? registerCursor(cursor.scanId(), endIndex, cursor.pageNumber() + 1)
        : null;
    return new Page(messages, nextCursor, cursor.pageNumber(), scan.references().size());
  }

  @Override
  public void close() {
    cursors.invalidateAll();
    scans.invalidateAll();
  }

  private String registerCursor(String scanId, int nextIndex, int pageNumber) {
    String cursorId = UUID.randomUUID().toString();
    cursors.put(cursorId, new PageCursor(scanId, nextIndex, pageNumber));
    return cursorId;
  }

  private static int pageEnd(
      List<SizeReference> references, int startIndex, int pageSize, long byteBudget) {
    long pageBytes = 0;
    int endIndex = startIndex;
    while (endIndex < references.size() && endIndex - startIndex < pageSize) {
      long messageSize = references.get(endIndex).size();
      if (endIndex > startIndex && pageBytes + messageSize > byteBudget) {
        break;
      }
      pageBytes += messageSize;
      endIndex++;
    }
    return endIndex;
  }

  private TopicMessageDTO readMessage(byte[] compressed) {
    try (var input = new GZIPInputStream(new ByteArrayInputStream(compressed))) {
      return mapper.readValue(input, TopicMessageDTO.class);
    } catch (IOException e) {
      throw new UncheckedIOException("Failed to read sorted message page", e);
    }
  }

  private byte[] compressMessage(TopicMessageDTO message) {
    try {
      byte[] json = mapper.writeValueAsBytes(message);
      ByteArrayOutputStream output = new ByteArrayOutputStream();
      try (GZIPOutputStream gzip = new GZIPOutputStream(output) {
        {
          def.setLevel(Deflater.BEST_SPEED);
        }
      }) {
        gzip.write(json);
      }
      return output.toByteArray();
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Failed to encode sorted message", e);
    } catch (IOException e) {
      throw new UncheckedIOException("Failed to compress sorted message", e);
    }
  }

  private static long sizeOf(TopicMessageDTO message) {
    return (message.getKeySize() == null ? 0L : message.getKeySize())
        + (message.getValueSize() == null ? 0L : message.getValueSize())
        + (message.getHeadersSize() == null ? 0L : message.getHeadersSize());
  }

  private record SizeReference(
      int partition, long offset, long size, int messageIndex) {
  }

  private record SortedScan(
      String clusterName,
      String topicName,
      String signature,
      int pageSize,
      List<SizeReference> references,
      List<byte[]> compressedMessages,
      long cacheWeight) {
  }

  private record PageCursor(String scanId, int nextIndex, int pageNumber) {
  }

  public record Page(
      List<TopicMessageDTO> messages, String nextCursor, int pageNumber, int totalMessages) {
  }

  public final class Writer implements AutoCloseable {

    private final List<SizeReference> references = new ArrayList<>();
    private final List<byte[]> compressedMessages = new ArrayList<>();
    private final int previewLimit;
    private final boolean previewDescending;
    private final Comparator<SizeReference> previewOrder;
    private final PriorityQueue<SizeReference> previewReferences;
    private long cacheWeight;
    private boolean paginationAvailable = true;
    private boolean closed;

    private Writer(boolean descending, int previewLimit) {
      this.previewLimit = Math.max(1, previewLimit);
      this.previewDescending = descending;
      this.previewOrder = sizeOrder(descending);
      this.previewReferences =
          new PriorityQueue<>(this.previewLimit, previewOrder.reversed());
    }

    public synchronized boolean hasMessages() {
      return paginationAvailable && !references.isEmpty();
    }

    public synchronized void append(TopicMessageDTO message) {
      if (!paginationAvailable || closed) {
        return;
      }
      if (references.size() >= MAX_CACHED_MESSAGES) {
        disablePagination();
        return;
      }

      byte[] compressed = compressMessage(message);
      long weight = compressed.length + 32L;
      if (cacheWeight + weight > MAX_CACHE_WEIGHT) {
        disablePagination();
        return;
      }
      if (inFlightWeight.addAndGet(weight) > MAX_CACHE_WEIGHT) {
        inFlightWeight.addAndGet(-weight);
        disablePagination();
        return;
      }

      int messageIndex = compressedMessages.size();
      compressedMessages.add(compressed);
      SizeReference reference = new SizeReference(
          message.getPartition(),
          message.getOffset(),
          sizeOf(message),
          messageIndex);
      references.add(reference);
      if (previewReferences.size() < previewLimit) {
        previewReferences.add(reference);
      } else if (previewOrder.compare(reference, previewReferences.peek()) < 0) {
        previewReferences.poll();
        previewReferences.add(reference);
      }
      cacheWeight += weight;
    }

    public synchronized List<TopicMessageDTO> preview(int limit, long byteBudget, boolean descending) {
      if (!paginationAvailable) {
        return List.of();
      }
      if (descending != previewDescending) {
        throw new IllegalArgumentException("Preview direction must match the writer direction");
      }
      List<SizeReference> ranked = previewReferences.stream().sorted(previewOrder).toList();
      int endIndex = pageEnd(ranked, 0, Math.min(limit, previewLimit), byteBudget);
      List<TopicMessageDTO> messages = new ArrayList<>(endIndex);
      for (int index = 0; index < endIndex; index++) {
        SizeReference reference = ranked.get(index);
        messages.add(readMessage(compressedMessages.get(reference.messageIndex())));
      }
      return messages;
    }

    public synchronized Page finish(
        String clusterName, String topicName, String signature, int pageSize, boolean descending) {
      if (!paginationAvailable) {
        clear();
        throw new ValidationException(
            "The size-sorted result exceeds the server's interactive pagination capacity.");
      }

      references.sort(sizeOrder(descending));
      int endIndex = pageEnd(references, 0, pageSize, MAX_PAGE_BYTES);
      List<TopicMessageDTO> firstPage = new ArrayList<>(endIndex);
      for (int index = 0; index < endIndex; index++) {
        SizeReference reference = references.get(index);
        firstPage.add(readMessage(compressedMessages.get(reference.messageIndex())));
      }

      String nextCursor = null;
      if (endIndex < references.size()) {
        String scanId = UUID.randomUUID().toString();
        SortedScan scan = new SortedScan(
            clusterName,
            topicName,
            signature,
            pageSize,
            List.copyOf(references),
            List.copyOf(compressedMessages),
            cacheWeight);
        scans.put(scanId, scan);
        if (scans.getIfPresent(scanId) == null) {
          clear();
          throw new ValidationException(
              "The sorted result could not be cached for pagination. Try a smaller page size.");
        }
        nextCursor = registerCursor(scanId, endIndex, 2);
      }
      Page result = new Page(firstPage, nextCursor, 1, references.size());
      clear();
      return result;
    }

    private static Comparator<SizeReference> sizeOrder(boolean descending) {
      Comparator<SizeReference> order = Comparator.comparingLong(SizeReference::size)
          .thenComparingInt(SizeReference::partition)
          .thenComparingLong(SizeReference::offset);
      return descending ? order.reversed() : order;
    }

    @Override
    public synchronized void close() {
      // Always release: finish() may have thrown before clearing, and clear() is idempotent
      // (cached scans hold their own copies of the lists).
      closed = true;
      clear();
    }

    private void disablePagination() {
      paginationAvailable = false;
      clear();
    }

    private void clear() {
      references.clear();
      compressedMessages.clear();
      previewReferences.clear();
      inFlightWeight.addAndGet(-cacheWeight);
      cacheWeight = 0;
    }
  }
}
