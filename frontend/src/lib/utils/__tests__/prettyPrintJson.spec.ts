import { prettyPrintJson } from 'lib/utils/prettyPrintJson';

describe('prettyPrintJson', () => {
  it('pretty prints valid JSON with tabs by default', () => {
    expect(prettyPrintJson('{"type":"record","fields":[]}')).toBe(
      '{\n\t"type": "record",\n\t"fields": []\n}'
    );
  });

  it('returns malformed input unchanged', () => {
    expect(prettyPrintJson('{"type": "record"')).toBe('{"type": "record"');
    expect(prettyPrintJson('syntax = "proto3";')).toBe('syntax = "proto3";');
  });
});
