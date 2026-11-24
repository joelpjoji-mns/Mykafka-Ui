import React from 'react';
import { SpinnerProps } from 'components/common/Spinner/types';

import * as S from './Spinner.styled';

const Spinner: React.FC<SpinnerProps> = ({
  size = 80,
  borderWidth = 10,
  emptyBorderColor = false,
  marginLeft = 0,
}) => (
  <S.Spinner
    role="progressbar"
    size={size}
    borderWidth={borderWidth}
    emptyBorderColor={emptyBorderColor}
    marginLeft={marginLeft}
  />
);

export default Spinner;
