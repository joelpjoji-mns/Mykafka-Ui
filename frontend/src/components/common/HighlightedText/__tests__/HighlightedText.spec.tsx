import React from 'react';
import { render } from 'lib/testHelpers';
import HighlightedText, {
  getSearchMatches,
} from 'components/common/HighlightedText/HighlightedText';

describe('search highlighting', () => {
  it('highlights literal special characters and repeated terms without changing the value', () => {
    const { container } = render(
      <HighlightedText
        text="a.b [id] a.b <script>"
        terms={['a.b', '[id]', '<script>', 'a.b']}
      />
    );
    expect(container).toHaveTextContent('a.b [id] a.b <script>');
    expect(
      [...container.querySelectorAll('mark')].map((mark) => mark.textContent)
    ).toEqual(['a.b', '[id]', 'a.b', '<script>']);
    expect(container.querySelector('script')).toBeNull();
  });

  it('uses the longest match and preserves case-sensitive search semantics', () => {
    expect(
      getSearchMatches('order-123 ORDER-123', ['order', 'order-123', ''])
    ).toEqual([{ start: 0, end: 9 }]);
    expect(getSearchMatches('nothing', [])).toEqual([]);
  });
});
