import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateRunningHubImage } from '@/backends/runninghub';
import { runningHubDefaults } from '@/backends/runninghubConfig';
import { autoTagProfile } from '@/autoTag/prompt';
import { backendStatus, generateImage } from '@/generate';
import { activeRunningHubPreset, settings } from '@/state/settings';
import { mangaDefaults } from '@/manga/layouts';

vi.mock('@/backends/runninghub', () => ({ generateRunningHubImage: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  settings.defaultBackend = 'runninghub';
  settings.runninghub = runningHubDefaults();
  settings.runninghub.apiKey = 'fixture-key';
  const preset = activeRunningHubPreset();
  preset.workflowId = '2110000000000000001';
  preset.workflow = '{"1":{"class_type":"CLIPTextEncode","inputs":{"text":"%prompt%"}}}';
  settings.manga = mangaDefaults();
  settings.autoTag.prompts.comfySpec = '';
  vi.mocked(generateRunningHubImage).mockResolvedValue({
    result: { url: 'blob:test', filename: 'test.png', format: 'png', revoke: vi.fn() },
    taskId: 'task-test', coins: 0.5, seconds: 23,
  });
});

describe('RunningHub shared generation entry', () => {
  it('reports missing key and workflow binding without leaking credentials', () => {
    expect(backendStatus()).toMatchObject({ backend: 'runninghub', configured: true, supportsCharacters: false });
    settings.runninghub.apiKey = '';
    expect(backendStatus()).toMatchObject({ configured: false, reason: '未填写 RunningHub API Key' });
    settings.runninghub.apiKey = 'fixture-key';
    activeRunningHubPreset().workflow = '{"1":{"inputs":{"text":"fixed"}}}';
    expect(backendStatus().configured).toBe(false);
    expect(backendStatus().reason).not.toContain('fixture-key');
  });
  it('dispatches prompt, dimensions, cancellation, phases and cloud metadata', async () => {
    const preset = activeRunningHubPreset();
    preset.orientationLock = 'landscape';
    const controller = new AbortController();
    const onPhase = vi.fn();
    const output = await generateImage({
      prompt: 'scene', nl: 'description', negative: 'bad quality', seed: 42, size: 'portrait',
      characters: [{ name: 'Test', tag: 'character', nl: '' }],
    }, controller.signal, { onPhase });
    const call = vi.mocked(generateRunningHubImage).mock.calls[0];
    expect(call[2]).toEqual({ prompt: 'scene', nl: 'description', negative_prompt: 'bad quality', seed: 42, width: 1024, height: 768 });
    expect(call[3]).toBe(controller.signal);
    call[4]?.onPhase?.('waiting');
    call[4]?.onPhase?.('running');
    expect(onPhase.mock.calls).toEqual([['queued'], ['generating']]);
    expect(output).toMatchObject({
      backend: 'runninghub', size: 'landscape', charactersApplied: false,
      meta: { backend: 'runninghub', params: { taskId: 'task-test', coins: 0.5, seconds: 23 } },
    });
  });
  it('keeps in-flight configuration isolated from later preset edits', async () => {
    await generateImage({ prompt: 'scene', seed: 1 });
    const sent = vi.mocked(generateRunningHubImage).mock.calls[0];
    activeRunningHubPreset().workflowId = '999';
    settings.runninghub.apiKey = 'changed';
    expect(sent[1].workflowId).toBe('2110000000000000001');
    expect(sent[0].apiKey).toBe('fixture-key');
  });
  it('uses RunningHub natural-language and orientation preferences in auto tagging', () => {
    activeRunningHubPreset().naturalLanguage = true;
    activeRunningHubPreset().orientationLock = 'portrait';
    expect(autoTagProfile()).toMatchObject({ nl: true, naiCharPrompts: false, lockedSize: 'portrait' });
    settings.manga.enabled = true;
    expect(autoTagProfile()).toMatchObject({ layout: true, nl: false });
  });
  it('compiles MOSS manga coordinates for the cloud path', async () => {
    settings.manga.enabled = true;
    activeRunningHubPreset().portraitSize = '1088x1920';
    await generateImage({ prompt: JSON.stringify({ layout: 'balanced_1', items: [{ panel: 1, slot: 'C' }] }), nl: 'old', seed: 1 });
    const sent = vi.mocked(generateRunningHubImage).mock.calls[0][2];
    expect(sent.nl).toBe('');
    expect(JSON.parse(sent.prompt).items[0].bbox).toHaveLength(4);
    activeRunningHubPreset().portraitSize = '512x768';
    await expect(generateImage({ prompt: '{"layout":"balanced_1","items":[]}', seed: 1 })).rejects.toThrow();
    expect(generateRunningHubImage).toHaveBeenCalledTimes(1);
  });
});
