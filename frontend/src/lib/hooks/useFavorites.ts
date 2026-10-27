import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { LOCAL_STORAGE_KEY_PREFIX } from 'lib/constants';
import { clusterConsumerGroupDetailsPath, clusterTopicPath } from 'lib/paths';

export type FavoriteItemType = 'topic' | 'consumerGroup';

export interface FavoriteItem {
  type: FavoriteItemType;
  name: string;
}

export interface ClusterFavorites {
  favorites: FavoriteItem[];
  recents: FavoriteItem[];
}

export const FAVORITES_STORAGE_KEY = `${LOCAL_STORAGE_KEY_PREFIX}-favorites`;
export const FAVORITES_STORAGE_VERSION = 1;
export const MAX_RECENTS = 8;

export const FAVORITE_TYPE_LABELS: Record<FavoriteItemType, string> = {
  topic: 'Topic',
  consumerGroup: 'Consumer group',
};

interface FavoritesState {
  clusters: Record<string, ClusterFavorites>;
  toggleFavorite: (clusterName: string, item: FavoriteItem) => void;
  removeFavorite: (clusterName: string, item: FavoriteItem) => void;
  recordVisit: (clusterName: string, item: FavoriteItem) => void;
}

type PersistedFavorites = Pick<FavoritesState, 'clusters'>;

const EMPTY_ITEMS: FavoriteItem[] = [];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const isFavoriteItem = (value: unknown): value is FavoriteItem =>
  isRecord(value) &&
  typeof value.name === 'string' &&
  value.name.length > 0 &&
  typeof value.type === 'string' &&
  Object.prototype.hasOwnProperty.call(FAVORITE_TYPE_LABELS, value.type);

export const isSameFavoriteItem = (a: FavoriteItem, b: FavoriteItem) =>
  a.type === b.type && a.name === b.name;

const sanitizeItems = (value: unknown, limit?: number): FavoriteItem[] => {
  if (!Array.isArray(value)) return [];

  const items = value
    .filter(isFavoriteItem)
    .reduce<FavoriteItem[]>((acc, { type, name }) => {
      const item = { type, name };
      if (!acc.some((existing) => isSameFavoriteItem(existing, item))) {
        acc.push(item);
      }
      return acc;
    }, []);

  return limit === undefined ? items : items.slice(0, limit);
};

const sanitizeClusters = (value: unknown): Record<string, ClusterFavorites> => {
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    Object.entries(value).map(([clusterName, entry]) => {
      const cluster = isRecord(entry) ? entry : {};
      return [
        clusterName,
        {
          favorites: sanitizeItems(cluster.favorites),
          recents: sanitizeItems(cluster.recents, MAX_RECENTS),
        },
      ];
    })
  );
};

const getClusters = (state: PersistedFavorites) =>
  isRecord(state.clusters) ? state.clusters : {};

// Returns the stored array itself (stable reference) so selectors don't
// trigger re-renders; falls back to a shared empty list for missing or
// corrupted entries.
const readItems = (
  state: PersistedFavorites,
  clusterName: string,
  key: keyof ClusterFavorites
): FavoriteItem[] => {
  const clusters = getClusters(state);
  if (!Object.prototype.hasOwnProperty.call(clusters, clusterName)) {
    return EMPTY_ITEMS;
  }
  const cluster: unknown = clusters[clusterName];
  const items = isRecord(cluster) ? cluster[key] : undefined;
  return Array.isArray(items) ? items : EMPTY_ITEMS;
};

const containsItem = (items: FavoriteItem[], item: FavoriteItem) =>
  items.some(
    (existing) => isFavoriteItem(existing) && isSameFavoriteItem(existing, item)
  );

const updateCluster = (
  state: PersistedFavorites,
  clusterName: string,
  patch: Partial<ClusterFavorites>
): PersistedFavorites => ({
  clusters: {
    ...getClusters(state),
    [clusterName]: {
      favorites: readItems(state, clusterName, 'favorites'),
      recents: readItems(state, clusterName, 'recents'),
      ...patch,
    },
  },
});

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set) => ({
      clusters: {},
      toggleFavorite: (clusterName, item) =>
        set((state) => {
          if (!clusterName || !isFavoriteItem(item)) return state;
          const favorites = sanitizeItems(
            readItems(state, clusterName, 'favorites')
          );
          const next = containsItem(favorites, item)
            ? favorites.filter(
                (existing) => !isSameFavoriteItem(existing, item)
              )
            : [...favorites, { type: item.type, name: item.name }];
          return updateCluster(state, clusterName, { favorites: next });
        }),
      removeFavorite: (clusterName, item) =>
        set((state) => {
          const favorites = readItems(state, clusterName, 'favorites');
          if (!isFavoriteItem(item) || !containsItem(favorites, item)) {
            return state;
          }
          return updateCluster(state, clusterName, {
            favorites: sanitizeItems(favorites).filter(
              (existing) => !isSameFavoriteItem(existing, item)
            ),
          });
        }),
      recordVisit: (clusterName, item) =>
        set((state) => {
          if (!clusterName || !isFavoriteItem(item)) return state;
          const recents = readItems(state, clusterName, 'recents');
          const [latest] = recents;
          if (isFavoriteItem(latest) && isSameFavoriteItem(latest, item)) {
            return state;
          }
          const next = [
            { type: item.type, name: item.name },
            ...sanitizeItems(recents).filter(
              (existing) => !isSameFavoriteItem(existing, item)
            ),
          ].slice(0, MAX_RECENTS);
          return updateCluster(state, clusterName, { recents: next });
        }),
    }),
    {
      name: FAVORITES_STORAGE_KEY,
      version: FAVORITES_STORAGE_VERSION,
      partialize: (state): PersistedFavorites => ({ clusters: state.clusters }),
      migrate: (persistedState): PersistedFavorites => ({
        clusters: sanitizeClusters(
          isRecord(persistedState) ? persistedState.clusters : undefined
        ),
      }),
      merge: (persistedState, currentState) => {
        if (!isRecord(persistedState)) return currentState;
        return {
          ...currentState,
          clusters: sanitizeClusters(persistedState.clusters),
        };
      },
    }
  )
);

export const useIsFavorite = (clusterName: string, item: FavoriteItem) =>
  useFavoritesStore((state) =>
    containsItem(readItems(state, clusterName, 'favorites'), item)
  );

export const useClusterFavorites = (
  clusterName: string,
  type?: FavoriteItemType
) => {
  const favorites = useFavoritesStore((state) =>
    readItems(state, clusterName, 'favorites')
  );
  return useMemo(
    () => (type ? favorites.filter((item) => item.type === type) : favorites),
    [favorites, type]
  );
};

export const useClusterRecents = (clusterName: string) =>
  useFavoritesStore((state) => readItems(state, clusterName, 'recents'));

export const useRecordVisit = (
  clusterName: string | undefined,
  type: FavoriteItemType,
  name: string | undefined
) => {
  const recordVisit = useFavoritesStore((state) => state.recordVisit);
  useEffect(() => {
    if (clusterName && name) {
      recordVisit(clusterName, { type, name });
    }
  }, [clusterName, type, name, recordVisit]);
};

export const getFavoriteItemPath = (
  clusterName: string,
  { type, name }: FavoriteItem
) =>
  type === 'topic'
    ? clusterTopicPath(clusterName, name)
    : clusterConsumerGroupDetailsPath(clusterName, encodeURIComponent(name));
