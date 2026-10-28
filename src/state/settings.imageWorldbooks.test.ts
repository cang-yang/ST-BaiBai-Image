import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { entryDefaults, imageWorldbookDefaults, importImageWorldBook } from '@/worldbook/model';
const mock = vi.hoisted(() => ({ context: null as any }));
vi.mock('@/st/context', () => ({ getContext: () => mock.context }));
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('window', { addEventListener: vi.fn(), dispatchEvent: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe('private worldbook persistence', () => {
  it('hydrates books, preserves other settings, and persists entry edits without touching host books', async () => {
    const config = imageWorldbookDefaults();
    config.books.push(importImageWorldBook(JSON.stringify({ entries: { '4': { ...entryDefaults(4), content: 'drawing reference' } } }), 'private.json'));
    mock.context = {
      extensionSettings: { baibai_image: { defaultBackend: 'runninghub', imageWorldbooks: config }, world_info: { globalSelect: ['story-book'] } },
      saveSettingsDebounced: vi.fn(),
    };
    const { hydrateSettings, settings } = await import('./settings');
    const { nextTick } = await import('vue');
    await hydrateSettings();
    expect(settings.imageWorldbooks.books).toHaveLength(1);
    expect(settings.defaultBackend).toBe('runninghub');
    settings.imageWorldbooks.books[0].document.entries['4'].disable = true;
    await nextTick();
    expect(mock.context.extensionSettings.baibai_image.imageWorldbooks.books[0].document.entries['4'].disable).toBe(true);
    expect(mock.context.extensionSettings.world_info).toEqual({ globalSelect: ['story-book'] });
    expect(mock.context.saveSettingsDebounced).toHaveBeenCalled();
  });
  it('upgrades older settings to an empty library, without adding global books', async () => {
    mock.context = { extensionSettings: { baibai_image: { defaultBackend: 'comfyui' } }, saveSettingsDebounced: vi.fn() };
    const { hydrateSettings, settings } = await import('./settings');
    await hydrateSettings();
    expect(settings.imageWorldbooks).toEqual(imageWorldbookDefaults());
    expect(mock.context.extensionSettings.world_info).toBeUndefined();
  });
});
