import React from 'react';
import {
  FavoriteItemType,
  getFavoriteItemPath,
  useClusterFavorites,
} from 'lib/hooks/useFavorites';

import * as S from './FavoritesBar.styled';

export interface FavoritesBarProps {
  clusterName: string;
  type: FavoriteItemType;
}

const NAV_LABELS: Record<FavoriteItemType, string> = {
  topic: 'Favorite topics',
  consumerGroup: 'Favorite consumer groups',
};

const FavoritesBar: React.FC<FavoritesBarProps> = ({ clusterName, type }) => {
  const favorites = useClusterFavorites(clusterName, type);

  if (favorites.length === 0) {
    return null;
  }

  return (
    <S.Wrapper aria-label={NAV_LABELS[type]}>
      <S.Label>Favorites</S.Label>
      <S.List>
        {favorites.map((item) => (
          <li key={item.name}>
            <S.Chip
              to={getFavoriteItemPath(clusterName, item)}
              title={item.name}
            >
              <S.Star aria-hidden="true">★</S.Star>
              <S.Name>{item.name}</S.Name>
            </S.Chip>
          </li>
        ))}
      </S.List>
    </S.Wrapper>
  );
};

export default FavoritesBar;
