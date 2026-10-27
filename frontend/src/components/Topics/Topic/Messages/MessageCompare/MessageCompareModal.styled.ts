import styled, { css } from 'styled-components';

export const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

export const MetadataTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  color: ${({ theme }) => theme.table.td.color.normal};

  th,
  td {
    padding: 6px 8px;
    text-align: left;
    border-top: 1px solid ${({ theme }) => theme.table.td.borderTop};
    word-break: break-word;
  }

  th {
    color: ${({ theme }) => theme.table.th.color.normal};
    font-weight: 500;
  }
`;

export const MetadataRow = styled.tr<{ $differs: boolean }>`
  ${({ $differs, theme }) =>
    $differs &&
    css`
      & > td {
        background-color: ${theme.table.tr.backgroundColor.hover};
        font-weight: 500;
      }
    `}
`;

export const FieldTabs = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

export const Summary = styled.p`
  margin: 0;
  color: ${({ theme }) => theme.metrics.filters.color.normal};
  font-size: 14px;
`;
