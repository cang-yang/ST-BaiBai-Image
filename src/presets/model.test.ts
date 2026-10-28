import { describe, expect, it } from 'vitest';
import { exportPreset, importPresets, newImagePreset, newPromptEntry, normalizeImagePresets, presetDefaults, snapshotPreset, validatePreset } from './model';
import { assertPresetReady, renderPreset } from './render';

describe('native image presets', () => {
  it('roundtrips native presets without secrets or unrelated settings and regenerates IDs', () => {
    const original = newImagePreset();
    original.variables.style = 'watercolor';
    Object.assign(original, { key: 'secret', channels: [{ key: 'secret' }] });
    const json = exportPreset(original);
    expect(json).not.toContain('secret');
    const copy = importPresets(json)[0];
    expect(copy.id).not.toBe(original.id);
    expect(copy.entries[0].id).not.toBe(original.entries[0].id);
    expect(copy.variables).toEqual(original.variables);
  });
  it('imports generic message arrays and message objects', () => {
    const messages = [{ role: 'system', content: 'paint faithfully' }, { role: 'user', content: '{{story}}' }];
    for (const input of [messages, { messages }]) {
      const [preset] = importPresets(JSON.stringify(input), 'sample.json');
      expect(preset.name).toBe('sample');
      expect(preset.entries.map(e => e.role)).toEqual(['system', 'user']);
    }
  });
  it('extracts only image_gen from a legacy request profile', () => {
    const entry = { name: 'reference', content: 'scene', role: 'user', enabled: true, triggerMode: 'trigger', triggerWords: 'rain', andTriggerWords: 'street' };
    const [preset] = importPresets(JSON.stringify({
      version: 1, type: 'st_chatu8_request_type_profile',
      request_type_profile: { image_gen: { context_profile: 'illustration' }, video_gen: { context_profile: 'video' } },
      context_presets: { illustration: { entries: [entry] }, video: { entries: [{ role: 'user', content: 'NOT_IMPORTED' }] } },
    }));
    expect(preset.name).toBe('illustration');
    expect(preset.entries[0]).toMatchObject({ trigger: 'keywords', keywords: 'rain', andKeywords: 'street' });
    expect(exportPreset(preset)).not.toContain('NOT_IMPORTED');
    expect(preset.warnings).toHaveLength(3);
    expect(importPresets(JSON.stringify({ illustration: { entries: [entry] } }))[0].entries[0].trigger).toBe('keywords');
  });
  it('rejects unknown formats, versions, roles, triggers and non-text variables', () => {
    for (const raw of [
      { format: 'baibai_image_prompt_preset', version: 9 },
      { entries: [{ role: 'tool', content: 'x' }] },
      { entries: [{ role: 'user', content: 'x', trigger: 'script' }] },
      { entries: [{ role: 'user', content: 'x' }], variables: { x: {} } },
      { entries: [{ role: 'user', content: 'x' }], variables: { constructor: 'bad' } },
      { format: 'worldbook', books: [] },
    ]) expect(() => importPresets(JSON.stringify(raw))).toThrow();
    expect(() => importPresets('not json')).toThrow(/JSON/);
    expect(() => importPresets(' '.repeat(2_000_001))).toThrow(/2 MB/);
  });
  it('normalizes old settings and creates isolated request snapshots', () => {
    expect(normalizeImagePresets(undefined)).toEqual(presetDefaults());
    const preset = newImagePreset(), config = { activeId: preset.id, presets: [preset], directChannels: ['channel'] };
    const snapshot = snapshotPreset(config)!;
    preset.entries[0].content = 'changed while requesting';
    expect(snapshot.entries[0].content).not.toBe(preset.entries[0].content);
    expect(normalizeImagePresets(config).directChannels).toEqual(['channel']);
    expect(normalizeImagePresets({ ...config, activeId: 'missing' }).activeId).toBe('');
    expect(() => snapshotPreset({ ...config, activeId: 'missing' })).toThrow();
    expect(() => validatePreset({ ...preset, entries: [preset.entries[0], preset.entries[0]] })).toThrow(/重复/);
  });
});

describe('preset rendering', () => {
  it('expands built-ins and sequential local variables without executing host macros or recursively expanding data', () => {
    const preset = newImagePreset();
    preset.variables.style = 'ink';
    preset.entries = [
      { ...newPromptEntry(), content: '{@setvar::count::2@}{{style}} / {{正文}}' },
      { ...newPromptEntry(), content: '{@getvar::count@} {{roll 6}} {{user}}' },
    ];
    const result = renderPreset(preset, { story: '{{setvar::global::not executed}}', user: 'Reader' }, '', () => .5);
    expect(result.messages.map(m => m.content)).toEqual(['ink / {{setvar::global::not executed}}', '2 4 Reader']);
    expect(result.warnings).toEqual([]);
    expect(preset.variables).toEqual({ style: 'ink' });
  });
  it('only activates enabled entries meeting both keyword groups', () => {
    const preset = newImagePreset();
    preset.entries = [
      { ...newPromptEntry(), name: 'conditional', content: '{{story}}', trigger: 'keywords', keywords: 'rain,雨', andKeywords: 'street，街道' },
      { ...newPromptEntry(), enabled: false, content: '{{unknown}}' },
    ];
    expect(renderPreset(preset, { story: '雨中的街道' }, '雨中的街道').activated).toEqual(['conditional']);
    expect(renderPreset(preset, {}, 'rain in garden').activated).toEqual([]);
    expect(renderPreset(preset, {}, 'Rain street').activated).toEqual([]);
    expect(renderPreset(preset, {}, '').warnings).toEqual([]);
  });
  it('reports missing variables and legacy tool guides rather than silently stripping them', () => {
    const preset = newImagePreset();
    preset.entries[0].content = '{{outfit_library}} 【ToolCall引导】';
    const result = renderPreset(preset, {}, '');
    expect(result.warnings).toHaveLength(2);
    expect(() => assertPresetReady(result)).toThrow(/预设需要调整/);
    expect(result.messages[0].content).toContain('{{outfit_library}}');
  });
});
