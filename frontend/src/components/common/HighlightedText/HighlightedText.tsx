import React from 'react';
import styled from 'styled-components';

export const getSearchMatches = (text: string, terms: string[]) => {
  const escaped = [...new Set(terms.filter(Boolean))]
    .sort((left, right) => right.length - left.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escaped.length === 0) return [];
  return [...text.matchAll(new RegExp(escaped.join('|'), 'g'))].map(
    (match) => ({ start: match.index, end: match.index + match[0].length })
  );
};

const Match = styled.mark`
  background: #ffda66;
  color: #171717;
  border-radius: 2px;
`;

const HighlightedText: React.FC<{ text: string; terms: string[] }> = ({
  text,
  terms,
}) => {
  const matches = getSearchMatches(text, terms);
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
