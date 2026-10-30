import { describe, expect, it, vi } from 'vitest';
import type { STContext } from '@/st/context';
import { entryDefaults, imageWorldbookDefaults, importImageWorldBook, normalizeImageWorldbooks, type ImageWorldEntry } from './model';
import { emptyScan, injectImageWorldbooks, scanImageWorldbooks, type ScanInput } from './engine';
import { settings } from '@/state/settings';
import { fetchImageWorldbooks, previewImageWorldbooks } from './runtime';
import * as promptContext from '@/autoTag/context';
import { buildAutoTagMessages } from '@/autoTag/prompt';
import { splitDshMessages } from '@/api/dsh';

export function context(text = 'forest river'): STContext {
  return {
    chat: [{ name: 'Alice', is_user: false, is_system: false, mes: text }],
    chatMetadata: { variables: { color: 'green' } }, name1: 'Reader', name2: 'Alice',
    characterId: 0, characters: [{ name: 'Alice', avatar: 'alice.png', description: 'silver hair', personality: 'kind', scenario: 'mountain' }],
    getCurrentChatId: () => 'test', getRequestHeaders: () => ({}), saveMetadataDebounced: vi.fn(),
    saveChat: async () => {}, eventSource: { on: vi.fn(), emit: vi.fn() }, eventTypes: {} as STContext['eventTypes'],
    substituteParams: text => text === '{{persona}}' ? 'traveler' : text,
  };
}
export function setup(entries: Array<Partial<ImageWorldEntry>>, text?: string): ScanInput {
  const config = imageWorldbookDefaults();
  config.inherit = false;
  config.contextSize = 10000;
  config.scan.world_info_budget = 100;
  config.books.push(importImageWorldBook(JSON.stringify({
    entries: Object.fromEntries(entries.map((e, i) => [i, { ...entryDefaults(i), content: `text-${i}`, key: ['forest'], ...e }])),
  }), 'test.json'));
  return { config, context: context(text), targetFloor: 0, random: () => .5, countTokens: async s => s.length };
}
const ids = (result: Awaited<ReturnType<typeof scanImageWorldbooks>>) => [...result.allActivatedEntries].map(e => e.uid);

describe('private native world info scanner', () => {
  it.each([
    [0, ['river', 'snow'], true], [1, ['river', 'snow'], true],
    [1, ['forest', 'river'], false], [2, ['snow'], true],
    [2, ['river'], false], [3, ['forest', 'river'], true], [3, ['river', 'snow'], false],
  ])('preserves native selectiveLogic=%s (%j)', async (selectiveLogic, keys, expected) => {
    const result = await scanImageWorldbooks(setup([{ selectiveLogic: selectiveLogic as number, keysecondary: keys as string[] }]));
    expect(ids(result).includes(0)).toBe(expected);
  });
  it('handles constants, disabled entries, regex and native whole-word boundaries', async () => {
    const result = await scanImageWorldbooks(setup([
      { key: [], constant: true }, { constant: true, disable: true },
      { key: ['/FOREST/i'] }, { key: ['Forest'], caseSensitive: true },
      { key: ['for'], matchWholeWords: true }, { key: ['for'], matchWholeWords: false },
      { key: ['['], matchWholeWords: true },
    ]));
    expect(ids(result)).toEqual([0, 2, 5]);
  });
  it('uses newest-first depth and per-entry overrides; does not scan hidden messages', async () => {
    const input = setup([{ key: ['old'], scanDepth: 1 }, { key: ['old'], scanDepth: 2 }, { key: ['hidden'] }], 'old');
    input.context.chat.push({ name: 'A', is_user: false, is_system: true, mes: 'hidden' }, { name: 'A', is_user: false, is_system: false, mes: 'new' });
    input.targetFloor = 2;
    expect(ids(await scanImageWorldbooks(input))).toEqual([1]);
  });
  it('recurses with prevention, exclusion and delayed levels', async () => {
    const input = setup([
      { content: 'sun' }, { key: ['sun'], content: 'moon' },
      { key: ['moon'], excludeRecursion: true },
      { key: ['moon'], delayUntilRecursion: 1 },
    ]);
    input.config.scan.world_info_recursive = true;
    expect(ids(await scanImageWorldbooks(input))).toEqual([0, 1, 3]);
    input.config.books[0].document.entries['0'].preventRecursion = true;
    expect(ids(await scanImageWorldbooks(input))).toEqual([0]);
  });
  it('honors probability, group override and group scoring', async () => {
    const input = setup([
      { probability: 0 }, { group: 'g', order: 100 },
      { group: 'g', groupOverride: true, order: 50 },
      { group: 'h', key: ['forest'], useGroupScoring: true },
      { group: 'h', key: ['forest', 'river'], useGroupScoring: true },
    ]);
    expect(ids(await scanImageWorldbooks(input))).toEqual([4, 2]);
  });
  it('honors native token budget, ignoreBudget, and preserves raw books', async () => {
    const input = setup([{ constant: true, content: 'a'.repeat(20) }, { constant: true, ignoreBudget: true }]);
    input.config.scan.world_info_budget_cap = 10;
    const before = JSON.stringify(input.config);
    expect(ids(await scanImageWorldbooks(input))).toEqual([1]);
    expect(JSON.stringify(input.config)).toBe(before);
  });
  it('scans optional character fields, filters characters and generation types', async () => {
    const input = setup([
      { key: ['silver'], matchCharacterDescription: true },
      { key: ['mountain'], matchScenario: true },
      { constant: true, characterFilter: { names: ['bob'], isExclude: false } },
      { constant: true, triggers: ['continue'] },
      { key: ['traveler'], matchPersonaDescription: true },
    ]);
    expect(ids(await scanImageWorldbooks(input))).toEqual([0, 1, 4]);
  });
  it('expands read-only macros without calling host macro/script evaluation on imported text', async () => {
    const input = setup([{ constant: true, content: '{{char}} {{getvar::color}} {{getglobalvar::weather}} {{setvar::x::1}} <% dangerous() %>' }]);
    input.context.extensionSettings = { variables: { global: { weather: 'sunny' } } };
    input.context.substituteParams = vi.fn(input.context.substituteParams);
    const result = await scanImageWorldbooks(input);
    expect([...result.allActivatedEntries][0].content).toBe('Alice green sunny {{setvar::x::1}} <% dangerous() %>');
    expect(input.context.substituteParams).toHaveBeenCalledExactlyOnceWith('{{persona}}');
    expect(input.context.chatMetadata).toEqual({ variables: { color: 'green' } });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(input.context.eventSource.emit).not.toHaveBeenCalled();
  });
  it('keeps sticky/cooldown private and advances by chat messages, not generation count', async () => {
    const input = setup([{ sticky: 2, cooldown: 2 }]);
    const first = await scanImageWorldbooks(input);
    expect(ids(first)).toEqual([0]);
    const original = JSON.stringify(input.context.chatMetadata);
    input.metadata = first.metadata;
    input.context.chat.push({ name: 'A', mes: 'nothing', is_user: false, is_system: false });
    input.targetFloor = 1;
    const second = await scanImageWorldbooks(input);
    expect(ids(second)).toEqual([0]);
    input.metadata = second.metadata;
    input.context.chat.push({ name: 'A', mes: 'forest', is_user: false, is_system: false });
    input.targetFloor = 2;
    const third = await scanImageWorldbooks(input);
    expect(ids(third)).toEqual([]);
    expect(JSON.stringify(input.context.chatMetadata)).toBe(original);
  });
  it('applies delay and minimum-activation depth extension', async () => {
    const input = setup([{ key: ['old'] }, { constant: true, delay: 10 }], 'old');
    input.context.chat.push({ name: 'A', mes: 'new', is_user: false, is_system: false });
    input.targetFloor = 1;
    input.config.scan.world_info_depth = 1;
    input.config.scan.world_info_min_activations = 1;
    expect(ids(await scanImageWorldbooks(input))).toEqual([0]);
  });
  it('runs concurrent scans without sharing entries, events, or timers', async () => {
    const a = setup([{ key: ['forest'], sticky: 2 }]), b = setup([{ key: ['snow'], sticky: 2 }]);
    const [ra, rb] = await Promise.all([scanImageWorldbooks(a), scanImageWorldbooks(b)]);
    expect(ids(ra)).toEqual([0]); expect(ids(rb)).toEqual([]);
    expect(rb.metadata).not.toEqual(ra.metadata);
    expect(a.context.saveMetadataDebounced).not.toHaveBeenCalled();
  });
  it('preserves native insertion order and outlets without changing fixed DSH rules', async () => {
    const input = setup([
      { constant: true, position: 0, order: 200, content: 'late' },
      { constant: true, position: 0, order: 100, content: 'early {{outlet::x}}' },
      { constant: true, position: 7, outletName: 'x', content: 'OUTLET' },
      { constant: true, position: 4, depth: 0, role: 1, content: 'DEPTH0' },
    ]);
    const result = await scanImageWorldbooks(input);
    expect(result.worldInfoBefore).toBe('early {{outlet::x}}\nlate');
    const prefix = { role: 'system' as const, content: 'rules', purpose: 'spec' as const };
    const messages = injectImageWorldbooks([prefix, { role: 'user', content: 'story' }], result, 1);
    expect(messages[0]).toEqual(prefix);
    expect(messages[1].content).toBe('early OUTLET\nlate');
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'DEPTH0', source: '生图世界书' });
    expect(messages.slice(1).every(m => !m.purpose)).toBe(true);
    expect(injectImageWorldbooks([prefix], emptyScan(), 1)).toEqual([prefix]);
  });
  it('uses SYSTEM for an imported depth entry whose role is null', async () => {
    const input = setup([{ constant: true, position: 4, depth: 0, content: 'DEFAULT_ROLE_REFERENCE' }]);
    (input.config.books[0].document.entries['0'] as Record<string, unknown>).role = null;
    const result = await scanImageWorldbooks(input);
    expect(result.WIDepthEntries).toEqual([{ depth: 0, role: 0, entries: ['DEFAULT_ROLE_REFERENCE'] }]);
    expect(injectImageWorldbooks([{ role: 'user', content: 'story' }], result, 0).at(-1)).toEqual({
      role: 'system', content: 'DEFAULT_ROLE_REFERENCE', source: '生图世界书',
    });
  });
  it('scans repaired native imports and injects their references into the tag request', async () => {
    const input = setup([]);
    input.config.books = [importImageWorldBook(JSON.stringify({ entries: {
      '0': { constant: true, content: 'ALWAYS_REFERENCE', key: null, keysecondary: null, characterFilter: null, role: null },
      '1': { key: ['forest'], keysecondary: ['river'], selectiveLogic: null, content: 'MATCHED_REFERENCE' },
      '2': { key: ['forest'], keysecondary: ['snow'], selectiveLogic: null, content: 'UNMATCHED_REFERENCE' },
      '3': {},
    } }), 'legacy.json')];
    const before = JSON.stringify(input.config);
    const result = await scanImageWorldbooks(input);
    expect(ids(result)).toEqual([0, 1]);
    const messages = injectImageWorldbooks([{ role: 'user', content: 'story' }], result, 0);
    const content = messages.map(m => m.content).join('\n');
    expect(content).toContain('ALWAYS_REFERENCE');
    expect(content).toContain('MATCHED_REFERENCE');
    expect(content).not.toContain('UNMATCHED_REFERENCE');
    expect(JSON.stringify(input.config)).toBe(before);
  });
});

describe('ST JSON round trip', () => {
  it('preserves extension data, unknown root fields and entry UIDs', () => {
    const doc = { name: 'original', custom: { version: 3 }, entries: { '7': { ...entryDefaults(7), content: 'hello', extensions: { foo: 1 } } } };
    const book = importImageWorldBook(JSON.stringify(doc), 'name.json');
    expect(book.document).toEqual(doc);
    expect(normalizeImageWorldbooks({ books: [book] }).books[0]).toEqual(book);
  });
  it.each(['{}', '{"entries":[]}', '{"entries":{"0":{"content":"x","key":[7]}}}', '{"entries":{"0":{"content":"x","position":99}}}'])('rejects invalid input atomically: %s', text => {
    expect(() => importImageWorldBook(text, 'bad.json')).toThrow();
  });
  it('does not mutate or drop entries when disabling the library', () => {
    const input = setup([{ constant: true }]);
    const normalized = normalizeImageWorldbooks({ ...input.config, enabled: false });
    expect(normalized.books).toEqual(input.config.books);
    expect(normalized.enabled).toBe(false);
  });
});

describe('tag-only integration', () => {
  it('injects a private book into dynamic tag messages, not host global books or fixed rules', async () => {
    const previous = settings.imageWorldbooks;
    const input = setup([{ constant: true, content: 'PRIVATE_IMAGE_REFERENCE', position: 4, depth: 999 }]);
    settings.imageWorldbooks = input.config;
    const host = vi.spyOn(promptContext, 'fetchWorldInfo').mockResolvedValue('');
    const metadata = JSON.stringify(input.context.chatMetadata);
    try {
      const messages = await buildAutoTagMessages(input.context, 0, settings.autoTag, null);
      const parts = splitDshMessages(messages);
      expect(parts.dynamic.some(m => m.content.includes('PRIVATE_IMAGE_REFERENCE'))).toBe(true);
      expect(parts.fixed.every(m => !m.content.includes('PRIVATE_IMAGE_REFERENCE'))).toBe(true);
      expect(messages.slice(0, parts.fixed.length)).toEqual(parts.fixed);
      expect(input.context.extensionSettings).toBeUndefined();
      expect(input.context.eventSource.emit).not.toHaveBeenCalled();
      const { baibai_image_worldbook: _state, ...rest } = input.context.chatMetadata;
      expect(JSON.stringify(rest)).toBe(metadata);
      expect(input.context.chat[0].mes).toBe('forest river');
    } finally { settings.imageWorldbooks = previous; host.mockRestore(); }
  });
  it('preview never persists timers and disabled libraries short-circuit', async () => {
    const previous = settings.imageWorldbooks;
    const input = setup([{ constant: true, sticky: 3 }]);
    settings.imageWorldbooks = input.config;
    try {
      const before = JSON.stringify(input.context.chatMetadata);
      expect(ids(await previewImageWorldbooks(input.context, 0))).toEqual([0]);
      expect(JSON.stringify(input.context.chatMetadata)).toBe(before);
      expect(input.context.saveMetadataDebounced).not.toHaveBeenCalled();
      settings.imageWorldbooks.enabled = false;
      expect(ids(await fetchImageWorldbooks(input.context, 0))).toEqual([]);
      expect(input.context.saveMetadataDebounced).not.toHaveBeenCalled();
    } finally { settings.imageWorldbooks = previous; }
  });
  it('serializes private timer commits, and discards commits after chat changes', async () => {
    const previous = settings.imageWorldbooks;
    const input = setup([{ constant: true, sticky: 3 }]);
    settings.imageWorldbooks = input.config;
    try {
      await Promise.all([fetchImageWorldbooks(input.context, 0), fetchImageWorldbooks(input.context, 0)]);
      expect(input.context.saveMetadataDebounced).toHaveBeenCalledTimes(2);
      let current = 'old';
      input.context.getCurrentChatId = () => current;
      input.context.getTokenCountAsync = async s => { current = 'new'; return s.length; };
      await fetchImageWorldbooks(input.context, 0);
      expect(input.context.saveMetadataDebounced).toHaveBeenCalledTimes(2);
    } finally { settings.imageWorldbooks = previous; }
  });
});
