import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPermanentApiError, readSseContent, requestCompletion } from './client';
import { records, resetHistory, type LlmRecord } from '@/state/history';

vi.mock('@/st/context', () => ({ getContext: () => ({ getRequestHeaders: () => ({}) }) }));
afterEach(() => { vi.unstubAllGlobals(); resetHistory(); });
const channel = { id: 'test', name: 'Test', url: 'https://example.test/v1', key: 'SECRET_KEY',
  model: 'test', temperature: 1, maxTokens: 1000, timeoutSec: 10, stream: true, excludeParams: [], reasoningEffort: '' };
const stream = (finish: string) => new Response([
  { choices: [{ delta: { reasoning_content: 'first' } }] },
  { choices: [{ delta: { reasoning_content: 'second' } }] },
  { choices: [{ delta: {}, finish_reason: finish }] },
].map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n');

describe('completion failures are not successful plans', () => {
  it('classifies upstream filtering as non-retryable rather than a JSON parsing error', async () => {
    const error = await readSseContent(stream('content_filter')).catch(error => error);
    expect(error.message).toContain('内容过滤');
    expect(error.code).toBe('content_filter');
    expect(isPermanentApiError(error)).toBe(true);
  });
  it('never passes a reasoning-only result to a plan parser as final content', async () => {
    await expect(readSseContent(stream('stop'))).rejects.toThrow(/仅返回思考/);
  });
  it('flushes latest progress even when filtering arrives in the same network chunk', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => stream('content_filter')));
    await expect(requestCompletion(channel, [{ role: 'user', content: 'A traveler waits for a train.' }], { direct: true }))
      .rejects.toThrow(/内容过滤/);
    const record = records[0] as LlmRecord;
    expect(record.status).toBe('error');
    expect(record.reasoningChars).toBe(11);
    expect(record.receivedChars).toBe(0);
    expect(record.finishReason).toBe('content_filter');
    expect(record.request).toMatchObject({ output: 'text', maxTokens: 1000, stream: true });
    expect(JSON.stringify(record)).not.toContain('SECRET_KEY');
  });
});
