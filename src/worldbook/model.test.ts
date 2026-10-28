import { describe, expect, it } from 'vitest';
import { entryDefaults, importImageWorldBook, parseEntry } from './model';
import { newWorldInfoEntryTemplate } from './vendor/entries';

describe('native worldbook field backfill', () => {
  it.each(Object.keys(newWorldInfoEntryTemplate))('backfills missing %s from the upstream template', field => {
    const raw: Record<string, unknown> = { ...entryDefaults(7) };
    delete raw[field];
    const entry = parseEntry(raw, 7);
    expect(entry[field]).toEqual(newWorldInfoEntryTemplate[field]);
    expect(Object.hasOwn(raw, field)).toBe(false);
  });

  it.each(['key', 'keysecondary'] as const)('repairs non-array %s exactly like the native editor', field => {
    for (const value of [null, undefined, '', 'forest', false, 0, {}]) {
      const raw = { content: 'reference', [field]: value };
      expect(parseEntry(raw, 0)[field]).toEqual([]);
      expect(raw[field]).toBe(value);
    }
  });

  it.each([null, undefined, false, '', 0, []])('repairs invalid characterFilter=%s', characterFilter => {
    const entry = parseEntry({ content: 'reference', characterFilter }, 0);
    expect(entry.characterFilter).toEqual({ isExclude: false, names: [], tags: [] });
  });

  it('retains valid character filters and unknown extension fields', () => {
    const raw = {
      content: 'reference', characterFilter: { names: ['alice'], tags: ['tag'], isExclude: true, custom: 1 },
      extensions: { custom: { value: 1 } },
    };
    expect(parseEntry(raw, 7)).toMatchObject(raw);
  });

  it('keeps independent arrays and objects for default entries', () => {
    const first = entryDefaults(0), second = entryDefaults(1);
    first.key.push('only-first');
    (first.characterFilter as { names: string[] }).names.push('alice');
    expect(second.key).toEqual([]);
    expect(second.characterFilter).toEqual({ isExclude: false, names: [], tags: [] });
    expect(newWorldInfoEntryTemplate.key).toEqual([]);
  });

  it.each([null, undefined, 0, 1, 2, 3])('accepts the native selective logic %s', selectiveLogic => {
    expect(parseEntry({ content: 'reference', selectiveLogic }, 0).selectiveLogic).toBe(selectiveLogic ?? 0);
  });

  it.each([null, undefined])('treats unset generation triggers %s as unrestricted', triggers => {
    expect(parseEntry({ content: 'reference', triggers }, 0).triggers).toEqual([]);
  });

  it('keeps intentional zero, false and nullable overrides', () => {
    const overrides = {
      content: '', key: [], selective: false, disable: false, constant: false,
      order: 0, depth: 0, role: 0, probability: 0, groupWeight: 0,
      useProbability: false, delayUntilRecursion: 0,
      scanDepth: null, caseSensitive: false, matchWholeWords: null, useGroupScoring: false,
      sticky: 0, cooldown: null, delay: 0,
    };
    expect(parseEntry(overrides, 0)).toMatchObject(overrides);
  });

  it('imports a minimal legacy book without modifying the source document', () => {
    const raw = { version: 1, entries: {
      '7': { content: 'reference', key: null, keysecondary: 'legacy', characterFilter: null },
      '8': {},
    } };
    const before = JSON.stringify(raw);
    const book = importImageWorldBook(before, 'legacy.json');
    expect(book.document.entries['7']).toMatchObject({
      uid: 7, key: [], keysecondary: [], characterFilter: { isExclude: false, names: [], tags: [] },
    });
    expect(book.document.entries['8']).toEqual(entryDefaults(8));
    expect(book.document.version).toBe(1);
    expect(JSON.stringify(raw)).toBe(before);
    expect(importImageWorldBook(JSON.stringify(book.document), 'roundtrip.json').document).toEqual(book.document);
  });

  it.each([
    null, [], 'text', { content: 7 }, { content: null }, { content: 'reference', key: [7] },
    { content: 'reference', characterFilter: { names: 'alice' } },
    { content: 'reference', position: 99 }, { content: 'reference', selectiveLogic: 9 },
  ])('still rejects unusable entry data: %j', raw => {
    expect(() => parseEntry(raw, 0)).toThrow();
  });

  it('reports the entry key when an import really is invalid', () => {
    expect(() => importImageWorldBook('{"entries":{"7":{},"8":{"content":12}}}', 'invalid.json'))
      .toThrow(/条目 8.*content/);
  });
});

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
