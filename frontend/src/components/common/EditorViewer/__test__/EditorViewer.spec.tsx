import React from 'react';
import EditorViewer, {
  EditorViewerProps,
} from 'components/common/EditorViewer/EditorViewer';
import { render } from 'lib/testHelpers';
import { screen } from '@testing-library/react';
import { edit } from 'ace-builds';

const data = { a: 1 };
const maxLines = 28;
const schemaType = 'JSON';

describe('EditorViewer component', () => {
  const setupComponent = (props: EditorViewerProps) =>
    render(<EditorViewer {...props} />);

  it('renders JSONTree', () => {
    setupComponent({
      data: JSON.stringify(data),
      maxLines,
      schemaType,
    });
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('to be in the document with fixed height with no value', () => {
    setupComponent({
      data: '',
      maxLines,
      schemaType,
    });
  });

  it('adds match markers to the expanded editor value', () => {
    const { container } = setupComponent({
      data: 'order-123\norder-123',
      searchTerms: ['order-123'],
    });
    const editor = container.querySelector('.ace_editor');
    expect(editor).toBeInstanceOf(HTMLElement);
    if (!(editor instanceof HTMLElement)) throw new Error('Missing editor');
    const markers = Object.values(edit(editor).session.getMarkers());
    expect(
      markers.filter((marker) => marker.clazz === 'message-search-match')
    ).toHaveLength(2);
  });

  it('highlights the plain-text fallback for invalid JSON', () => {
    const { container } = setupComponent({
      data: 'invalid order-123',
      schemaType,
      searchTerms: ['order-123'],
    });
    expect(container.querySelector('mark')).toHaveTextContent('order-123');
  });
});
