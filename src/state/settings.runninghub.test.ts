import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ context: null as any }));
vi.mock('@/st/context', () => ({ getContext: () => mock.context }));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('window', { addEventListener: vi.fn(), dispatchEvent: vi.fn() });
  vi.stubGlobal('toastr', { info: vi.fn(), success: vi.fn(), error: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe('RunningHub settings persistence', () => {
  it('preserves old channels when upgrading a configuration without RunningHub', async () => {
    mock.context = {
      extensionSettings: { baibai_image: { defaultBackend: 'comfyui', comfyui: { url: 'http://localhost:8188', workflow: '{"1":{}}' } } },
      saveSettingsDebounced: vi.fn(),
    };
    const { hydrateSettings, settings } = await import('./settings');
    await hydrateSettings();
    expect(settings.defaultBackend).toBe('comfyui');
    expect(settings.comfyui.url).toBe('http://localhost:8188');
    expect(settings.runninghub.apiKey).toBe('');
    expect(settings.runninghub.workflows).toHaveLength(1);
  });
  it('hydrates the selected cloud preset and execution preferences', async () => {
    mock.context = {
      extensionSettings: { baibai_image: { defaultBackend: 'runninghub', runninghub: {
        url: 'https://www.runninghub.cn', apiKey: 'fixture-key', activeWorkflowId: 'p2', concurrency: 2, retainSeconds: 0,
        workflows: [
          { id: 'p1', name: 'One', workflowId: '123', workflow: '{"1":{}}' },
          { id: 'p2', name: 'Two', workflowId: '2110000000000000001', workflow: '{"2":{}}', naturalLanguage: true },
        ],
      } } }, saveSettingsDebounced: vi.fn(),
    };
    const { hydrateSettings, settings, activeRunningHubPreset } = await import('./settings');
    await hydrateSettings();
    expect(settings.defaultBackend).toBe('runninghub');
    expect(settings.runninghub).toMatchObject({ url: 'https://www.runninghub.cn', apiKey: 'fixture-key', concurrency: 2 });
    expect(activeRunningHubPreset()).toMatchObject({ id: 'p2', workflowId: '2110000000000000001', naturalLanguage: true });
  });
});
