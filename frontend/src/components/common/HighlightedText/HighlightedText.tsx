import React from 'react';
import styled from 'styled-components';

const buildSearchPattern = (terms: string[]) => {
  const escaped = [...new Set(terms.filter(Boolean))]
    .sort((left, right) => right.length - left.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return escaped.length === 0 ? undefined : new RegExp(escaped.join('|'), 'g');
};

// matchAll clones the pattern, so a shared global RegExp is safe to reuse.
const findMatches = (text: string, pattern: RegExp | undefined) =>
  pattern
    ? [...text.matchAll(pattern)].map((match) => ({
        start: match.index,
        end: match.index + match[0].length,
      }))
    : [];

export const getSearchMatches = (text: string, terms: string[]) =>
  findMatches(text, buildSearchPattern(terms));

const Match = styled.mark`
  background: #ffda66;
  color: #171717;
  border-radius: 2px;
`;

const HighlightedText: React.FC<{ text: string; terms: string[] }> = ({
  text,
  terms,
}) => {
  const pattern = React.useMemo(() => buildSearchPattern(terms), [terms]);
  const matches = React.useMemo(
    () => findMatches(text, pattern),
    [text, pattern]
  );
  let previousEnd = 0;
  return (
    <>
      {matches.map(({ start, end }) => {
        const prefix = text.slice(previousEnd, start);
        previousEnd = end;
        return (
          <React.Fragment key={start}>
            {prefix}
            <Match>{text.slice(start, end)}</Match>
          </React.Fragment>
        );
      })}
      {text.slice(previousEnd)}
    </>
  );
};

export default HighlightedText;
