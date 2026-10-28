import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateRunningHubImage, recoverRunningHubImage, runningHubTasks,
  selectRunningHubImage, testRunningHubConnection, uploadRunningHubImage,
} from './runninghub';
import { runningHubDefaults } from './runninghubConfig';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const success = () => json({
  status: 'SUCCESS', results: [{ url: 'https://cdn.example/image.png', outputType: 'png', nodeId: '18' }],
  consumeCoins: '1.2', taskCostTime: '24',
});
const image = () => new Response(new Blob(['PNG'], { type: 'image/png' }));
function ready() {
  const config = runningHubDefaults();
  config.apiKey = 'test-key-' + Math.random();
  const preset = config.workflows[0];
  preset.workflowId = '2110000000000000001';
  preset.workflow = '{"4":{"class_type":"CLIPTextEncode","inputs":{"text":"quality, %prompt%"}}}';
  return { config, preset };
}
const values = { prompt: 'adult portrait', seed: 42 };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  runningHubTasks.splice(0);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:result');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('RunningHub image transport', () => {
  it('uses v2 Bearer auth and never leaks the key to image hosts or task records', async () => {
    const { config, preset } = ready();
    fetchMock.mockResolvedValueOnce(json({ taskId: 'task-1' })).mockResolvedValueOnce(success()).mockResolvedValueOnce(image());
    const out = await generateRunningHubImage(config, preset, values);
    expect(fetchMock.mock.calls[0][0]).toBe('https://www.runninghub.ai/openapi/v2/run/workflow/2110000000000000001');
    const submit = fetchMock.mock.calls[0][1];
    expect(submit.headers.Authorization).toBe(`Bearer ${config.apiKey}`);
    expect(JSON.parse(submit.body)).toMatchObject({ usePersonalQueue: false, nodeInfoList: [{ nodeId: '4', fieldName: 'text', fieldValue: 'quality, adult portrait' }] });
    expect(submit.body).not.toContain('retainSeconds');
    expect(fetchMock.mock.calls[2][1].headers).toBeUndefined();
    expect(JSON.stringify(runningHubTasks)).not.toContain(config.apiKey);
    expect(out).toMatchObject({ taskId: 'task-1', coins: 1.2, seconds: 24 });
    out.result.revoke();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:result');
  });
  it('reports remote queued/running phases then downloads exactly once', async () => {
    const { config, preset } = ready();
    const onPhase = vi.fn();
    fetchMock.mockResolvedValueOnce(json({ taskId: 'q' }))
      .mockResolvedValueOnce(json({ status: 'QUEUED' }))
      .mockResolvedValueOnce(json({ status: 'RUNNING' }))
      .mockResolvedValueOnce(success()).mockResolvedValueOnce(image());
    const pending = generateRunningHubImage(config, preset, values, undefined, { onPhase });
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
    expect(onPhase.mock.calls.map(c => c[0])).toEqual(['waiting', 'submitting', 'queued', 'running', 'downloading', 'success']);
    expect(fetchMock.mock.calls.filter(c => c[0].includes('/run/workflow/'))).toHaveLength(1);
  });
  it('does not retry an ambiguous submission failure', async () => {
    const { config, preset } = ready();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(generateRunningHubImage(config, preset, values)).rejects.toThrow('未自动重发');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not resubmit when polling fails; preserves the task ID for recovery', async () => {
    const { config, preset } = ready();
    fetchMock.mockResolvedValueOnce(json({ taskId: 'keep-id' })).mockResolvedValue(json({ errorMessage: 'unavailable' }, 503));
    const pending = generateRunningHubImage(config, preset, values);
    const assertion = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(4000);
    await assertion;
    expect(fetchMock.mock.calls.filter(c => c[0].includes('/run/workflow/'))).toHaveLength(1);
    expect(runningHubTasks[0]).toMatchObject({ taskId: 'keep-id', phase: 'failed' });
  });
  it('cancels the remote task even when cancellation happens before the create response', async () => {
    const { config, preset } = ready();
    const controller = new AbortController();
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(json({ code: 0 }));
    const pending = generateRunningHubImage(config, preset, values, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    finish(json({ taskId: 'cancel-me' }));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock.mock.calls[1][0]).toContain('/task/openapi/cancel');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).taskId).toBe('cancel-me');
    expect(fetchMock.mock.calls.some(c => c[0].includes('/query'))).toBe(false);
  });
  it('serializes work for the same key and aborts a waiting job without submitting it', async () => {
    const { config, preset } = ready();
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(success()).mockResolvedValueOnce(image());
    const first = generateRunningHubImage(config, preset, values);
    const controller = new AbortController();
    const second = generateRunningHubImage(config, preset, values, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    controller.abort();
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    finish(json({ taskId: 'first' }));
    await first;
    expect(fetchMock.mock.calls.filter(c => c[0].includes('/run/workflow/'))).toHaveLength(1);
  });
  it('releases the local lane on failure so the next request is not stuck', async () => {
    const { config, preset } = ready();
    fetchMock.mockResolvedValueOnce(json({ errorMessage: 'QUEUE_MAXED' }, 429));
    await expect(generateRunningHubImage(config, preset, values)).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(json({ taskId: 'retry-manual' })).mockResolvedValueOnce(success()).mockResolvedValueOnce(image());
    await expect(generateRunningHubImage(config, preset, values)).resolves.toMatchObject({ taskId: 'retry-manual' });
  });
  it('rejects invalid workflows before any request', async () => {
    const { config, preset } = ready();
    preset.workflow = preset.workflow.replace('%prompt%', '%unknown%');
    await expect(generateRunningHubImage(config, preset, values)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    { timeoutMinutes: NaN }, { timeoutMinutes: 0 }, { concurrency: 0 }, { retainSeconds: 1 },
  ])('rejects invalid execution settings before spending: %j', async patch => {
    const { config, preset } = ready();
    Object.assign(config, patch);
    await expect(generateRunningHubImage(config, preset, values)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('uploads a reference image with the documented multipart input type', async () => {
    const { config } = ready();
    fetchMock.mockResolvedValueOnce(json({ code: 0, data: { fileName: 'api/reference.png' } }));
    const file = new File(['PNG'], 'ref.png', { type: 'image/png' });
    await expect(uploadRunningHubImage(config, file)).resolves.toBe('api/reference.png');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/task/openapi/upload');
    expect(init.headers.Authorization).toBe(`Bearer ${config.apiKey}`);
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body.get('fileType')).toBe('input');
    expect(init.body.get('file').name).toBe('ref.png');
  });
  it('rejects non-image and oversized reference uploads locally', async () => {
    const { config } = ready();
    await expect(uploadRunningHubImage(config, new File(['video'], 'a.mp4', { type: 'video/mp4' }))).rejects.toThrow();
    await expect(uploadRunningHubImage(config, new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'a.png', { type: 'image/png' }))).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('only sends paid keep-alive settings when explicitly enabled', async () => {
    const { config, preset } = ready();
    config.retainSeconds = 60;
    config.instanceType = 'plus';
    fetchMock.mockResolvedValueOnce(json({ taskId: 'warm' })).mockResolvedValueOnce(success()).mockResolvedValueOnce(image());
    await generateRunningHubImage(config, preset, values);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ retainSeconds: 60, instanceType: 'plus' });
  });
  it('recovers a completed task without a new generation request', async () => {
    const { config } = ready();
    fetchMock.mockResolvedValueOnce(success()).mockResolvedValueOnce(image());
    await expect(recoverRunningHubImage(config, 'previous-task')).resolves.toMatchObject({ taskId: 'previous-task' });
    expect(fetchMock.mock.calls.some(c => c[0].includes('/run/workflow/'))).toBe(false);
  });
  it('tests account connectivity without spending on image generation', async () => {
    const { config } = ready();
    fetchMock.mockResolvedValue(json({ code: 0, data: { remainCoins: '123' } }));
    await expect(testRunningHubConnection(config)).resolves.toContain('123');
    expect(fetchMock.mock.calls[0][0]).toContain('/uc/openapi/accountStatus');
  });
  it('redacts echoed credentials in server errors', async () => {
    const { config, preset } = ready();
    fetchMock.mockResolvedValue(json({ errorMessage: `bad key: ${config.apiKey}` }, 401));
    let message = '';
    try { await generateRunningHubImage(config, preset, values); } catch (e) { message = (e as Error).message; }
    expect(message).not.toContain(config.apiKey);
    expect(message).toContain('[REDACTED]');
  });
  it('rejects downloaded HTML disguised as an image URL', async () => {
    const { config, preset } = ready();
    fetchMock.mockResolvedValueOnce(json({ taskId: 'html' })).mockResolvedValueOnce(success())
      .mockResolvedValueOnce(new Response('<html>error</html>', { headers: { 'Content-Type': 'text/html' } }));
    await expect(generateRunningHubImage(config, preset, values)).rejects.toThrow('图片格式');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

describe('image output selection', () => {
  const results = [
    { nodeId: '1', outputType: 'mp4', url: 'https://cdn.test/video.mp4' },
    { nodeId: '2', outputType: 'png', url: 'https://cdn.test/preview.png' },
    { nodeId: '18', outputType: 'png', url: 'https://cdn.test/final.png' },
  ];
  it('skips videos and selects an explicit final-image node', () => {
    expect(selectRunningHubImage(results)).toContain('preview.png');
    expect(selectRunningHubImage(results, '18')).toContain('final.png');
  });
  it('does not fall back to the wrong node or accept unsafe URLs', () => {
    expect(() => selectRunningHubImage(results, '999')).toThrow();
    expect(() => selectRunningHubImage([{ outputType: 'png', url: 'javascript:alert(1)' }])).toThrow();
  });
});
