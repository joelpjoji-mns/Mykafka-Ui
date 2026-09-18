import styled from 'styled-components';
import { NavLink } from 'react-router-dom';

export const Breadcrumbs = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: flex-start;
  min-width: 0;
  text-align: left;

  & h1 {
    min-width: 0;
    overflow-wrap: anywhere;
  }
`;

export const BackLink = styled(NavLink)`
  color: ${({ theme }) => theme.pageHeading.backLink.color.normal};
  position: relative;

  &:hover {
    ${({ theme }) => theme.pageHeading.backLink.color.hover};
  }

  &::after {
    content: '';
    position: absolute;
    right: -11px;
    bottom: 2px;
    border-left: 1px solid ${({ theme }) => theme.pageHeading.dividerColor};
    height: 20px;
    transform: rotate(14deg);
  }
`;

export const Wrapper = styled.div`
  padding: 16px;
  min-width: 0;
`;

export const Content = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  min-width: 0;

  & > div {
    display: flex;
    gap: 16px;
    min-width: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  & > ${Breadcrumbs} {
    flex: 1 1 240px;
    gap: 20px;
  }

  @media screen and (max-width: ${({ theme }) => theme.breakpoints.S}px) {
    align-items: stretch;

    & > ${Breadcrumbs}, & > div {
      flex-basis: 100%;
      width: 100%;
    }

    & > div {
      justify-content: flex-start;

      & > * {
        min-width: 0;
      }
    }

    & > ${Breadcrumbs} {
      gap: 12px;
      flex-wrap: wrap;
    }
  }
`;

export const Title = styled.div`
  color: ${({ theme }) => theme.pageHeading.title.color};
  font-weight: 500;
  line-height: 8px;
  & + ${Content} h1 {
    padding-top: 8px;
    line-height: 24px;
  }
`;
