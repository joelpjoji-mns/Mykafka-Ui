import styled from 'styled-components';

export const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  background-color: rgba(0, 0, 0, 0.35);
`;

export const Panel = styled.div`
  width: min(640px, 92vw);
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 10px;
  border: 1px solid ${({ theme }) => theme.modal.border.contrast};
  background-color: ${({ theme }) => theme.modal.backgroundColor};
  color: ${({ theme }) => theme.default.color.normal};
  box-shadow: ${({ theme }) => theme.effects.transientShadow};
  backdrop-filter: ${({ theme }) => theme.effects.transientBackdropFilter};
  -webkit-backdrop-filter: ${({ theme }) =>
    theme.effects.transientBackdropFilter};

  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
`;

export const SearchInput = styled.input`
  border: none;
  outline: none;
  padding: 16px 18px;
  font-size: 16px;
  background-color: transparent;
  color: ${({ theme }) => theme.default.color.normal};
  border-bottom: 1px solid ${({ theme }) => theme.modal.border.contrast};

  &::placeholder {
    color: ${({ theme }) => theme.input.label.color};
  }
`;

export const ResultsList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
`;

export const Section = styled.li`
  & + & {
    margin-top: 4px;
  }
`;

export const SectionTitle = styled.div`
  padding: 8px 12px 4px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.input.label.color};
`;

export const SectionList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
`;

export const ResultRow = styled.li<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  background-color: ${({ $active }) =>
    $active ? 'rgba(127, 127, 127, 0.18)' : 'transparent'};

  &:hover {
    background-color: rgba(127, 127, 127, 0.18);
  }
`;

export const TypeBadge = styled.span`
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid ${({ theme }) => theme.modal.border.contrast};
  color: ${({ theme }) => theme.input.label.color};
`;

export const ItemLabel = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const Message = styled.div`
  padding: 16px 18px;
  font-size: 14px;
  color: ${({ theme }) => theme.input.label.color};
`;
