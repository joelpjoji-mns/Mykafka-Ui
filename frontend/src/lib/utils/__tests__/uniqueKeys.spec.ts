import { uniqueKeys } from 'lib/utils/uniqueKeys';

describe('uniqueKeys', () => {
  it('keeps unique keys and suffixes repeated ones', () => {
    expect(uniqueKeys(['a', 'b', 'a', 'a', 'c'])).toEqual([
      'a',
      'b',
      'a-1',
      'a-2',
      'c',
    ]);
  });
});
