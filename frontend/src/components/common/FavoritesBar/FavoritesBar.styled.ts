import styled from 'styled-components';
import { Link } from 'react-router-dom';

export const Wrapper = styled.nav`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 16px;
  margin: 0 0 16px;
  min-width: 0;
  font-size: 12px;
`;

export const Label = styled.span`
  font-weight: 500;
  color: ${({ theme }) => theme.input.label.color};
`;

export const List = styled.ul`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
`;

export const Chip = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 280px;
  padding: 0 10px;
  border-radius: 16px;
  line-height: 22px;
  background-color: ${({ theme }) => theme.chips.backgroundColor.normal};
  color: ${({ theme }) => theme.chips.color.normal};

  &:hover {
    background-color: ${({ theme }) => theme.chips.backgroundColor.hover};
    color: ${({ theme }) => theme.chips.color.hover};
  }

  &:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 1px;
  }
`;

export const Star = styled.span`
  color: ${({ theme }) => theme.icons.warningIcon};
`;

export const Name = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
