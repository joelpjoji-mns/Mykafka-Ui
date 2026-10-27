import React from 'react';

import * as S from './CommandPalette.styled';

export interface PaletteItem {
  type: string;
  label: string;
  to: string;
}

export interface PaletteSection {
  title?: string;
  items: PaletteItem[];
}

interface CommandPaletteListProps {
  label: string;
  sections: PaletteSection[];
  highlightIndex: number;
  onSelect: (to: string) => void;
}

// Renders palette items as a single listbox. Indexes run across all sections
// so they line up with the flat `items` list used for keyboard navigation.
const CommandPaletteList: React.FC<CommandPaletteListProps> = ({
  label,
  sections,
  highlightIndex,
  onSelect,
}) => {
  const offsets = sections.reduce<number[]>(
    (acc, section, index) => [
      ...acc,
      index === 0 ? 0 : acc[index - 1] + sections[index - 1].items.length,
    ],
    []
  );

  const renderRows = (items: PaletteItem[], offset: number) =>
    items.map((item, itemIndex) => {
      const index = offset + itemIndex;
      return (
        <S.ResultRow
          key={`${item.type}-${item.label}`}
          role="option"
          aria-selected={index === highlightIndex}
          $active={index === highlightIndex}
          onClick={() => onSelect(item.to)}
        >
          <S.TypeBadge>{item.type}</S.TypeBadge>
          <S.ItemLabel>{item.label}</S.ItemLabel>
        </S.ResultRow>
      );
    });

  return (
    <S.ResultsList role="listbox" aria-label={label}>
      {sections.map((section, sectionIndex) =>
        section.title ? (
          <S.Section key={section.title} role="presentation">
            <S.SectionTitle aria-hidden="true">{section.title}</S.SectionTitle>
            <S.SectionList role="group" aria-label={section.title}>
              {renderRows(section.items, offsets[sectionIndex])}
            </S.SectionList>
          </S.Section>
        ) : (
          // eslint-disable-next-line react/no-array-index-key
          <React.Fragment key={sectionIndex}>
            {renderRows(section.items, offsets[sectionIndex])}
          </React.Fragment>
        )
      )}
    </S.ResultsList>
  );
};

export default CommandPaletteList;
