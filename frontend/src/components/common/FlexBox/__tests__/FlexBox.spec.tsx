import React from 'react';
import { screen } from '@testing-library/react';
import { render } from 'lib/testHelpers';
import FlexBox from 'components/common/FlexBox/FlexBox';

describe('FlexBox layout', () => {
  it('applies wrapping so search and export controls fit narrow screens', () => {
    render(
      <FlexBox flexWrap="wrap" color="#FFFFFF">
        <span>Search controls</span>
      </FlexBox>
    );

    expect(screen.getByText('Search controls').parentElement).toHaveStyle({
      display: 'flex',
      flexWrap: 'wrap',
      color: '#FFFFFF',
    });
  });
});
