import styled, { css } from 'styled-components';
import { Link } from 'react-router-dom';

export const Page = styled.div`
  min-width: 0;
  padding: 0 16px 24px;
`;

export const Controls = styled.section`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;

  @media screen and (max-width: ${({ theme }) => theme.breakpoints.M}px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media screen and (max-width: ${({ theme }) => theme.breakpoints.S}px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

export const FilterLabel = styled.label`
  display: grid;
  gap: 6px;
  min-width: 0;
  color: ${({ theme }) => theme.default.color.normal};
  font-size: 13px;
  font-weight: 500;
`;

const controlStyles = css`
  width: 100%;
  min-width: 0;
  min-height: 36px;
  border: 1px solid ${({ theme }) => theme.layout.stuffBorderColor};
  border-radius: 3px;
  background: ${({ theme }) => theme.default.backgroundColor};
  color: ${({ theme }) => theme.default.color.normal};
  font: inherit;
  padding: 7px 9px;

  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.link.color};
    outline-offset: 1px;
  }
`;

export const FilterInput = styled.input`
  ${controlStyles}
`;

export const FilterSelect = styled.select`
  ${controlStyles}
`;

export const Actions = styled.div`
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`;

export const Notice = styled.p`
  margin: 0 0 16px;
  border-left: 3px solid
    ${({ theme }) => theme.metrics.indicator.warningTextColor};
  padding: 10px 12px;
  background: ${({ theme }) => theme.layout.stuffColor};
  color: ${({ theme }) => theme.default.color.normal};
  font-size: 13px;
`;

export const Unavailable = styled.section`
  border: 1px solid ${({ theme }) => theme.layout.stuffBorderColor};
  padding: 20px;
  color: ${({ theme }) => theme.default.color.normal};

  h2 {
    margin: 0 0 8px;
    font-size: 18px;
  }

  p {
    margin: 0;
    font-size: 14px;
  }
`;

export const Evidence = styled.section`
  min-width: 0;
`;

export const EvidenceHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
`;

export const EvidenceTitle = styled.h2`
  margin: 0;
  color: ${({ theme }) => theme.default.color.normal};
  font-size: 18px;
  font-weight: 600;
`;

export const PageState = styled.span`
  color: ${({ theme }) => theme.default.color.normal};
  font-size: 13px;
  opacity: 0.75;
`;

export const TableViewport = styled.div`
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid ${({ theme }) => theme.layout.stuffBorderColor};
`;

export const Table = styled.table`
  width: 100%;
  min-width: 860px;
  border-collapse: collapse;
  color: ${({ theme }) => theme.table.td.color.normal};
  font-size: 13px;

  th,
  td {
    padding: 10px 12px;
    border-bottom: 1px solid ${({ theme }) => theme.table.td.borderTop};
    text-align: left;
    vertical-align: top;
  }

  th {
    color: ${({ theme }) => theme.table.th.color.normal};
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
  }

  tbody tr:last-child td {
    border-bottom: 0;
  }
`;

export const ResourceList = styled.div`
  display: grid;
  gap: 5px;
  min-width: 180px;
`;

export const ResourceRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
`;

export const ResourceLink = styled(Link)`
  color: ${({ theme }) => theme.link.color};
  font-weight: 500;

  &:hover {
    color: ${({ theme }) => theme.link.hoverColor};
  }
`;

export const ResourceName = styled.span`
  color: ${({ theme }) => theme.default.color.normal};
  font-weight: 500;
`;

export const Access = styled.span`
  color: ${({ theme }) => theme.default.color.normal};
  font-size: 12px;
  opacity: 0.72;
`;

export const Outcome = styled.span<{ $failed: boolean }>(
  ({ theme, $failed }) => css`
    color: ${
      $failed
        ? theme.metrics.indicator.warningTextColor
        : theme.circularAlert.color.success
    };
    font-size: 12px;
    font-weight: 600;
  `
);

export const Empty = styled.p`
  margin: 0;
  padding: 18px;
  color: ${({ theme }) => theme.default.color.normal};
  font-size: 13px;
  opacity: 0.75;
`;

export const Pagination = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
`;
