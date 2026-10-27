import styled from 'styled-components';

export type FavoriteToggleSize = 'S' | 'M';

export const Button = styled.button<{
  $active: boolean;
  $size: FavoriteToggleSize;
}>`
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 2px;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  line-height: 1;
  font-size: ${({ $size }) => ($size === 'S' ? '16px' : '20px')};
  color: ${({ theme, $active }) =>
    $active ? theme.icons.warningIcon : theme.input.icon.color};
  transition: color 0.15s ease-in-out;

  &:hover {
    color: ${({ theme }) => theme.icons.warningIcon};
  }

  &:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 1px;
  }
`;

export const WithFavoriteToggle = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  max-width: 100%;

  & > a {
    min-width: 0;
  }
`;
