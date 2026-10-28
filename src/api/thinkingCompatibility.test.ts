import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRequestBody, requestCompletion, testChannel } from './client';
import { IMAGE_PLAN_TOOL_NAME } from './imagePlanTool';
import type { ApiChannel } from '@/state/settings';

vi.mock('@/st/context', () => ({
  getContext: () => ({ getRequestHeaders: () => ({ 'Content-Type': 'application/json' }) }),
}));
vi.mock('@/state/history', () => ({
  FOLLOW_MAIN_API: 'main', beginLlm: () => null, finishLlm: vi.fn(), failLlm: vi.fn(),
  patchLlmTokens: vi.fn(), safeHistory: (fn: () => unknown) => fn(),
}));
afterEach(() => vi.unstubAllGlobals());

const channel: ApiChannel = {
  id: 'thinking', name: 'Thinking endpoint', url: 'https://example.test/v1', key: 'test-only',
  model: 'thinking-model', temperature: 1, maxTokens: 1024, timeoutSec: 10,
  stream: false, excludeParams: [], reasoningEffort: 'high',
};
const messages = [{ role: 'user' as const, content: 'Plan one scene at a train station.' }];
const plan = JSON.stringify({ images: [{ position: 'P1', tag: 'train station', size: 'portrait' }], changes: [] });

describe('thinking-mode request compatibility', () => {
  it.each([
    { direct: false, stream: false, reasoningEffort: '' },
    { direct: false, stream: true, reasoningEffort: 'high' },
    { direct: true, stream: false, reasoningEffort: 'high' },
    { direct: true, stream: true, reasoningEffort: '' },
  ])('does not force a function when submitting a plan ($direct, stream=$stream, effort=$reasoningEffort)', async options => {
    const { direct, stream, reasoningEffort } = options;
    const fetch = vi.fn(async (_url: unknown, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      const upstream = direct ? body : { ...body, ...JSON.parse(body.custom_include_body ?? '{}') };
      if (upstream.tool_choice !== 'auto') {
        return new Response(JSON.stringify({ error: { message: 'Thinking mode does not support this tool_choice' } }), { status: 400 });
      }
      expect(upstream.tools).toHaveLength(1);
      expect(upstream.tools[0].function.name).toBe(IMAGE_PLAN_TOOL_NAME);
      expect(upstream.reasoning_effort).toBe(reasoningEffort || undefined);
      if (stream) return new Response(`data: ${JSON.stringify({ choices: [{
        delta: { tool_calls: [{ index: 0, type: 'function', function: { name: IMAGE_PLAN_TOOL_NAME, arguments: plan } }] },
        finish_reason: 'tool_calls',
      }] })}\n\ndata: [DONE]\n\n`);
      return new Response(JSON.stringify({ choices: [{
        message: { content: null, tool_calls: [{
          type: 'function', function: { name: IMAGE_PLAN_TOOL_NAME, arguments: plan },
        }] }, finish_reason: 'tool_calls',
      }] }));
    });
    vi.stubGlobal('fetch', fetch);
    await expect(requestCompletion({ ...channel, stream, reasoningEffort }, messages, { direct, imagePlanTool: true })).resolves.toBe(plan);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('keeps the channel test independent of the preset and tools', async () => {
    const fetch = vi.fn(async (_url: unknown, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].content).not.toContain('MOSS');
      expect(body.tools).toBeUndefined();
      expect(body.tool_choice).toBe('none');
      expect(JSON.parse(body.custom_include_body)).toEqual({ reasoning_effort: 'high' });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    });
    vi.stubGlobal('fetch', fetch);
    expect((await testChannel(channel)).ok).toBe(true);
  });

  it('keeps the local interception handshake out of custom text passthrough fields', () => {
    const body = buildRequestBody(channel, messages, channel.url, false);
    expect(body.tool_choice).toBe('none');
    expect(body.tools).toBeUndefined();
    expect(JSON.parse(body.custom_include_body as string)).not.toHaveProperty('tool_choice');
  });

  it.each([false, true])('explains an upstream routing failure without changing model or retrying (direct=%s)', async direct => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: {
      message: 'AI Studio 请求参数无效：模型限定使用 build 通道，此请求含文件引用或只有 Playground 支持的参数。PROXY_GENERATION_DISABLED: generateContent is not supported',
    } }), { status: 400 }));
    vi.stubGlobal('fetch', fetch);
    const tested = { ...channel };
    const result = await testChannel(tested, direct);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('上游代理');
    expect(result.message).toContain('不是配图预设');
    expect(result.message).toContain('PROXY_GENERATION_DISABLED');
    expect(fetch).toHaveBeenCalledOnce();
    expect(tested).toEqual(channel);
  });

  it.each([
    { stream: false, message: 'Thinking mode does not support this tool_choice', hint: '工具选择参数' },
    { stream: true, message: 'Thinking mode does not support this tool_choice', hint: '工具选择参数' },
    { stream: false, message: 'PROXY_GENERATION_DISABLED: generateContent is not supported', hint: '上游代理' },
    { stream: true, message: 'PROXY_GENERATION_DISABLED: generateContent is not supported', hint: '上游代理' },
  ])('explains errors inside successful HTTP responses (stream=$stream, $hint)', async ({ stream, message, hint }) => {
    const payload = JSON.stringify({ error: { message } });
    const fetch = vi.fn(async () => new Response(stream ? `data: ${payload}\n\n` : payload));
    vi.stubGlobal('fetch', fetch);
    let failure: unknown;
    try { await requestCompletion({ ...channel, stream }, messages, { imagePlanTool: true }); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(hint);
    expect((failure as Error).message).toContain(message);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not classify unrelated provider errors as a routing failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('insufficient balance', { status: 400 })));
    const result = await testChannel(channel);
    expect(result.message).toBe('副 API 请求失败 (400): insufficient balance');
  });
});
