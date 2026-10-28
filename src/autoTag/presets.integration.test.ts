import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newImagePreset } from '@/presets/model';
import { settings, newChannel } from '@/state/settings';
import { cancelFloorTags, requestFloorTags } from './runner';
import { mangaDefaults } from '@/manga/layouts';

const mock = vi.hoisted(() => ({
  context: null as any,
  build: vi.fn(async (..._args: any[]) => [{ role: 'user', content: 'request' }]),
  request: vi.fn(async (_channel: unknown, _messages: unknown, opts: any) => { opts.validate('{"images":[],"changes":[]}'); return ''; }),
  main: vi.fn(), write: vi.fn(),
}));
vi.mock('@/api/client', () => ({ requestCompletion: mock.request, requestViaMainApi: mock.main }));
vi.mock('@/autoTag/prompt', () => ({
  autoTagProfile: (preset: any) => ({ naiCharPrompts: false, nl: false, lockedSize: null, layout: preset.mangaText === 'required' }),
  buildAutoTagMessages: mock.build,
}));
vi.mock('@/st/context', async importOriginal => ({
  ...(await importOriginal<any>()), getContext: () => mock.context,
}));
vi.mock('@/st/messageEdit', () => ({ applyMessageText: mock.write }));
vi.mock('@/autoTag/bookMemory', () => ({ readBookMemory: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('toastr', { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() });
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  mock.context = {
    chat: [{ mes: 'A traveler waits at the station.', name: 'Char', is_user: false, is_system: false }],
    chatMetadata: {}, name1: 'User', name2: 'Char', characters: [],
    getCurrentChatId: () => 'preset-test', saveMetadataDebounced: vi.fn(),
  };
  const preset = newImagePreset(); preset.output = 'tool';
  const channel = newChannel(); channel.url = 'https://example.test/v1'; channel.model = 'test';
  settings.enabled = true;
  settings.channels = [channel]; settings.assignments.tagGen = channel.id;
  settings.imagePresets = { activeId: preset.id, presets: [preset], directChannels: [channel.id] };
  settings.autoTag.dshSession = false; settings.autoTag.retryCount = 0;
  settings.autoTag.minImages = 0; settings.autoTag.maxImages = 2;
  settings.excludes.excludedChars = [];
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('preset runner integration', () => {
  it('accepts corrected lettering before writing a plan into the story', async () => {
    settings.imagePresets.presets[0].mangaText = 'required';
    settings.manga = { ...mangaDefaults(), enabled: true };
    const corrected = JSON.parse(wordless());
    const page = JSON.parse(corrected.images[0].tag);
    page.items.push({ panel: 1, slot: 'TR', label: 'text', text: '旅人正在等车。', caption: 'a narration box' });
    corrected.images[0].tag = JSON.stringify(page);
    mock.request.mockImplementationOnce(async (_c, _m, opts) => { opts.validate(wordless()); return ''; })
      .mockImplementationOnce(async (_c, _m, opts) => { opts.validate(JSON.stringify(corrected)); return JSON.stringify(corrected); });
    await requestFloorTags(0);
    expect(mock.request).toHaveBeenCalledTimes(2);
    expect(mock.write).toHaveBeenCalledOnce();
    const update = mock.write.mock.calls[0][1] as (source: string) => string;
    expect(update(mock.context.chat[0].mes)).toContain('旅人正在等车。');
  });
  it('blocks wordless pages and stops after one correction even with general retries enabled', async () => {
    settings.imagePresets.presets[0].mangaText = 'required';
    settings.manga = { ...mangaDefaults(), enabled: true };
    settings.autoTag.retryCount = 5;
    mock.request.mockImplementationOnce(async (_c, _m, opts) => { opts.validate(wordless()); return ''; })
      .mockImplementationOnce(async (_c, _m, opts) => { opts.validate(wordless()); return ''; });
    await requestFloorTags(0);
    expect(mock.request).toHaveBeenCalledTimes(2);
    expect(mock.request.mock.calls[1][2].source).toContain('文字补正 1/1');
    expect(mock.write).not.toHaveBeenCalled();
    expect(toastr.error).toHaveBeenCalledWith(expect.stringContaining('文字补正未通过'), expect.anything());
  });
  it('passes an explicit owned builtin preset when the user selects the default', async () => {
    settings.imagePresets.activeId = '';
    await requestFloorTags(0);
    expect(mock.build).toHaveBeenCalledOnce();
    expect(mock.build.mock.calls[0][8]).toMatchObject({
      name: '内置默认', entries: [], rules: { comfySpec: { mode: 'builtin' } },
    });
    expect(mock.request.mock.calls[0][2].imagePlanTool).toBeFalsy();
  });
  it('snapshots preset, channel and transport before asynchronous prompt assembly', async () => {
    const name = settings.imagePresets.presets[0].name;
    mock.build.mockImplementationOnce(async (...args: any[]) => {
      expect(args[8].name).toBe(name);
      settings.imagePresets.presets[0].output = 'text';
      settings.imagePresets.presets[0].entries[0].content = 'changed';
      settings.imagePresets.directChannels = [];
      settings.channels[0].model = 'different-model';
      expect(args[8].entries[0].content).not.toBe('changed');
      return [{ role: 'user', content: 'snapshot' }];
    });
    await requestFloorTags(0);
    expect(mock.request).toHaveBeenCalledOnce();
    expect(mock.request.mock.calls[0][0]).toMatchObject({ model: 'test' });
    expect(mock.request.mock.calls[0][2]).toMatchObject({ imagePlanTool: true, direct: true });
    expect(mock.write).not.toHaveBeenCalled();
  });
  it('blocks incompatible DSH mode before building or sending a request', async () => {
    settings.autoTag.dshSession = true;
    await requestFloorTags(0);
    expect(mock.build).not.toHaveBeenCalled();
    expect(mock.request).not.toHaveBeenCalled();
    expect(toastr.error).toHaveBeenCalledWith(expect.stringContaining('DSH'), expect.anything());
  });
  it('blocks tool mode with follow-main API before any paid request', async () => {
    settings.assignments.tagGen = '';
    await requestFloorTags(0);
    expect(mock.request).not.toHaveBeenCalled();
    expect(mock.main).not.toHaveBeenCalled();
    expect(toastr.error).toHaveBeenCalledWith(expect.stringContaining('独立副 API'), expect.anything());
  });
  it('does not send anything when cancelled during prompt assembly', async () => {
    mock.build.mockImplementationOnce(async () => {
      cancelFloorTags(0);
      return [{ role: 'user', content: 'cancelled' }];
    });
    await requestFloorTags(0);
    expect(mock.request).not.toHaveBeenCalled();
    expect(mock.write).not.toHaveBeenCalled();
  });
});

function wordless(): string {
  return JSON.stringify({ images: [{ position: 'P1', tag: JSON.stringify({
    layout: 'balanced_1', summary: { caption: 'A page' },
    items: [{ panel: 1, slot: 'S', label: 'character', caption: 'A traveler' }],
  }) }], changes: [] });
}
