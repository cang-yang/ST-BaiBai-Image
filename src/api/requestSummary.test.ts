import { describe, expect, it } from 'vitest';
import { summarizeRequest } from './requestSummary';

describe('safe request diagnostics', () => {
  it('records actual protocol and parameters without retaining headers or prompt contents', () => {
    const summary = summarizeRequest({ model: 'test', stream: true, temperature: 1, max_tokens: 30000,
      tool_choice: 'auto', parallel_tool_calls: false,
      tools: [{ type: 'function', function: { name: 'submit_image_plan', description: 'PRIVATE_RULES' } }],
      messages: [{ role: 'system', content: 'PRIVATE_TEXT' }, { role: 'user', content: 'story' }],
      custom_include_headers: '{"Authorization":"SECRET_KEY"}', key: 'SECRET_KEY',
    });
    expect(summary).toMatchObject({ model: 'test', stream: true, output: 'tool', toolNames: ['submit_image_plan'],
      toolChoice: 'auto', maxTokens: 30000, temperature: 1, messageCount: 2, inputCharacters: 17 });
    expect(JSON.stringify(summary)).not.toMatch(/SECRET_KEY|PRIVATE_TEXT|PRIVATE_RULES|Authorization/);
  });
  it('describes text mode and absent parameters without inventing defaults', () => {
    expect(summarizeRequest({ model: 'test', messages: [] })).toMatchObject({
      output: 'text', toolNames: [], maxTokens: null, temperature: null, toolChoice: null,
      messageCount: 0, inputCharacters: 0,
    });
  });
  it('reads proxy reasoning options without retaining unrelated custom fields', () => {
    const summary = summarizeRequest({ custom_include_body: JSON.stringify({ reasoning_effort: 'high', secret: 'SECRET_KEY' }) });
    expect(summary.reasoningEffort).toBe('high');
    expect(JSON.stringify(summary)).not.toContain('SECRET_KEY');
    expect(summarizeRequest({ custom_include_body: 'invalid yaml' }).reasoningEffort).toBeNull();
  });
});
