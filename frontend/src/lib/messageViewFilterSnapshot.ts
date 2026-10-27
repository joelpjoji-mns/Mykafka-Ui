import { LOCAL_STORAGE_KEY_PREFIX } from 'lib/constants';
import { ClusterName } from 'lib/interfaces/cluster';
import { TopicName } from 'lib/interfaces/topic';

const storageKey = `${LOCAL_STORAGE_KEY_PREFIX}-message-view-filter-snapshots`;

const MAX_SNAPSHOTS = 50;

type Snapshots = Record<string, string>;

const snapshotId = (clusterName: ClusterName, topicName: TopicName) =>
  JSON.stringify([clusterName, topicName]);

// Ids written before snapshots were keyed by JSON tuples.
const legacySnapshotId = (clusterName: ClusterName, topicName: TopicName) =>
  `${clusterName}:${topicName}`;

const readSnapshots = (): Snapshots => {
  try {
    const serialized = sessionStorage.getItem(storageKey);
    if (!serialized) {
      return {};
    }

    const parsed: unknown = JSON.parse(serialized);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === 'string')
    );
  } catch {
    return {};
  }
};

export const saveMessageViewFilterSnapshot = (
  clusterName: ClusterName,
  topicName: TopicName,
  searchParams: URLSearchParams
) => {
  try {
    const snapshots = readSnapshots();
    const id = snapshotId(clusterName, topicName);
    // Re-insert so key order reflects recency, then drop the oldest entries.
    delete snapshots[id];
    delete snapshots[legacySnapshotId(clusterName, topicName)];
    snapshots[id] = searchParams.toString();
    const ids = Object.keys(snapshots);
    ids.slice(0, Math.max(0, ids.length - MAX_SNAPSHOTS)).forEach((staleId) => {
      delete snapshots[staleId];
    });
    sessionStorage.setItem(storageKey, JSON.stringify(snapshots));
  } catch {
    // Session storage is optional in embedded or privacy-restricted browser contexts.
  }
};

export const getMessageViewFilterSnapshot = (
  clusterName: ClusterName,
  topicName: TopicName
): URLSearchParams | undefined => {
  const snapshots = readSnapshots();
  const serialized =
    snapshots[snapshotId(clusterName, topicName)] ??
    snapshots[legacySnapshotId(clusterName, topicName)];
  return serialized === undefined ? undefined : new URLSearchParams(serialized);
};
