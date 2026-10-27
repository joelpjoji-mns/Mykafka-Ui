import React from 'react';
import {
  FavoriteItemType,
  useFavoritesStore,
  useIsFavorite,
} from 'lib/hooks/useFavorites';

import * as S from './FavoriteToggle.styled';

export interface FavoriteToggleProps {
  clusterName: string;
  type: FavoriteItemType;
  name: string;
  size?: S.FavoriteToggleSize;
}

const FavoriteToggle: React.FC<FavoriteToggleProps> = ({
  clusterName,
  type,
  name,
  size = 'M',
}) => {
  const isFavorite = useIsFavorite(clusterName, { type, name });
  const toggleFavorite = useFavoritesStore((state) => state.toggleFavorite);
  const label = isFavorite
    ? `Remove ${name} from favorites`
    : `Add ${name} to favorites`;

  // The toggle is rendered inside links and clickable table rows, so the
  // click must not navigate or bubble up to row handlers.
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    toggleFavorite(clusterName, { type, name });
  };

  return (
    <S.Button
      type="button"
      aria-pressed={isFavorite}
      aria-label={label}
      title={label}
      $active={isFavorite}
      $size={size}
      onClick={handleClick}
    >
      <span aria-hidden="true">{isFavorite ? '★' : '☆'}</span>
    </S.Button>
  );
};

export default FavoriteToggle;
