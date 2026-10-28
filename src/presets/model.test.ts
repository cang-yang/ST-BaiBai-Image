import { describe, expect, it } from 'vitest';
import { exportPreset, importPresets, newImagePreset, newPromptEntry, normalizeImagePresets, presetDefaults, presetWithMangaRules, snapshotPreset, validatePreset } from './model';
import { assertPresetReady, renderPreset } from './render';

describe('native image presets', () => {
  it('roundtrips opt-in expressive composition without changing legacy presets', () => {
    const preset = newImagePreset();
    expect(validatePreset(preset).mangaComposition).toBe('auto');
    preset.mangaComposition = 'expressive';
    expect(importPresets(exportPreset(preset))[0].mangaComposition).toBe('expressive');
    expect(() => validatePreset({ ...preset, mangaComposition: 'random' })).toThrow(/构图/);
  });
  it('roundtrips the optional manga lettering policy without changing legacy defaults', () => {
    const preset = newImagePreset();
    expect(validatePreset(preset).mangaText).toBe('auto');
    preset.mangaText = 'required';
    expect(importPresets(exportPreset(preset))[0].mangaText).toBe('required');
    expect(() => validatePreset({ ...preset, mangaText: 'anything' })).toThrow(/文字/);
  });
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
  it('migrates global text once, preserving the former default as an independent active preset', () => {
    const old = { comfySpec: 'OLD_SPEC', comfyThinking: 'OLD_CHECK', jailbreak: 'OLD_PREFIX' };
    const migrated = normalizeImagePresets(undefined, old, { spec: 'MANGA_SPEC', thinking: 'MANGA_CHECK' });
    expect(migrated.rulesVersion).toBe(2);
    expect(migrated.presets).toHaveLength(1);
    const preset = snapshotPreset(migrated)!;
    expect(preset.name).toBe('原有提示词（已迁移）');
    expect(preset.entries).toEqual([]);
    expect(preset.rules).toMatchObject({
      comfySpec: { mode: 'custom', text: 'OLD_SPEC' },
      comfyThinking: { mode: 'custom', text: 'OLD_CHECK' },
      jailbreak: { mode: 'custom', text: 'OLD_PREFIX' },
      mangaSpec: { mode: 'custom', text: 'MANGA_SPEC' },
      mangaThinking: { mode: 'custom', text: 'MANGA_CHECK' },
    });
    old.comfySpec = 'CHANGED_BACKUP';
    expect(normalizeImagePresets(migrated, old)).toEqual(migrated);
    expect(normalizeImagePresets(undefined, {})).toEqual({ ...presetDefaults(), rulesVersion: 2 });
  });
  it('snapshots v1 inheritance without changing the active choice or disabled rules', () => {
    const legacy = { ...newImagePreset(), rules: undefined, useBackendRules: false };
    const input = { activeId: legacy.id, presets: [legacy], directChannels: ['direct'] };
    const result = normalizeImagePresets(input, { comfySpec: '[BBI_FORMAT:MOSS_LAYOUT]\nOLD' }, { spec: 'MANGA' });
    expect(result.activeId).toBe(legacy.id);
    expect(result.presets).toHaveLength(2);
    expect(result.presets[0]).toMatchObject({ format: 'moss_layout', rules: {
      comfySpec: { mode: 'off' }, mangaSpec: { mode: 'custom', text: 'MANGA' }, jailbreak: { mode: 'off' },
    } });
    expect(result.presets[0].useBackendRules).toBeUndefined();
    expect(legacy.rules).toBeUndefined();
    expect(result.directChannels).toEqual(['direct']);
  });
  it('owns imported rules immediately, so reloading cannot inherit legacy global text', () => {
    for (const raw of [
      { format: 'baibai_image_prompt_preset', version: 1, preset: { entries: [], useBackendRules: true } },
      [{ role: 'system', content: 'REQUIREMENT' }],
      { entries: [{ role: 'user', content: 'REQUIREMENT' }] },
      { sample: { entries: [{ role: 'user', content: 'REQUIREMENT', triggerMode: 'always' }] } },
    ]) {
      const [preset] = importPresets(JSON.stringify(raw));
      expect(preset.rules?.comfySpec.mode).toBe('builtin');
      const reloaded = normalizeImagePresets({ ...presetDefaults(), rulesVersion: 2, presets: [preset] }, { comfySpec: 'SHOULD_NOT_INHERIT' });
      expect(reloaded.presets[0].rules).toEqual(preset.rules);
      expect(JSON.stringify(reloaded)).not.toContain('SHOULD_NOT_INHERIT');
    }
  });
  it('roundtrips v2 custom and disabled rules and rejects invalid rule blocks', () => {
    const preset = newImagePreset();
    preset.format = 'moss_layout';
    preset.rules!.comfySpec = { mode: 'custom', text: 'MY_SPEC' };
    preset.rules!.mangaThinking = { mode: 'off', text: 'PRESERVED_DRAFT' };
    const exported = JSON.parse(exportPreset(preset));
    expect(exported.version).toBe(2);
    expect(exported.preset.useBackendRules).toBeUndefined();
    expect(importPresets(JSON.stringify(exported))[0]).toMatchObject({ format: 'moss_layout', rules: preset.rules });
    for (const invalid of [null, { comfySpec: { mode: 'inherit', text: '' } }, { comfySpec: { mode: 'custom', text: 1 } }]) {
      expect(() => importPresets(JSON.stringify({ ...exported, preset: { ...exported.preset, rules: invalid } }))).toThrow();
    }
  });
  it('adds a manga bundle as a separate preset while preserving its base and ordinary rules', () => {
    const base = newImagePreset();
    base.rules!.comfySpec = { mode: 'custom', text: 'ORDINARY' };
    const before = JSON.stringify(base);
    const manga = presetWithMangaRules(base, 'Workflow', { spec: 'MANGA', thinking: 'CHECK' });
    expect(manga.id).not.toBe(base.id);
    expect(manga).toMatchObject({ name: 'Workflow · 漫画', format: 'moss_layout', rules: {
      comfySpec: { mode: 'custom', text: 'ORDINARY' },
      mangaSpec: { mode: 'custom', text: 'MANGA' }, mangaThinking: { mode: 'custom', text: 'CHECK' },
    } });
    expect(JSON.stringify(base)).toBe(before);
    manga.rules!.comfySpec.text = 'CHANGED';
    expect(base.rules!.comfySpec.text).toBe('ORDINARY');
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
