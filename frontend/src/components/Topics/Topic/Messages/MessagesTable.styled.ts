import { Table } from 'components/common/table/Table/Table.styled';
import styled from 'styled-components';

export const TableViewport = styled.div`
  position: relative;
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-x: contain;
`;

export const ResizableTable = styled(Table)<{ $width: number }>`
  width: ${({ $width }) => `${$width}px`};
  min-width: 100%;
  table-layout: fixed;

  & td {
    min-width: 0;
    max-width: none;
    overflow: hidden;
  }
`;

export const ScanToolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 16px 4px;
`;

export const ScanStatus = styled.span`
  flex: 1 1 320px;
  min-width: 0;
  color: ${({ theme }) => theme.metrics.filters.color.normal};
  font-size: 14px;
  line-height: 20px;
`;

export const ScanActions = styled.div`
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
`;
