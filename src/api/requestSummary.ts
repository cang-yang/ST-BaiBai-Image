/** Allowlisted local diagnostics only. Never retain a body, headers or tool descriptions. */
export interface RequestSummary {
  model: string;
  stream: boolean;
  output: 'text' | 'tool';
  toolNames: string[];
  toolChoice: string | null;
  maxTokens: number | null;
  temperature: number | null;
  reasoningEffort: string | null;
  messageCount: number;
  inputCharacters: number;
}

export function summarizeRequest(body: Record<string, unknown>): RequestSummary {
  let reasoningEffort = body.reasoning_effort;
  if (typeof body.custom_include_body === 'string') {
    try { reasoningEffort = JSON.parse(body.custom_include_body)?.reasoning_effort ?? reasoningEffort; }
    catch { /* Diagnostic parsing must not affect the request. */ }
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  return {
    model: typeof body.model === 'string' ? body.model : '',
    stream: body.stream === true,
    output: tools.length ? 'tool' : 'text',
    toolNames: tools.map(tool => typeof tool?.function?.name === 'string' ? tool.function.name.slice(0, 128) : '').filter(Boolean),
    toolChoice: typeof body.tool_choice === 'string' ? body.tool_choice : null,
    maxTokens: finite(body.max_tokens),
    temperature: finite(body.temperature),
    reasoningEffort: typeof reasoningEffort === 'string' ? reasoningEffort : null,
    messageCount: messages.length,
    inputCharacters: messages.reduce((sum, message) => sum + (typeof message?.content === 'string' ? message.content.length : 0), 0),
  };
}
