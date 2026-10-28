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
    expect(settings.imagePresets).toEqual(config);
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
    expect(settings.imagePresets).toEqual(presetDefaults());
  });
});
