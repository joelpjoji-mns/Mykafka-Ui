import styled from 'styled-components';

export const Wrapper = styled.div`
  background-color: ${({ theme }) => theme.viewer.wrapper.backgroundColor};
  padding: 8px 16px;
  .message-search-match {
    position: absolute;
    background: rgba(255, 202, 40, 0.4);
    border-bottom: 2px solid #b8860b;
  }
  .ace_active-line {
    background-color: ${({ theme }) =>
      theme.default.backgroundColor} !important;
  }
  .ace_line {
    color: ${({ theme }) => theme.viewer.wrapper.color} !important;
  }
`;
