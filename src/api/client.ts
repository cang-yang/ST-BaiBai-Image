import { getContext } from '@/st/context';
import type { ApiChannel } from '@/state/settings';
import { IMAGE_PLAN_TOOLS, IMAGE_PLAN_TOOL_CHOICE, imagePlanArguments } from './imagePlanTool';
import { summarizeRequest } from './requestSummary';
import {
  beginLlm,
  failLlm,
  finishLlm,
  patchLlmTokens,
  patchLlmResponse,
  safeHistory,
  FOLLOW_MAIN_API,
} from '@/state/history';

/**
 * 通过 SillyTavern 的服务端代理调用任意 OpenAI 兼容端点。
 * (与柏宝书 src/api/client.ts 同源,行为保持一致。)
 *
 * 关键:以 chat_completion_source='openai' + reverse_proxy(base url)+ proxy_password(key)
 * 走 /api/backends/chat-completions/generate。请求由 ST 服务端转发,
 * 因此没有浏览器 CORS 问题,也无需把密钥存进 ST 的 secrets。
 */

const GENERATE_URL = '/api/backends/chat-completions/generate';
const DEFAULT_TIMEOUT_SEC = 180;

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Local grouping only; never forwarded as an OpenAI message field. */
  purpose?: 'prefix' | 'spec' | 'contract' | 'check';
  /** Local provenance label, stripped by wireMessages. */
  source?: string;
}

export interface DshSessionRequest {
  protocol_version: 1;
  chat_id: string;
  session_id?: string;
  request_id: string;
  action: 'generate' | 'sync_rules' | 'reset';
  fixed_message_count: number;
  fixed_message_types: NonNullable<ChatMsg['purpose']>[];
  target?: { floor: number; swipe_id: number | null; revision: string };
}

export function wireMessages(messages: ChatMsg[]): ChatMsg[] {
  return messages.map(({role,content})=>({role,content}));
}

export class ApiError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: 'content_filter' | 'incomplete_output' | 'reasoning_only') {
    super(message);
    this.name = 'ApiError';
  }
}

export function isPermanentApiError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'content_filter' || (error.status !== undefined &&
    [400, 401, 402, 403, 404, 405, 413, 415, 422].includes(error.status)));
}

function checkFinishReason(reason: unknown): void {
  if (reason === 'content_filter') throw new ApiError('上游返回内容过滤 (content_filter)，未交付可用的配图结果。已停止自动重试，请检查请求内容和服务商说明。', undefined, 'content_filter');
  if (reason === 'length') throw new ApiError('副 API 输出未完成 (length)：达到上游输出上限，不能使用截断的配图结果。', undefined, 'incomplete_output');
}

function upstreamError(message: string, status?: number): ApiError {
  let hint = '';
  if (/PROXY_GENERATION_DISABLED/i.test(message) || (/AI Studio/i.test(message) && /build/i.test(message) && /Playground/i.test(message))) {
    hint = '上游代理的模型通道不兼容（Build/Playground），不是配图预设或生图工作流错误。请在代理端检查该模型的路由和参数支持，或联系代理服务商。';
  } else if (/Thinking mode does not support this tool_choice/i.test(message)) {
    hint = '服务商不接受思考模式下的当前工具选择参数。请确认插件已更新；仍失败时可改用支持工具调用的渠道，或在配图预设中选择普通文本。';
  } else if (status === 504 || /gateway[\s-]*time[\s-]*out/i.test(message)) {
    hint = '上游网关等待超时，未取得完整模型结果；这不等于预设 JSON 错误。可在副 API 渠道开启流式传输，仍失败时检查中转网关的超时限制。';
  }
  const prefix = status === undefined ? '副 API 返回错误' : `副 API 请求失败 (${status})`;
  return new ApiError(`${prefix}: ${hint ? `${hint}\n上游原始错误：` : ''}${message.slice(0, 300)}`, status);
}

/**
 * 规范化 OpenAI 兼容 base url:
 * - 用户填完整 /chat/completions 时只去掉端点后缀;
 * - 纯域名自动补 /v1;
 * - 已带路径的地址原样保留,避免破坏 /v2/coding 等自定义路由。
 */
function normalizeUrl(url: string): string {
  const u = url.trim().replace(/\/+$/, '');
  if (!u) return u;
  if (/\/chat\/completions$/i.test(u)) return u.replace(/\/chat\/completions$/i, '');
  if (/^https?:\/\/[^/?#]+$/i.test(u)) return `${u}/v1`;
  return u;
}

/** 测试渠道时备用的 /v1 形式。只在首个地址明确返回 404/405 时才会尝试。 */
function alternateUrl(url: string): string {
  return /\/v1$/i.test(url) ? url.replace(/\/v1$/i, '') : `${url}/v1`;
}

export interface RequestOptions {
  imagePlanTool?: boolean;
  direct?: boolean;
  /** Preview only; incomplete deltas must never be used to generate an image. */
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
  /**
   * 用途标签,只用于请求历史页的展示(如「自动 tag」)。
   * 不传也不影响请求本身,历史里显示为「未标注」。
   */
  source?: string;
  /**
   * 调用方验收回调:拿到文本后、记入历史前执行。
   *
   * 历史里「成功」的口径是「调用方验收通过」,不是「HTTP 拿到了文本」——
   * 否则「返回了但协议解析不过 → 调用方重试」会留下两条绿色成功记录,
   * 看历史的人会误以为成功也重复调用。验收抛错 = 记为失败并把错误原样抛出,
   * 由调用方决定重试/放弃。
   */
  validate?: (content: string) => void;
  /** DSH bridge metadata is sent through ST's custom source to preserve it. */
  dshSession?: DshSessionRequest;
  onDshResponse?: (data: unknown) => void;
}

/* ============ 请求历史埋点(纯辅助,绝不允许影响主流程) ============ */

/** 从响应体取 OpenAI 标准 usage。ST 代理非流式分支原样透传上游 JSON,故这里拿到的是真值。 */
export function readUsage(data: any): { prompt: number | null; completion: number | null; cached: number | null } {
  const usage = data?.usage;
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
  const prompt = num(usage?.prompt_tokens);
  const cached = num(usage?.prompt_cache_hit_tokens) ?? num(usage?.prompt_tokens_details?.cached_tokens);
  return {
    prompt,
    completion: num(usage?.completion_tokens),
    cached: cached !== null && (prompt === null || cached <= prompt) ? cached : null,
  };
}

/**
 * 本地估算 token(拿不到真值时的兜底):流式与「跟随主 API」两条路都没有 usage。
 *
 * 用 ST 的 getTokenCountAsync —— 但它用的是**主界面当前模型**的分词器,
 * 与副 API 渠道的模型未必同源,所以结果只能当估算,UI 上以 ≈ 标注。
 * 任何失败都降级为 null(不显示数字),不抛。
 */
async function estimateTokens(id: number, messages: ChatMsg[], response: string): Promise<void> {
  try {
    const count = getContext()?.getTokenCountAsync;
    if (typeof count !== 'function') return;
    const promptText = messages.map(m => m.content).join('\n');
    const prompt = await count(promptText);
    const completion = response ? await count(response) : 0;
    safeHistory(() =>
      patchLlmTokens(
        id,
        typeof prompt === 'number' ? prompt : null,
        typeof completion === 'number' ? completion : null,
      ),
    );
  } catch (e) {
    console.debug('[柏宝绘] token 估算失败(已忽略)', e);
  }
}

function validTimeoutSec(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_TIMEOUT_SEC;
}

/**
 * 给完整请求生命周期套超时:不仅覆盖 fetch 建连,也覆盖非流式 JSON 读取和流式 SSE 读取。
 * 外部 signal 仍可提前取消;只有本定时器触发时才转换成明确的超时报错。
 */
async function withTimeout<T>(
  timeoutSec: number,
  externalSignal: AbortSignal | undefined,
  label: string,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const ctrl = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => ctrl.abort();
  if (externalSignal?.aborted) onExternalAbort();
  else externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, Math.max(1000, timeoutSec * 1000));

  try {
    return await task(ctrl.signal);
  } catch (e) {
    if (timedOut) throw new ApiError(`${label}超时(>${timeoutSec}秒)`);
    throw e;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * 发起一次补全请求,返回文本内容。
 */
export async function requestCompletion(
  channel: ApiChannel,
  messages: ChatMsg[],
  opts: RequestOptions = {},
): Promise<string> {
  return requestCompletionAtUrl(channel, messages, normalizeUrl(channel.url), opts);
}

/**
 * 构造发给 ST 代理的请求体(纯函数,便于测两条分支的产物)。
 *
 * 普通文本按渠道有没有设思考强度二选一；工具模式使用 custom 源透传完整工具定义。
 *
 * ① 未设(reasoningEffort 为空 = auto):走 `chat_completion_source: 'openai'`,
 *    除下面固定的 `tool_choice` 外,与加本功能之前**逐字节一致**——存量用户零变化。
 *
 * ② 已设:走 `'custom'`。因为 ST 代理对 openai 源的 reasoning_effort 卡**模型名白名单**
 *    (src/constants.js 的 OPENAI_REASONING_EFFORT_MODELS,精确匹配 o1/o3/gpt-5 那批),
 *    模型名对不上就静默丢弃、还照样返回 200(实测确认),用户设了却无效且看不出来。
 *    custom 源的 custom_include_body 由服务端 mergeObjectWithYaml 直接并进上游请求体,
 *    不过任何白名单,任意字段/嵌套对象都能透传。
 *
 * 两条路都仍然走 ST 服务端转发(同一个 /generate 端点),没有浏览器直连,
 * 因此不受上游浏览器 CORS 限制。可选直连由 buildDirectBody 单独构造。
 *
 * custom 源的两个坑(都已规避):
 * - 它**不读 proxy_password**,只读 ST 自己存的 Custom 密钥,所以 key 必须靠
 *   custom_include_headers 注入 Authorization(服务端 `...headers` 排在默认
 *   Authorization 之后,覆盖成立);
 * - custom_include_* 是 YAML 字符串且**解析失败会静默忽略**(util.js 的 catch 是空的)。
 *   key 里带 `:` `#` `{` 或以 `*` 开头都会让 YAML 解析炸 → header 没注入 →
 *   退回用 ST 的 Custom 密钥,可能把用户另一个服务商的 key 发到本端点。
 *   故一律用 JSON.stringify 生成(YAML 是 JSON 的超集),转义交给它,不手拼。
 *
 * 另:普通文本请求体带 `tool_choice: 'none'`,这是给第三方 fetch 拦截器的声明式放行握手。
 * 酒馆助手预设脚本(如 Kemini Dramatron 面板)可能 monkey-patch `window.parent.fetch`,
 * 拦截所有 `/api/backends/…/generate` 请求并注入合成工具 + 控制消息,让模型把整段输出
 * 塞进工具调用。对生图 tag 这种「要严格 JSON 协议」的请求,它会把控制消息插进对话、
 * 诱导模型改用工具调用而非直接输出 JSON,拖慢数倍甚至逼出重试。
 * 这类拦截器普遍支持「调用方自带 tool_choice 就放行」(Dramatron 的 callerControlsTools
 * 对 'none' 明确 bypass),所以我们主动声明不用工具。
 * 对上游无影响:ST 服务端只在 tools 为非空数组时才转发 tool_choice
 * (src/endpoints/backends/chat-completions.js),普通文本模式不发 tools,该字段到不了服务商。
 * 工具模式则显式发送受控的 tool_choice 和 tools。
 *
 * (与柏宝书 src/api/client.ts 的同名函数同源,行为保持一致。)
 */
export function buildRequestBody(
  channel: ApiChannel,
  messages: ChatMsg[],
  reverseProxy: string,
  stream: boolean,
  dshSession?: DshSessionRequest,
  imagePlanTool = false,
): Record<string, unknown> {
  const effort = channel.reasoningEffort?.trim() ?? '';
  const common = {
    model: channel.model,
    messages: wireMessages(messages),
    temperature: channel.temperature ?? 1.0,
    max_tokens: channel.maxTokens ?? 65535,
    stream,
    // 不用工具:见函数头注释,防第三方 fetch 拦截器把生图 tag 改写成工具调用
    tool_choice: 'none',
    // 静默:不影响主对话状态
    presence_penalty: 0,
    frequency_penalty: 0,
  };

  const toolFields = imagePlanTool ? { tools: IMAGE_PLAN_TOOLS, tool_choice: IMAGE_PLAN_TOOL_CHOICE, parallel_tool_calls: false } : {};
  const body: Record<string, unknown> = effort || dshSession || imagePlanTool
    ? {
        chat_completion_source: 'custom',
        custom_url: reverseProxy,
        custom_include_headers: JSON.stringify({ Authorization: `Bearer ${channel.key || ''}` }),
        custom_include_body: JSON.stringify({ ...(effort ? {reasoning_effort:effort} : {}), ...(dshSession ? {dsh_session:dshSession} : {}), ...toolFields }),
        ...common,
        ...toolFields,
      }
    : {
        chat_completion_source: 'openai',
        reverse_proxy: reverseProxy,
        proxy_password: channel.key || '',
        ...common,
      };

  // 排除参数:把用户指定的字段从 body 删掉,规避不接受这些参数的兼容端点报错。
  for (const p of channel.excludeParams ?? []) {
    const key = p.trim();
    if (imagePlanTool && ['messages', 'tools', 'tool_choice', 'parallel_tool_calls', 'stream', 'custom_include_body', 'custom_include_headers', 'chat_completion_source', 'custom_url'].includes(key)) throw new ApiError(`工具输出不能排除参数 ${key}`);
    if (dshSession && ['messages','stream','custom_include_body','custom_include_headers','chat_completion_source','custom_url'].includes(key)) throw new ApiError(`DSH 持久会话不能排除参数 ${key}`);
    if (key) delete body[key];
  }
  return body;
}

export function buildDirectBody(channel: ApiChannel, messages: ChatMsg[], stream: boolean, imagePlanTool = false): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: channel.model, messages: wireMessages(messages), stream,
    temperature: channel.temperature ?? 1, max_tokens: channel.maxTokens ?? 65535,
    ...(channel.reasoningEffort?.trim() ? { reasoning_effort: channel.reasoningEffort.trim() } : {}),
    ...(imagePlanTool ? { tools: IMAGE_PLAN_TOOLS, tool_choice: IMAGE_PLAN_TOOL_CHOICE, parallel_tool_calls: false } : {}),
  };
  for (const key of channel.excludeParams ?? []) {
    if (['model', 'messages', 'stream'].includes(key.trim()) || (imagePlanTool && ['tools', 'tool_choice', 'parallel_tool_calls'].includes(key.trim()))) throw new ApiError(`直连请求不能排除参数 ${key}`);
    delete body[key.trim()];
  }
  return body;
}

function directEndpoint(base: string, endpoint: string): string {
  let url: URL;
  try { url = new URL(`${base}/${endpoint}`); } catch { throw new ApiError('直连 API 地址不是有效的网址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new ApiError('直连 API 地址只能使用不含账号、查询参数或片段的 HTTP(S) 地址');
  return url.href;
}

function diagnosticEndpoint(base: string): string {
  try {
    const url = new URL(base);
    return `${url.origin}${url.pathname}`;
  } catch { return ''; }
}

async function requestCompletionAtUrl(
  channel: ApiChannel,
  messages: ChatMsg[],
  reverseProxy: string,
  opts: RequestOptions = {},
): Promise<string> {
  const ctx = getContext();
  if (!ctx) throw new ApiError('SillyTavern 上下文不可用');
  if (!channel.url || !channel.model) throw new ApiError('副 API 渠道未配置完整(缺 url 或 model)');

  const stream = opts.dshSession ? false : channel.stream ?? false;
  if (opts.dshSession && (opts.direct || opts.imagePlanTool)) throw new ApiError('DSH 会话暂不能与直连或工具输出同时使用');
  const body = opts.direct
    ? buildDirectBody(channel, messages, stream, opts.imagePlanTool)
    : buildRequestBody(channel, messages, reverseProxy, stream, opts.dshSession, opts.imagePlanTool);
  const endpoint = opts.direct ? directEndpoint(reverseProxy, 'chat/completions') : GENERATE_URL;

  const timeoutSec = validTimeoutSec(channel.timeoutSec);

  // 历史埋点:登记在真正发请求之前,失败/超时也留痕(排查时要看的往往正是失败那次)。
  const historyId = safeHistory(() =>
    beginLlm({
      source: opts.source || '未标注',
      channelName: channel.name || channel.model || '(未命名渠道)',
      model: channel.model,
      stream,
      messages,
      transport: opts.direct ? 'direct' : 'proxy',
      endpoint: diagnosticEndpoint(reverseProxy),
      request: summarizeRequest(body),
    }),
  );

  let partialResponse = '';
  let streamEvidence = '';
  try {
    const result = await withTimeout(timeoutSec, opts.signal, '副 API 请求', async signal => {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: opts.direct ? { 'Content-Type': 'application/json', ...(channel.key ? { Authorization: `Bearer ${channel.key}` } : {}) } : ctx.getRequestHeaders(),
        ...(opts.direct ? { credentials: 'omit' as const, redirect: 'error' as const } : {}),
        body: JSON.stringify(body),
        signal,
      });
      if (historyId !== null) safeHistory(() => patchLlmResponse(historyId, { phase: 'response', httpStatus: resp.status }));

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        if (historyId !== null) safeHistory(() => patchLlmResponse(historyId, { response: text }));
        throw upstreamError(text, resp.status);
      }

      // 流式:按 SSE 增量拼接;非流式:直接解析 JSON。
      if (stream && !/\bjson\b/i.test(resp.headers.get('content-type') ?? '')) {
        let lastProgressAt = 0, showedContent = false;
        let latestProgress: { receivedChars: number; reasoningChars: number } | undefined;
        let streamed: string;
        try {
          streamed = await readSseContent(resp, { ...opts, onProgress: progress => {
            latestProgress = progress;
            const firstContent = !showedContent && progress.receivedChars > 0;
            if (!lastProgressAt || firstContent || Date.now() - lastProgressAt >= 200) {
              lastProgressAt = Date.now();
              showedContent ||= firstContent;
              if (historyId !== null) safeHistory(() => patchLlmResponse(historyId, { phase: 'streaming', ...progress }));
            }
          }, onFinishReason: finishReason => {
            if (historyId !== null) safeHistory(() => patchLlmResponse(historyId, { finishReason }));
          }, onEvidence: text => { streamEvidence = text; }, onDelta: text => {
            partialResponse = text;
            opts.onDelta?.(text);
          } });
        } finally {
          if (historyId !== null && latestProgress) safeHistory(() => patchLlmResponse(historyId, latestProgress!));
        }
        if (!streamed) throw new ApiError('副 API 返回空内容');
        // 流式无 usage:ST 构造上游请求体是字段白名单,不含 stream_options,
        // 没法让上游在末尾回 usage chunk。只能事后本地估算。
        return { content: streamed, usage: { prompt: null, completion: null, cached: null } };
      }

      const raw = await resp.text();
      if (historyId !== null) safeHistory(() => patchLlmResponse(historyId, { response: raw }));
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new ApiError('副 API 返回的接口响应不是有效 JSON，请在请求历史中查看原始响应。');
      }
      if (historyId !== null) safeHistory(() => patchLlmResponse(historyId, {
        response: extractContent(data) || JSON.stringify(data?.choices?.[0]?.message ?? data),
        promptTokens: readUsage(data).prompt,
        completionTokens: readUsage(data).completion,
        cacheReadTokens: readUsage(data).cached,
        finishReason: typeof data?.choices?.[0]?.finish_reason === 'string' ? data.choices[0].finish_reason : undefined,
      }));
      if (data?.error) {
        throw upstreamError(data.error.message || '副 API 返回错误');
      }

      opts.onDshResponse?.(data);
      if (opts.dshSession && opts.dshSession.action !== 'generate') {
        return {content:extractContent(data) || (opts.dshSession.action==='reset' ? 'DSH 会话已重建' : '固定规范已发送'),usage:readUsage(data)};
      }
      const parsed = extractCompletion(data, opts.imagePlanTool);
      if (!parsed) throw new ApiError('副 API 返回空内容');
      // ST 代理非流式分支是 response.send(json) 原样透传,故 usage 是上游真值。
      return { content: parsed, usage: readUsage(data) };
    });

    // 验收在记历史之前:验收不过 → 落进 catch 记失败,不给「HTTP 成功」的假象
    if (historyId !== null) safeHistory(() => patchLlmResponse(historyId, {
      phase: 'validation', response: result.content, promptTokens: result.usage.prompt,
      completionTokens: result.usage.completion, cacheReadTokens: result.usage.cached,
    }));
    opts.validate?.(result.content);

    if (historyId !== null) {
      const hasReal = result.usage.prompt !== null;
      safeHistory(() =>
        finishLlm(historyId, {
          response: result.content,
          promptTokens: result.usage.prompt,
          completionTokens: result.usage.completion,
          cacheReadTokens: result.usage.cached,
          tokensEstimated: false,
        }),
      );
      // 没有真值(流式)才估算。估算是异步的,不 await——不能让它拖慢主流程。
      if (!hasReal) void estimateTokens(historyId, messages, result.content);
    }
    return result.content;
  } catch (e) {
    if (opts.direct && e instanceof TypeError) e = new ApiError('浏览器直连失败：请检查网络、HTTPS 和服务商 CORS 许可，或改用酒馆转发。');
    if (historyId !== null) {
      if (streamEvidence || partialResponse) safeHistory(() => patchLlmResponse(historyId, { response: streamEvidence || partialResponse }));
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      safeHistory(() => failLlm(historyId, e instanceof Error ? e.message : String(e), aborted));
    }
    throw e;
  }
}

/**
 * 读取 SSE 流(text/event-stream),拼接 delta.content。
 * ST 的 generate 端点在 stream=true 时透传上游 SSE:每行 `data: {json}`,以 `data: [DONE]` 结束。
 * 推理增量单独统计，不当作最终配图结果；结束原因由上游提供，不能用 HTTP 200 代替。
 */
export async function readSseContent(resp: Response, opts: Pick<RequestOptions, 'imagePlanTool' | 'onDelta'> & {
  onEvidence?: (text: string) => void;
  onProgress?: (progress: { receivedChars: number; reasoningChars: number }) => void;
  onFinishReason?: (reason: string) => void;
} = {}): Promise<string> {
  const reader = resp.body?.getReader();
  if (!reader) {
    // 无法流式读取(理论上不会):退回当作整体 JSON 处理
    const data = await resp.json().catch(() => null);
    return data ? extractCompletion(data, opts.imagePlanTool) : '';
  }
  const decoder = new TextDecoder();
  let buf = '';
  let out = '';
  let reasoningOut = '';
  let terminated = false;
  let sawData = false;
  let evidence = '';
  let evidenceTruncated = false;
  // Keep the tail independently of preview text so late gateway errors survive.
  const appendChunk = (text: string) => {
    buf += text;
    evidence += text;
    if (evidence.length > 18_000) {
      evidence = evidence.slice(-18_000);
      evidenceTruncated = true;
    }
    opts.onEvidence?.(`${evidenceTruncated ? '[Earlier stream data omitted]\n' : ''}${evidence}`);
  };
  const calls = new Map<number, { type: string; function: { name: string; arguments: string } }>();
  const consume = (line: string) => {
    const t = line.trim();
    if (!t.startsWith('data:')) return;
    sawData = true;
    const payload = t.slice(5).trim();
    if (payload === '[DONE]') { terminated = true; return; }
    let json: any;
    try { json = JSON.parse(payload); }
    catch {
      if (opts.imagePlanTool) throw new ApiError('工具流包含损坏的数据片段');
      return;
    }
    if (json?.error) throw upstreamError(json.error.message || '副 API 返回错误');
    const choice = json?.choices?.[0];
    if (typeof choice?.finish_reason === 'string') opts.onFinishReason?.(choice.finish_reason);
    if (choice?.finish_reason) terminated = true;
    const src = choice?.delta ?? choice?.message;
    const piece = textOf(src?.content) || textOf(choice?.text);
    out += piece;
    reasoningOut += textOf(src?.reasoning) || textOf(src?.reasoning_content) || textOf(src?.thinking);
    if (Array.isArray(src?.tool_calls)) {
      for (const delta of src.tool_calls) {
        const index = delta.index ?? 0;
        if (!Number.isSafeInteger(index) || index < 0 || index > 16) throw new ApiError('工具调用编号无效');
        const call = calls.get(index) ?? { type: '', function: { name: '', arguments: '' } };
        if (delta.type) call.type = delta.type;
        call.function.name += textOf(delta.function?.name);
        call.function.arguments += textOf(delta.function?.arguments);
        calls.set(index, call);
      }
    }
    const receivedChars = opts.imagePlanTool
      ? [...calls.values()].reduce((sum, call) => sum + call.function.arguments.length, 0) : out.length;
    if (receivedChars || reasoningOut.length) opts.onProgress?.({ receivedChars, reasoningChars: reasoningOut.length });
    opts.onDelta?.(opts.imagePlanTool ? [...calls.values()].map(c => c.function.arguments).join('\n') : out);
    checkFinishReason(choice?.finish_reason);
  };
  try {
    for (; ;) {
      const { done, value } = await reader.read();
      if (done) { appendChunk(decoder.decode()); break; }
      appendChunk(decoder.decode(value, { stream: true }));
      // 按行解析,保留最后一段不完整的行到下次
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) consume(line);
    }
    if (buf.trim()) consume(buf);
    if (!sawData && evidence.trim()) {
      let data;
      try { data = JSON.parse(evidence); }
      catch { throw new ApiError('副 API 未返回有效的流式响应，请在请求历史中查看原始响应。'); }
      if (data?.error) throw upstreamError(data.error.message || '副 API 返回错误');
      return extractCompletion(data, opts.imagePlanTool);
    }
    if (opts.imagePlanTool) {
      if (!terminated) throw new ApiError('工具流意外中断，未确认完成');
      return imagePlanArguments([...calls.values()]);
    }
    if (calls.size) throw new ApiError('收到工具调用，请在配图预设中选择工具输出');
    if (!out.trim() && reasoningOut.trim()) throw new ApiError('副 API 仅返回思考内容，没有交付最终配图结果。请在请求历史查看结束原因及原始响应。', undefined, 'reasoning_only');
    return out.trim();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function extractCompletion(data: any, imagePlanTool = false): string {
  const choice = data?.choices?.[0];
  checkFinishReason(choice?.finish_reason);
  if (imagePlanTool) return imagePlanArguments(choice?.message?.tool_calls);
  if (choice?.message?.tool_calls?.length) throw new ApiError('收到工具调用，请在配图预设中选择工具输出');
  const content = textOf(choice?.message?.content) || textOf(choice?.text) || textOf(data?.content);
  if (!content.trim() && extractContent(data)) throw new ApiError('副 API 仅返回思考内容，没有交付最终配图结果。', undefined, 'reasoning_only');
  return content.trim();
}

/** 把可能是 string / content-parts 数组 / 其他类型的值转成文本;非字符串成分一律丢弃。 */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    let out = '';
    for (const part of value) {
      if (typeof part === 'string') out += part;
      else if (part && typeof part === 'object') {
        const text = (part as Record<string, unknown>).text;
        if (typeof text === 'string') out += text;
      }
    }
    return out;
  }
  return '';
}

/**
 * 从响应体提取答案文本。
 * 标准链:message.content / choices[0].text / data.content;
 * 推理模型(如 deepseek-v4-flash)可能把整段答案(思维链+最终 JSON)全放进
 * reasoning / reasoning_content / thinking 而 content 为空——标准链全空时回退取之,
 * 混入的思维链由 parseImagePlan 的 JSON 块扫描自然剔除。
 */
export function extractContent(data: any): string {
  const msg = data?.choices?.[0]?.message;
  const content =
    textOf(msg?.content) || textOf(data?.choices?.[0]?.text) || textOf(data?.content);
  if (content.trim()) return content.trim();
  return (
    textOf(msg?.reasoning) || textOf(msg?.reasoning_content) || textOf(msg?.thinking)
  ).trim();
}

/* ============ 跟随主 API(主界面当前在用的 API 设置) ============ */

/** 跟随主 API 时的响应上限:够装下思维链 + 输出,避免被主 API 默认 max tokens 截断。 */
const MAIN_API_RESPONSE_LENGTH = 65535;

/**
 * 是否具备「跟随主 API」的条件:ST 暴露了 generateRaw(稳定 API)即可。
 * 不再依赖连接管理/连接档——直接借用主界面当前正在用的 API。
 */
export function mainApiAvailable(): boolean {
  return typeof getContext()?.generateRaw === 'function';
}

/**
 * 用「当前主 API」(主界面正在用的聊天补全/文本补全设置)发一次补全。
 * 走 ST 的 generateRaw:只发我们给的这几条消息,不带聊天历史/角色卡;无需连接档。
 * quiet 类型内部强制非流式,返回清洗后的整段文本;失败抛 ApiError。
 *
 * ⚠️ 这条路径的请求体由 ST 构造,带不上 `tool_choice: 'none'`,第三方 fetch 拦截器
 * (如 Kemini 防截断脚本)仍可能改写它。生成 tag 尽量指派副 API 渠道,走 buildRequestBody 那条路。
 */
export async function requestViaMainApi(messages: ChatMsg[], opts: RequestOptions = {}): Promise<string> {
  if (opts.imagePlanTool || opts.direct) throw new ApiError('工具输出和浏览器直连需要指派独立副 API 渠道');
  opts.signal?.throwIfAborted();
  const ctx = getContext();
  if (typeof ctx?.generateRaw !== 'function') {
    throw new ApiError('当前 ST 版本不支持 generateRaw,无法跟随主 API');
  }

  // 历史埋点。跟随主 API 走 ST 内部黑盒,拿不到 usage,token 一律靠估算。
  const historyId = safeHistory(() =>
    beginLlm({
      source: opts.source || '未标注',
      channelName: FOLLOW_MAIN_API,
      model: '',
      stream: false,
      messages,
      transport: 'main',
    }),
  );

  try {
    const content = (await ctx.generateRaw({ prompt: wireMessages(messages), responseLength: MAIN_API_RESPONSE_LENGTH }))?.trim();
    opts.signal?.throwIfAborted();
    if (!content) throw new ApiError('主 API 返回空内容');
    // 与副 API 同口径:验收不过记失败,不记「成功」
    if (historyId !== null) safeHistory(() => patchLlmResponse(historyId, { phase: 'validation', response: content }));
    opts.validate?.(content);
    if (historyId !== null) {
      safeHistory(() =>
        finishLlm(historyId, {
          response: content,
          promptTokens: null,
          completionTokens: null,
          tokensEstimated: true,
        }),
      );
      void estimateTokens(historyId, messages, content);
    }
    return content;
  } catch (e) {
    if (historyId !== null) {
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      safeHistory(() => failLlm(historyId, e instanceof Error ? e.message : String(e), aborted));
    }
    throw e;
  }
}

/** 连通性测试:发一条极短请求 */
export async function testChannel(channel: ApiChannel, direct = false): Promise<{ ok: boolean; message: string }> {
  const primaryUrl = normalizeUrl(channel.url);
  try {
    const reply = await requestCompletionAtUrl(
      channel,
      [{ role: 'user', content: '回复"ok"两个字符即可。' }],
      primaryUrl,
      { source: '连通性测试', direct },
    );
    const changed = channel.url.trim().replace(/\/+$/, '') !== primaryUrl;
    if (changed) channel.url = primaryUrl;
    return {
      ok: true,
      message: `连通正常${changed ? `,已采用:${primaryUrl}` : ''},返回:${reply.slice(0, 40)}`,
    };
  } catch (e) {
    if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 405)) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }

    const fallbackUrl = alternateUrl(primaryUrl);
    if (!fallbackUrl || fallbackUrl === primaryUrl) {
      return { ok: false, message: e.message };
    }
    try {
      const reply = await requestCompletionAtUrl(
        channel,
        [{ role: 'user', content: '回复"ok"两个字符即可。' }],
        fallbackUrl,
        { source: '连通性测试(备用地址)', direct },
      );
      channel.url = fallbackUrl;
      return {
        ok: true,
        message: `连通正常,已自动改用:${fallbackUrl},返回:${reply.slice(0, 40)}`,
      };
    } catch {
      // 备用地址也失败时保留首个错误,避免把模型名等真实问题掩盖成路径错误。
      return { ok: false, message: e.message };
    }
  }
}

const STATUS_URL = '/api/backends/chat-completions/status';

/**
 * 拉取渠道可用的模型列表(走 ST 的 /status 代理,标准 /v1/models)。
 * 只需 url + key,不需要先填 model。
 */
export async function fetchModels(
  channel: Pick<ApiChannel, 'url' | 'key'> & Partial<Pick<ApiChannel, 'timeoutSec'>>,
  direct = false,
): Promise<string[]> {
  const ctx = getContext();
  if (!ctx) throw new ApiError('SillyTavern 上下文不可用');
  if (!channel.url) throw new ApiError('请先填写 API 地址');

  const body = {
    chat_completion_source: 'openai',
    reverse_proxy: normalizeUrl(channel.url),
    proxy_password: channel.key || '',
  };

  const timeoutSec = validTimeoutSec(channel.timeoutSec);
  return withTimeout(timeoutSec, undefined, '拉取模型', async signal => {
    const resp = await fetch(direct ? directEndpoint(normalizeUrl(channel.url), 'models') : STATUS_URL, {
      method: direct ? 'GET' : 'POST',
      headers: direct ? (channel.key ? { Authorization: `Bearer ${channel.key}` } : {}) : ctx.getRequestHeaders(),
      ...(direct ? { credentials: 'omit' as const, redirect: 'error' as const } : { body: JSON.stringify(body) }),
      signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new ApiError(`拉取模型失败 (${resp.status}): ${text.slice(0, 200)}`);
    }

    const data = await resp.json();
    if (data?.error && !Array.isArray(data?.data)) {
      throw new ApiError(data?.message || '拉取模型失败');
    }

    const list: unknown = data?.data ?? data?.models ?? [];
    if (!Array.isArray(list)) return [];
    return list
      .map((m: any) => (typeof m === 'string' ? m : m?.id))
      .filter((x: unknown): x is string => typeof x === 'string' && x.length > 0)
      .sort();
  });
}
