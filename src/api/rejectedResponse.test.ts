import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { requestCompletion } from './client';
import { records, resetHistory, type LlmRecord } from '@/state/history';
import { parseImagePlan } from '@/autoTag/protocol';
import type { ApiChannel } from '@/state/settings';

vi.mock('@/st/context', () => ({
  getContext: () => ({ getRequestHeaders: () => ({ 'Content-Type': 'application/json' }) }),
}));
const channel: ApiChannel = {
  id: 'trace', name: 'Trace', url: 'https://example.test/v1', key: 'secret-not-in-history',
  model: 'model', stream: false, temperature: 1, maxTokens: 1024,
  timeoutSec: 60, excludeParams: [], reasoningEffort: '',
};
beforeEach(resetHistory);
afterEach(() => vi.unstubAllGlobals());

it('preserves the actual rejected response instead of erasing the evidence', async () => {
  const rejected = 'The intermediary did not return a model completion.';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    choices: [{ message: { content: rejected } }],
    usage: { prompt_tokens: 120, completion_tokens: 12 },
  }), { headers: { 'Content-Type': 'application/json' } })));
  await expect(requestCompletion(channel, [{ role: 'user', content: 'A train arrives.' }], {
    validate: raw => { parseImagePlan(raw, [], 0, 1); },
  })).rejects.toThrow('AI 没有返回可解析的 JSON 对象');
  const record = records[0] as LlmRecord;
  expect(record.status).toBe('error');
  expect(record.response).toBe(rejected);
  expect(record.promptTokens).toBe(120);
  expect(record.transport).toBe('proxy');
  expect(record.endpoint).toBe(channel.url);
  expect(record.httpStatus).toBe(200);
  expect(record.phase).toBe('validation');
  expect(JSON.stringify(record)).not.toContain(channel.key);
});

it('distinguishes a pending transport failure from a rejected model plan', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network unavailable'); }));
  await expect(requestCompletion(channel, [{ role: 'user', content: 'scene' }], { direct: true })).rejects.toThrow('Network unavailable');
  const record = records[0] as LlmRecord;
  expect(record.phase).toBe('request');
  expect(record.transport).toBe('direct');
  expect(record.httpStatus).toBeNull();
  expect(record.response).toBe('');
});

it('reports reasoning and plan characters while the response is still streaming', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
    headers: { 'Content-Type': 'text/event-stream' },
  })));
  const pending = requestCompletion({ ...channel, stream: true }, [{ role: 'user', content: 'scene' }]);
  const send = (delta: object) => stream.enqueue(new TextEncoder().encode(
    `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`,
  ));
  try {
    send({ reasoning_content: 'Planning.' });
    await vi.waitFor(() => {
      expect(records[0]).toMatchObject({ status: 'running', phase: 'streaming', reasoningChars: 9, receivedChars: 0 });
    });
    send({ content: '{"images":[]}' });
    await vi.waitFor(() => {
      expect(records[0]).toMatchObject({ status: 'running', receivedChars: 13, reasoningChars: 9 });
    });
  } finally {
    stream.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
    stream.close();
    await pending;
  }
});

it('keeps a non-JSON intermediary response with its received HTTP status', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Gateway timeout</html>')));
  await expect(requestCompletion(channel, [{ role: 'user', content: 'scene' }])).rejects.toThrow(/JSON/);
  const record = records[0] as LlmRecord;
  expect(record.phase).toBe('response');
  expect(record.httpStatus).toBe(200);
  expect(record.response).toBe('<html>Gateway timeout</html>');
});

it('preserves HTTP failure bodies and removes URL credentials from diagnostics', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('Provider temporarily unavailable', { status: 503 })));
  await expect(requestCompletion({ ...channel, url: 'https://user:password@example.test/v1?key=hidden#secret' },
    [{ role: 'user', content: 'scene' }])).rejects.toThrow();
  const record = records[0] as LlmRecord;
  expect(record.httpStatus).toBe(503);
  expect(record.response).toBe('Provider temporarily unavailable');
  expect(record.endpoint).toBe('https://example.test/v1');
});

it('identifies a gateway timeout wrapped by SillyTavern in HTTP 200', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    error: { message: 'Gateway Time-out' }, quota_error: false,
  }))));
  await expect(requestCompletion(channel, [{ role: 'user', content: 'scene' }]))
    .rejects.toThrow(/网关.*流式/);
  const record = records[0] as LlmRecord;
  expect(record.httpStatus).toBe(200);
  expect(record.phase).toBe('response');
  expect(record.status).toBe('error');
  expect(record.response).toContain('Gateway Time-out');
});

it.each(['application/json', 'text/plain'])('recognizes JSON errors returned to a streaming request (%s)', async contentType => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    error: { message: 'Gateway Time-out' },
  }), { headers: { 'Content-Type': contentType } })));
  await expect(requestCompletion({ ...channel, stream: true }, [{ role: 'user', content: 'scene' }]))
    .rejects.toThrow(/网关.*流式/);
  expect((records[0] as LlmRecord).response).toContain('Gateway Time-out');
});

it('keeps the SSE error event even when no final content was emitted', async () => {
  const events = [
    { choices: [{ delta: { reasoning_content: 'Planning the page.' } }] },
    { error: { message: 'Gateway Time-out', request_id: 'test-id' } },
  ];
  vi.stubGlobal('fetch', vi.fn(async () => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream' } })));
  await expect(requestCompletion({ ...channel, stream: true }, [{ role: 'user', content: 'scene' }]))
    .rejects.toThrow(/网关/);
  const record = records[0] as LlmRecord;
  expect(record.response).toContain('Gateway Time-out');
  expect(record.response).toContain('test-id');
  expect(record.phase).toBe('streaming');
  expect(record.reasoningChars).toBe(18);
  expect(record.status).toBe('error');
});
