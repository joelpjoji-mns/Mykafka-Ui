import {
  SURROUNDING_MESSAGES_WINDOW,
  surroundingMessagesSearch,
} from 'lib/utils/surroundingMessages';

describe('surroundingMessagesSearch', () => {
  it('centres a window on the message in its partition and keeps serdes', () => {
    const params = surroundingMessagesSearch(
      { partition: 3, offset: 100 },
      new URLSearchParams(
        'keySerde=String&valueSerde=Avro&stringFilter=needle&orderBy=size&cursor=2'
      )
    );

    expect(Object.fromEntries(params)).toEqual({
      mode: 'FROM_OFFSET',
      offset: String(100 - SURROUNDING_MESSAGES_WINDOW),
      partitions: '3',
      limit: String(SURROUNDING_MESSAGES_WINDOW * 2 + 1),
      keySerde: 'String',
      valueSerde: 'Avro',
      anchor: '3:100',
    });
  });

  it('never seeks before offset zero', () => {
    const params = surroundingMessagesSearch(
      { partition: 0, offset: 4 },
      new URLSearchParams()
    );

    expect(params.get('offset')).toBe('0');
  });
});
