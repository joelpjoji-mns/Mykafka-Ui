import React, { useEffect, useMemo } from 'react';
import {
  FAVORITE_TYPE_LABELS,
  FavoriteItem,
  getFavoriteItemPath,
  isSameFavoriteItem,
  useClusterFavorites,
  useClusterRecents,
} from 'lib/hooks/useFavorites';

import * as S from './CommandPalette.styled';
import CommandPaletteList, {
  PaletteItem,
  PaletteSection,
} from './CommandPaletteList';

interface CommandPaletteQuickAccessProps {
  clusterName: string;
  highlightIndex: number;
  onItems: (items: PaletteItem[]) => void;
  onSelect: (to: string) => void;
}

const CommandPaletteQuickAccess: React.FC<CommandPaletteQuickAccessProps> = ({
  clusterName,
  highlightIndex,
  onItems,
  onSelect,
}) => {
  const favorites = useClusterFavorites(clusterName);
  const recents = useClusterRecents(clusterName);

  const sections = useMemo<PaletteSection[]>(() => {
    const toPaletteItem = (item: FavoriteItem): PaletteItem => ({
      type: FAVORITE_TYPE_LABELS[item.type],
      label: item.name,
      to: getFavoriteItemPath(clusterName, item),
    });

    return [
      { title: 'Favorites', items: favorites.map(toPaletteItem) },
      {
        title: 'Recently visited',
        items: recents
          .filter(
            (recent) =>
              !favorites.some((favorite) =>
                isSameFavoriteItem(favorite, recent)
              )
          )
          .map(toPaletteItem),
      },
    ].filter((section) => section.items.length > 0);
  }, [clusterName, favorites, recents]);

  const items = useMemo(
    () => sections.flatMap((section) => section.items),
    [sections]
  );

  useEffect(() => {
    onItems(items);
  }, [items, onItems]);

  if (items.length === 0) {
    return (
      <S.Message>
        Type to search across this cluster. Press Esc to close.
      </S.Message>
    );
  }

  return (
    <CommandPaletteList
      label="Favorites and recently visited"
      sections={sections}
      highlightIndex={highlightIndex}
      onSelect={onSelect}
    />
  );
};

export default CommandPaletteQuickAccess;
