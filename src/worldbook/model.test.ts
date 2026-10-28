import { describe, expect, it } from 'vitest';
import { entryDefaults, importImageWorldBook, parseEntry } from './model';

describe('ST worldbook role compatibility', () => {
  it.each([undefined, null, 0, 1, 2])('accepts the native role value %s', role => {
    const entry = parseEntry({ ...entryDefaults(0), content: 'drawing reference', role }, 0);
    expect(entry.role).toBe(role ?? 0);
  });

  it.each([-1, 3, 'system', '0', false])('still rejects an invalid role %s', role => {
    expect(() => parseEntry({ ...entryDefaults(0), content: 'drawing reference', role }, 0)).toThrow(/role/);
  });

  it('imports a native book with nullable roles and optional matching settings', () => {
    const document = {
      entries: Object.fromEntries(Array.from({ length: 35 }, (_, uid) => [uid, {
        ...entryDefaults(uid), content: `reference ${uid}`, role: null,
        caseSensitive: null, matchWholeWords: null, scanDepth: null, useGroupScoring: null,
      }])),
    };
    const book = importImageWorldBook(JSON.stringify(document), 'native.json');
    expect(Object.keys(book.document.entries)).toHaveLength(35);
    expect(Object.values(book.document.entries).every(entry => entry.role === 0)).toBe(true);
    expect(book.document.entries['0']).toMatchObject({
      caseSensitive: null, matchWholeWords: null, scanDepth: null, useGroupScoring: null,
    });
    expect(document.entries[0].role).toBeNull();
  });
});
