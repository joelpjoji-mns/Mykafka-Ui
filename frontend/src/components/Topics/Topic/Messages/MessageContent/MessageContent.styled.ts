import styled, { css, keyframes } from 'styled-components';
import * as SEditorViewer from 'components/common/EditorViewer/EditorViewer.styled';
import { Link } from 'react-router-dom';

export const Wrapper = styled.tr`
  background-color: ${({ theme }) => theme.topicMetaData.backgroundColor};
  & > td {
    padding: 16px;
    &:first-child {
      padding-right: 1px;
    }
    &:last-child {
      padding-left: 1px;
    }
  }
`;

export const Section = styled.div`
  padding: 0 16px;
  display: flex;
  gap: 1px;
  align-items: stretch;
  min-width: 0;

  @media screen and (max-width: ${({ theme }) => theme.breakpoints.S}px) {
    flex-direction: column;
  }
`;

export const ContentBox = styled.div`
  background-color: ${({ theme }) => theme.topicMetaData.backgroundColor};
  padding: 24px;
  border-radius: 8px 0 0 8px;
  flex-grow: 3;
  display: flex;
  flex-direction: column;
  & nav {
    padding-bottom: 16px;
  }
  ${SEditorViewer.Wrapper} {
    flex-grow: 1;
  }

  @media screen and (max-width: ${({ theme }) => theme.breakpoints.S}px) {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    border-radius: 8px 8px 0 0;
  }
`;
export const DataCell = styled.td`
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  width: 100%;
  min-width: 0;
  max-width: none;
`;
const liveMessageArrival = (backgroundColor: string) => keyframes`
  from {
    background-color: ${backgroundColor};
  }

  to {
    background-color: transparent;
  }
`;

export const ClickableRow = styled.tr<{
  $isLiveArrival?: boolean;
  $isSelected?: boolean;
  $isAnchor?: boolean;
}>`
  cursor: pointer;

  ${({ $isAnchor, theme }) =>
    $isAnchor &&
    css`
      & > td {
        background-color: ${theme.table.tr.backgroundColor.hover};
      }
    `}

  ${({ $isSelected, theme }) =>
    $isSelected &&
    css`
      & > td:first-child {
        box-shadow: inset 4px 0 0 ${theme.table.th.color.active};
      }
    `}

  ${({ $isLiveArrival, theme }) =>
    $isLiveArrival &&
    css`
      & > td {
        animation: ${liveMessageArrival(theme.table.tr.backgroundColor.hover)}
          560ms ease-out;
      }
    `}

  @media (prefers-reduced-motion: reduce) {
    & > td {
      animation: none;
    }
  }
`;
export const MetadataWrapper = styled.div`
  background-color: ${({ theme }) => theme.topicMetaData.backgroundColor};
  padding: 24px;
  border-radius: 0 8px 8px 0;
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 400px;

  @media screen and (max-width: ${({ theme }) => theme.breakpoints.S}px) {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    border-radius: 0 0 8px 8px;
  }
`;

export const Metadata = styled.span`
  display: flex;
  gap: 35px;
`;

export const MetadataLabel = styled.p`
  color: ${({ theme }) => theme.topicMetaData.color.label};
  font-size: 14px;
  width: 80px;
`;

export const MetadataValue = styled.div`
  color: ${({ theme }) => theme.topicMetaData.color.value};
  font-size: 14px;
`;

export const MetadataMeta = styled.p`
  color: ${({ theme }) => theme.topicMetaData.color.meta};
  font-size: 12px;
`;

export const Tab = styled.button<{ $active?: boolean }>(
  ({ theme, $active }) => css`
    background-color: ${
      theme.secondaryTab.backgroundColor[$active ? 'active' : 'normal']
    };
    color: ${theme.secondaryTab.color[$active ? 'active' : 'normal']};
    padding: 6px 16px;
    height: 32px;
    border: 1px solid ${theme.layout.stuffBorderColor};
    cursor: pointer;
    &:hover {
      background-color: ${theme.secondaryTab.backgroundColor.hover};
      color: ${theme.secondaryTab.color.hover};
    }
    &:first-child {
      border-radius: 4px 0 0 4px;
    }
    &:last-child {
      border-radius: 0 4px 4px 0;
    }
    &:not(:last-child) {
      border-right: 0;
    }
  `
);

export const SchemaLink = styled(Link)`
  cursor: pointer;
  color: ${({ theme }) => theme.link.color};

  &:hover {
    color: ${({ theme }) => theme.link.hoverColor};
  }
`;

export const Tabs = styled.nav``;

export const Toolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 16px;
  && nav {
    padding-bottom: 0;
  }

  @media screen and (max-width: ${({ theme }) => theme.breakpoints.S}px) {
    align-items: stretch;
  }
`;

export const ToolbarActions = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
`;
