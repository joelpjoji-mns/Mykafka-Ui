import React from 'react';
import Editor from 'components/common/Editor/Editor';
import { SchemaType } from 'generated-sources';
import { parse, stringify } from 'lossless-json';
import HighlightedText, {
  getSearchMatches,
} from 'components/common/HighlightedText/HighlightedText';

import * as S from './EditorViewer.styled';

export interface EditorViewerProps {
  data: string;
  schemaType?: string;
  maxLines?: number;
  searchTerms?: string[];
}
const getSchemaValue = (data: string, schemaType?: string) => {
  if (schemaType === SchemaType.JSON || schemaType === SchemaType.AVRO) {
    return stringify(parse(data), undefined, '\t');
  }
  return data;
};
const EditorViewer: React.FC<EditorViewerProps> = ({
  data,
  schemaType,
  maxLines,
  searchTerms = [],
}) => {
  try {
    const value = getSchemaValue(data, schemaType) || '';
    const position = (index: number) => {
      const prefix = value.slice(0, index);
      return {
        row: prefix.split('\n').length - 1,
        col: index - prefix.lastIndexOf('\n') - 1,
      };
    };
    const markers = getSearchMatches(value, searchTerms).map(
      ({ start, end }) => {
        const from = position(start);
        const to = position(end);
        return {
          startRow: from.row,
          startCol: from.col,
          endRow: to.row,
          endCol: to.col,
          className: 'message-search-match',
          type: 'text' as const,
        };
      }
    );
    return (
      <S.Wrapper>
        <Editor
          isFixedHeight
          schemaType={schemaType}
          name="schema"
          value={value}
          markers={markers}
          setOptions={{
            showLineNumbers: false,
            maxLines,
            showGutter: false,
          }}
          readOnly
        />
      </S.Wrapper>
    );
  } catch {
    return (
      <S.Wrapper>
        <p>
          <HighlightedText text={data} terms={searchTerms} />
        </p>
      </S.Wrapper>
    );
  }
};

export default EditorViewer;
