import { act, renderHook } from '@testing-library/react';
import {
  FAVORITES_STORAGE_KEY,
  FAVORITES_STORAGE_VERSION,
  FavoriteItem,
  MAX_RECENTS,
  getFavoriteItemPath,
  useClusterFavorites,
  useClusterRecents,
  useFavoritesStore,
  useIsFavorite,
} from 'lib/hooks/useFavorites';

const cluster = 'local';
const otherCluster = 'remote';
const topic = (name: string): FavoriteItem => ({ type: 'topic', name });
const group = (name: string): FavoriteItem => ({ type: 'consumerGroup', name });

const { toggleFavorite, recordVisit, removeFavorite } =
  useFavoritesStore.getState();

const favoritesOf = (clusterName: string) =>
  useFavoritesStore.getState().clusters[clusterName]?.favorites;
const recentsOf = (clusterName: string) =>
  useFavoritesStore.getState().clusters[clusterName]?.recents;

const rehydrateWith = async (value: string) => {
  localStorage.setItem(FAVORITES_STORAGE_KEY, value);
  await useFavoritesStore.persist.rehydrate();
};

describe('useFavorites store', () => {
  beforeEach(() => {
    localStorage.clear();
    useFavoritesStore.setState({ clusters: {} });
  });

  describe('toggleFavorite', () => {
    it('adds items in insertion order and removes them on second toggle', () => {
      toggleFavorite(cluster, topic('orders'));
      toggleFavorite(cluster, group('billing'));
      toggleFavorite(cluster, topic('payments'));

      expect(favoritesOf(cluster)).toEqual([
        topic('orders'),
        group('billing'),
        topic('payments'),
      ]);

      toggleFavorite(cluster, topic('orders'));
      expect(favoritesOf(cluster)).toEqual([
        group('billing'),
        topic('payments'),
      ]);
    });

    it('treats the same name with a different type as a different item', () => {
      toggleFavorite(cluster, topic('orders'));
      toggleFavorite(cluster, group('orders'));

      expect(favoritesOf(cluster)).toEqual([topic('orders'), group('orders')]);
    });

    it('only stores the item type and name', () => {
      toggleFavorite(cluster, {
        ...topic('orders'),
        extra: true,
      } as FavoriteItem);

      expect(favoritesOf(cluster)).toEqual([topic('orders')]);
    });

    it('persists favorites to localStorage under a versioned key', () => {
      toggleFavorite(cluster, topic('orders'));

      const stored = JSON.parse(
        localStorage.getItem(FAVORITES_STORAGE_KEY) as string
      );
      expect(stored.version).toBe(FAVORITES_STORAGE_VERSION);
      expect(stored.state.clusters[cluster].favorites).toEqual([
        topic('orders'),
      ]);
    });
  });

  it('removeFavorite removes only the given item', () => {
    toggleFavorite(cluster, topic('orders'));
    toggleFavorite(cluster, topic('payments'));

    removeFavorite(cluster, topic('orders'));
    removeFavorite(cluster, topic('missing'));

    expect(favoritesOf(cluster)).toEqual([topic('payments')]);
  });

  describe('recordVisit', () => {
    it('keeps the most recent visit first without duplicates', () => {
      recordVisit(cluster, topic('orders'));
      recordVisit(cluster, group('billing'));
      recordVisit(cluster, topic('orders'));

      expect(recentsOf(cluster)).toEqual([topic('orders'), group('billing')]);
    });

    it(`caps recents at ${MAX_RECENTS} items per cluster`, () => {
      Array.from({ length: MAX_RECENTS + 3 }, (_, index) =>
        recordVisit(cluster, topic(`topic-${index}`))
      );

      const recents = recentsOf(cluster);
      expect(recents).toHaveLength(MAX_RECENTS);
      expect(recents?.[0]).toEqual(topic(`topic-${MAX_RECENTS + 2}`));
      expect(recents).not.toContainEqual(topic('topic-0'));
    });

    it('does not touch favorites', () => {
      toggleFavorite(cluster, topic('orders'));
      const { favorites } = useFavoritesStore.getState().clusters[cluster];

      recordVisit(cluster, topic('payments'));

      expect(useFavoritesStore.getState().clusters[cluster].favorites).toBe(
        favorites
      );
    });
  });

  it('isolates favorites and recents per cluster', () => {
    toggleFavorite(cluster, topic('orders'));
    recordVisit(cluster, topic('orders'));
    recordVisit(otherCluster, group('billing'));

    expect(favoritesOf(cluster)).toEqual([topic('orders')]);
    expect(favoritesOf(otherCluster)).toEqual([]);
    expect(recentsOf(cluster)).toEqual([topic('orders')]);
    expect(recentsOf(otherCluster)).toEqual([group('billing')]);
  });

  describe('selector hooks', () => {
    it('useIsFavorite reflects the toggle state for a single item', () => {
      const { result } = renderHook(() =>
        useIsFavorite(cluster, topic('orders'))
      );
      expect(result.current).toBe(false);

      act(() => toggleFavorite(cluster, topic('orders')));
      expect(result.current).toBe(true);

      act(() => toggleFavorite(otherCluster, topic('orders')));
      act(() => toggleFavorite(cluster, topic('orders')));
      expect(result.current).toBe(false);
    });

    it('useIsFavorite does not re-render for unrelated changes', () => {
      let renders = 0;
      renderHook(() => {
        renders += 1;
        return useIsFavorite(cluster, topic('orders'));
      });
      const initialRenders = renders;

      act(() => toggleFavorite(cluster, topic('payments')));
      act(() => recordVisit(cluster, topic('orders')));

      expect(renders).toBe(initialRenders);
    });

    it('useClusterFavorites filters by type and useClusterRecents returns recents', () => {
      toggleFavorite(cluster, topic('orders'));
      toggleFavorite(cluster, group('billing'));
      recordVisit(cluster, group('billing'));

      const { result } = renderHook(() => ({
        topics: useClusterFavorites(cluster, 'topic'),
        all: useClusterFavorites(cluster),
        recents: useClusterRecents(cluster),
        unknown: useClusterRecents('unknown-cluster'),
      }));

      expect(result.current.topics).toEqual([topic('orders')]);
      expect(result.current.all).toEqual([topic('orders'), group('billing')]);
      expect(result.current.recents).toEqual([group('billing')]);
      expect(result.current.unknown).toEqual([]);
    });
  });

  describe('corrupted persisted state', () => {
    it('ignores non-array lists and invalid items when rehydrating', async () => {
      await rehydrateWith(
        JSON.stringify({
          version: FAVORITES_STORAGE_VERSION,
          state: {
            clusters: {
              [cluster]: {
                favorites: 'not-an-array',
                recents: [
                  null,
                  42,
                  { type: 'schema', name: 'nope' },
                  { type: 'topic', name: '' },
                  topic('orders'),
                  topic('orders'),
                ],
              },
              [otherCluster]: 'garbage',
            },
          },
        })
      );

      expect(favoritesOf(cluster)).toEqual([]);
      expect(recentsOf(cluster)).toEqual([topic('orders')]);
      expect(favoritesOf(otherCluster)).toEqual([]);

      toggleFavorite(otherCluster, topic('payments'));
      expect(favoritesOf(otherCluster)).toEqual([topic('payments')]);
    });

    it('falls back to empty state when clusters is not an object', async () => {
      await rehydrateWith(
        JSON.stringify({
          version: FAVORITES_STORAGE_VERSION,
          state: { clusters: ['oops'] },
        })
      );

      expect(useFavoritesStore.getState().clusters).toEqual({});
      recordVisit(cluster, topic('orders'));
      expect(recentsOf(cluster)).toEqual([topic('orders')]);
    });

    it('survives unparsable JSON in storage', async () => {
      await rehydrateWith('{not json');

      expect(useFavoritesStore.getState().clusters).toEqual({});
      toggleFavorite(cluster, topic('orders'));
      expect(favoritesOf(cluster)).toEqual([topic('orders')]);
    });

    it('sanitizes state stored under an older version', async () => {
      await rehydrateWith(
        JSON.stringify({
          version: 0,
          state: {
            clusters: { [cluster]: { favorites: [topic('orders'), 'bad'] } },
          },
        })
      );

      expect(favoritesOf(cluster)).toEqual([topic('orders')]);
      expect(recentsOf(cluster)).toEqual([]);
    });

    it('selectors and actions tolerate corrupted in-memory state', () => {
      useFavoritesStore.setState({
        clusters: {
          [cluster]: { favorites: 'bad', recents: { 0: 'bad' } },
        } as never,
      });

      const { result } = renderHook(() => ({
        isFavorite: useIsFavorite(cluster, topic('orders')),
        favorites: useClusterFavorites(cluster),
        recents: useClusterRecents(cluster),
      }));
      expect(result.current).toEqual({
        isFavorite: false,
        favorites: [],
        recents: [],
      });

      act(() => {
        toggleFavorite(cluster, topic('orders'));
        recordVisit(cluster, topic('orders'));
      });
      expect(favoritesOf(cluster)).toEqual([topic('orders')]);
      expect(recentsOf(cluster)).toEqual([topic('orders')]);
    });
  });

  it('builds paths for favorite items', () => {
    expect(getFavoriteItemPath(cluster, topic('orders'))).toBe(
      '/ui/clusters/local/all-topics/orders'
    );
    expect(getFavoriteItemPath(cluster, group('team/billing'))).toBe(
      '/ui/clusters/local/consumer-groups/team%2Fbilling'
    );
  });
});
