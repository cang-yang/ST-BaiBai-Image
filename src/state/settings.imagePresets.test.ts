import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newImagePreset, presetDefaults } from '@/presets/model';
const mock = vi.hoisted(() => ({ context: null as any }));
vi.mock('@/st/context', () => ({ getContext: () => mock.context }));
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('window', { addEventListener: vi.fn(), dispatchEvent: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe('image preset persistence', () => {
  it('hydrates and persists presets and local transport without changing shared channels or worldbooks', async () => {
    const preset = newImagePreset();
    const config = { activeId: preset.id, presets: [preset], directChannels: ['c1'] };
    mock.context = {
      extensionSettings: {
        baibai_image: { imagePresets: config, defaultBackend: 'runninghub' },
        world_info: { globalSelect: ['story'] },
      }, saveSettingsDebounced: vi.fn(),
    };
    const { hydrateSettings, settings } = await import('./settings');
    const { nextTick } = await import('vue');
    await hydrateSettings();
    expect(settings.imagePresets).toEqual({ ...config, rulesVersion: 2 });
    settings.imagePresets.presets[0].entries[0].content = 'revised rule';
    await nextTick();
    expect(mock.context.extensionSettings.baibai_image.imagePresets.presets[0].entries[0].content).toBe('revised rule');
    expect(mock.context.extensionSettings.world_info).toEqual({ globalSelect: ['story'] });
    expect(settings.defaultBackend).toBe('runninghub');
    expect(mock.context.saveSettingsDebounced).toHaveBeenCalled();
  });
  it('keeps old installations on the original default flow', async () => {
    mock.context = { extensionSettings: { baibai_image: {} }, saveSettingsDebounced: vi.fn() };
    const { hydrateSettings, settings } = await import('./settings');
    await hydrateSettings();
    expect(settings.imagePresets).toEqual({ ...presetDefaults(), rulesVersion: 2 });
  });
  it('persists the migration marker and independent rules across reloads', async () => {
    mock.context = {
      extensionSettings: { baibai_image: {
        autoTag: { prompts: { comfySpec: 'ORIGINAL_RULE' } },
        manga: { spec: 'ORIGINAL_MANGA' },
      } }, saveSettingsDebounced: vi.fn(),
    };
    const first = await import('./settings');
    await first.hydrateSettings();
    await (await import('vue')).nextTick();
    const saved = JSON.parse(JSON.stringify(mock.context.extensionSettings));
    expect(saved.baibai_image.imagePresets.rulesVersion).toBe(2);
    expect(saved.baibai_image.imagePresets.presets).toHaveLength(1);
    saved.baibai_image.autoTag.prompts.comfySpec = 'BACKUP_ONLY';
    mock.context.extensionSettings = saved;
    vi.resetModules();
    const reloaded = await import('./settings');
    await reloaded.hydrateSettings();
    expect(reloaded.settings.imagePresets.presets).toHaveLength(1);
    expect(reloaded.settings.imagePresets.activeId).toBe(saved.baibai_image.imagePresets.activeId);
    expect(reloaded.settings.imagePresets.presets[0].rules?.comfySpec.text).toBe('ORIGINAL_RULE');
    expect(reloaded.settings.imagePresets.presets[0].rules?.mangaSpec.text).toBe('ORIGINAL_MANGA');
  });
});
