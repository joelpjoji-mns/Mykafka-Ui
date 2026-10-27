import { LOCAL_STORAGE_KEY_PREFIX } from 'lib/constants';
import {
  getMessageViewFilterSnapshot,
  saveMessageViewFilterSnapshot,
} from 'lib/messageViewFilterSnapshot';

const storageKey = `${LOCAL_STORAGE_KEY_PREFIX}-message-view-filter-snapshots`;

describe('messageViewFilterSnapshot', () => {
  beforeEach(() => sessionStorage.clear());

  it('does not mix up cluster and topic names containing colons', () => {
    saveMessageViewFilterSnapshot('a:b', 'c', new URLSearchParams('limit=1'));
    saveMessageViewFilterSnapshot('a', 'b:c', new URLSearchParams('limit=2'));

    expect(getMessageViewFilterSnapshot('a:b', 'c')?.get('limit')).toBe('1');
    expect(getMessageViewFilterSnapshot('a', 'b:c')?.get('limit')).toBe('2');
  });

  it('reads snapshots stored with the legacy id format', () => {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ 'cluster:topic': 'mode=EARLIEST' })
    );

    expect(getMessageViewFilterSnapshot('cluster', 'topic')?.get('mode')).toBe(
      'EARLIEST'
    );

    saveMessageViewFilterSnapshot(
      'cluster',
      'topic',
      new URLSearchParams('mode=LATEST')
    );
    expect(getMessageViewFilterSnapshot('cluster', 'topic')?.get('mode')).toBe(
      'LATEST'
    );
    expect(
      JSON.parse(sessionStorage.getItem(storageKey) || '{}')
    ).not.toHaveProperty(['cluster:topic']);
  });

  it('keeps only the 50 most recently saved snapshots', () => {
    Array.from({ length: 55 }, (_, index) => index).forEach((index) =>
      saveMessageViewFilterSnapshot(
        'cluster',
        `topic-${index}`,
        new URLSearchParams(`limit=${index}`)
      )
    );
    // Saving an existing snapshot again marks it as most recent.
    saveMessageViewFilterSnapshot(
      'cluster',
      'topic-5',
      new URLSearchParams('limit=5')
    );
    saveMessageViewFilterSnapshot(
      'cluster',
      'topic-55',
      new URLSearchParams('limit=55')
    );

    const stored = JSON.parse(sessionStorage.getItem(storageKey) || '{}');
    expect(Object.keys(stored)).toHaveLength(50);
    expect(getMessageViewFilterSnapshot('cluster', 'topic-6')).toBeUndefined();
    expect(
      getMessageViewFilterSnapshot('cluster', 'topic-7')?.get('limit')
    ).toBe('7');
    expect(
      getMessageViewFilterSnapshot('cluster', 'topic-5')?.get('limit')
    ).toBe('5');
    expect(
      getMessageViewFilterSnapshot('cluster', 'topic-55')?.get('limit')
    ).toBe('55');
  });
});
