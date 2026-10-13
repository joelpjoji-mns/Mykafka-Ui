import styled from 'styled-components';
import Input from 'components/common/Input/Input';

export const Container = styled.section`
  padding: 24px 16px;

  h2 {
    margin-bottom: 8px;
  }

  p {
    margin: 12px 0;
  }
`;

export const SearchRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin: 20px 0 16px;
`;

export const SearchField = styled.div`
  flex: 0 1 600px;
  width: 100%;
  min-width: 0;
`;

export const SearchInput = styled(Input)`
  height: 40px;
  font-size: 14px;
  padding: 0 12px;

  &::placeholder {
    font-size: 14px;
  }
`;

export const SearchError = styled.p`
  color: ${({ theme }) => theme.input.error};
`;
