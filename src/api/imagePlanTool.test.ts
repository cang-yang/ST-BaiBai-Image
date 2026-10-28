import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDirectBody, buildRequestBody, extractCompletion, fetchModels, readSseContent, requestCompletion, requestViaMainApi } from './client';
import { IMAGE_PLAN_TOOL_NAME, imagePlanArguments } from './imagePlanTool';
import type { ApiChannel } from '@/state/settings';

const mocks = vi.hoisted(() => ({ validate: vi.fn(), finish: vi.fn(), fail: vi.fn(), main: vi.fn(async () => 'main answer') }));
vi.mock('@/state/history', () => ({
  FOLLOW_MAIN_API: 'main', beginLlm: () => 1, finishLlm: mocks.finish, failLlm: mocks.fail,
  patchLlmTokens: vi.fn(), safeHistory: (f: () => unknown) => f(),
}));
vi.mock('@/st/context', () => ({ getContext: () => ({ getRequestHeaders: () => ({ 'X-CSRF-Token': 'HOST_SECRET' }), generateRaw: mocks.main }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const channel: ApiChannel = {
  id: 'test', name: 'test', url: 'https://example.test/v1', key: 'api-key', model: 'm',
  temperature: 1, maxTokens: 1000, timeoutSec: 10, stream: false, excludeParams: [], reasoningEffort: '',
};
const messages = [{ role: 'user' as const, content: 'story' }];
const plan = { images: [{ position: 'P1', tag: 'landscape', size: 'portrait' }], changes: [] };
const call = { type: 'function', function: { name: IMAGE_PLAN_TOOL_NAME, arguments: JSON.stringify(plan) } };
const toolResponse = () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [call] }, finish_reason: 'tool_calls' }] }));
function sse(events: unknown[], trailer = '\ndata: [DONE]'): Response {
  const text = events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join('') + trailer;
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    // Deliberately split every byte, including multi-byte Chinese characters.
    for (const value of bytes) controller.enqueue(new Uint8Array([value]));
    controller.close();
  } }));
}

describe('controlled tool output', () => {
  it('passes tools through ST custom body, without losing tool choice', () => {
    const body = buildRequestBody(channel, messages, channel.url, true, undefined, true);
    const include = JSON.parse(body.custom_include_body as string);
    expect(body.chat_completion_source).toBe('custom');
    expect(include.tools).toHaveLength(1);
    expect(include.tool_choice).toBe('auto');
    expect(body.tool_choice).toEqual(include.tool_choice);
    expect(include.parallel_tool_calls).toBe(false);
    expect(() => buildRequestBody({ ...channel, excludeParams: ['tools'] }, messages, channel.url, false, undefined, true)).toThrow();
  });
  it('normalizes only one known function with complete structured arguments', () => {
    expect(JSON.parse(imagePlanArguments([call]))).toEqual(plan);
    expect(JSON.parse(extractCompletion({ choices: [{ message: { tool_calls: [call] } }] }, true))).toEqual(plan);
    for (const calls of [[], [call, call], [{ ...call, function: { name: 'execute_shell', arguments: '{}' } }], [{ ...call, function: { ...call.function, arguments: '{' } }]]) {
      expect(() => imagePlanArguments(calls)).toThrow();
    }
    expect(() => extractCompletion({ choices: [{ message: { tool_calls: [call] } }] })).toThrow(/工具/);
    expect(() => extractCompletion({ choices: [{ message: { content: 'fake success' }, finish_reason: 'length' }] })).toThrow(/未完成/);
  });
  it('assembles streaming tool arguments across byte boundaries, including unterminated final lines', async () => {
    const args = JSON.stringify({ ...plan, images: [{ ...plan.images[0], tag: '雨中的城市' }] });
    const chunks = [
      { choices: [{ delta: { tool_calls: [{ index: 0, type: 'function', function: { name: IMAGE_PLAN_TOOL_NAME, arguments: args.slice(0, 25) } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(25) } }] }, finish_reason: 'tool_calls' }] },
    ];
    const onDelta = vi.fn();
    const response = await readSseContent(sse(chunks), { imagePlanTool: true, onDelta });
    expect(JSON.parse(response).images[0].tag).toBe('雨中的城市');
    expect(onDelta).toHaveBeenCalled();
  });
  it('never accepts truncated, missing or multiple tool calls', async () => {
    const event = { choices: [{ delta: { tool_calls: [{ index: 0, ...call }] } }] };
    await expect(readSseContent(sse([event], ''), { imagePlanTool: true })).rejects.toThrow(/中断/);
    await expect(readSseContent(sse([{ choices: [{ delta: {}, finish_reason: 'length' }] }]), { imagePlanTool: true })).rejects.toThrow(/未完成/);
    await expect(readSseContent(sse([]), { imagePlanTool: true })).rejects.toThrow(/必须/);
    await expect(readSseContent(sse([{ choices: [{ delta: { tool_calls: [{ index: 0, ...call }, { index: 1, ...call }] } }] }]), { imagePlanTool: true })).rejects.toThrow(/只能/);
  });
  it('flushes a text stream final line without newline', async () => {
    const resp = new Response('data: {"choices":[{"delta":{"content":"final line"}}]}');
    expect(await readSseContent(resp)).toBe('final line');
  });
});

describe('direct and proxy request lifecycle', () => {
  it('sends only API headers/body to the selected endpoint and validates before success', async () => {
    const fetch = vi.fn(async () => toolResponse());
    vi.stubGlobal('fetch', fetch);
    await requestCompletion(channel, messages, { direct: true, imagePlanTool: true, validate: mocks.validate });
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.test/v1/chat/completions');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer api-key' });
    expect(options.credentials).toBe('omit');
    expect(options.redirect).toBe('error');
    expect(JSON.stringify(options)).not.toContain('HOST_SECRET');
    const body = JSON.parse(options.body as string);
    expect(body.tools[0].function.name).toBe(IMAGE_PLAN_TOOL_NAME);
    expect(body.chat_completion_source).toBeUndefined();
    expect(mocks.validate).toHaveBeenCalledWith(JSON.stringify(plan));
    expect(mocks.finish).toHaveBeenCalledOnce();
  });
  it('keeps failed plan validation out of successful history', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => toolResponse()));
    await expect(requestCompletion(channel, messages, { imagePlanTool: true, validate: () => { throw new Error('invalid position'); } })).rejects.toThrow('invalid position');
    expect(mocks.finish).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledOnce();
  });
  it('protects direct protocol fields and reports browser/network failures', async () => {
    expect(() => buildDirectBody({ ...channel, excludeParams: ['messages'] }, messages, false)).toThrow();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(requestCompletion(channel, messages, { direct: true })).rejects.toThrow(/CORS/);
    await expect(requestCompletion({ ...channel, url: 'file:///secret' }, messages, { direct: true })).rejects.toThrow(/HTTP/);
  });
  it('uses matching direct transport for model discovery', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'model-a' }] })));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchModels(channel, true)).toEqual(['model-a']);
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.test/v1/models');
    expect(options.method).toBe('GET');
    expect(options.headers).toEqual({ Authorization: 'Bearer api-key' });
    expect(options.body).toBeUndefined();
  });
  it('rejects unsupported main-API tool mode and observes cancellation', async () => {
    await expect(requestViaMainApi(messages, { imagePlanTool: true })).rejects.toThrow(/独立/);
    const ctrl = new AbortController(); ctrl.abort();
    await expect(requestViaMainApi(messages, { signal: ctrl.signal })).rejects.toThrow();
    expect(mocks.main).not.toHaveBeenCalled();
  });
});
