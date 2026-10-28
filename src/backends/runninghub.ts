import { reactive } from 'vue';
import type { ComfyImageResult, ComfyTemplateValues } from './comfyui';
import { RUNNINGHUB_SITES, enabledRunningHubKeys, selectedRunningHubKey, type RunningHubPreset, type RunningHubSettings } from './runninghubConfig';
import { acquireRunningHubKey } from './runninghubPool';
import { buildRunningHubOverrides, validateRunningHubWorkflow, workflowIdFromText } from './runninghubWorkflow';

type Json = Record<string, unknown>;
export type RunningHubPhase = 'waiting' | 'submitting' | 'queued' | 'running' | 'downloading' | 'success' | 'failed' | 'cancelled';
export interface RunningHubTask {
  localId: number;
  taskId: string;
  name: string;
  keyId?: string;
  keyName?: string;
  site?: string;
  phase: RunningHubPhase;
  startedAt: number;
  seconds?: number;
  coins?: number;
  error: string;
}
export const runningHubTasks = reactive<RunningHubTask[]>([]);
let sequence = 0;

export class RunningHubError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'RunningHubError';
  }
}

function obj(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
}

function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    cancelled(signal);
    const abort = () => { clearTimeout(timer); reject(new DOMException('已取消', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function baseUrl(config: Pick<RunningHubSettings, 'url' | 'apiKey'>): string {
  if (!RUNNINGHUB_SITES.some(site => site.value === config.url)) throw new RunningHubError('请选择 RunningHub 官方站点');
  if (!config.apiKey.trim()) throw new RunningHubError('请填写 RunningHub API Key');
  return config.url;
}

function safeDetail(value: unknown, key: string): string {
  return typeof value === 'string' ? value.split(key).join('[REDACTED]').slice(0, 400) : '';
}

async function request(
  config: Pick<RunningHubSettings, 'url' | 'apiKey'>,
  path: string,
  body: unknown,
  signal?: AbortSignal,
  timeout = 30_000,
): Promise<Json> {
  const url = baseUrl(config);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  cancelled(signal);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey.trim()}` },
      body: JSON.stringify(body), signal: controller.signal, credentials: 'omit',
    });
    const data = obj(await response.json());
    const detail = safeDetail(data.errorMessage ?? data.msg ?? data.message, config.apiKey.trim());
    if (!response.ok || (data.code !== undefined && data.code !== 0 && data.code !== '0' && data.code !== 200)) {
      const label = response.status === 401 || response.status === 403 ? 'Key 无效或无权访问'
        : response.status === 429 ? '请求过于频繁或队列已满' : '请求失败';
      throw new RunningHubError(`RunningHub ${label}${detail ? `：${detail}` : ` (${response.status})`}`, response.status);
    }
    return data;
  } catch (error) {
    cancelled(signal);
    if (controller.signal.aborted) throw new RunningHubError('RunningHub 请求超时');
    if (error instanceof RunningHubError) throw error;
    throw new RunningHubError('无法读取 RunningHub 响应，请检查网络、站点及浏览器跨域限制');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function operationConfig(config: RunningHubSettings): RunningHubSettings {
  const key = selectedRunningHubKey(config);
  if (!key?.key) throw new RunningHubError('请选择已填写的 RunningHub Key');
  return { ...config, apiKey: key.key };
}

export async function testRunningHubConnection(input: RunningHubSettings, signal?: AbortSignal): Promise<string> {
  const config = operationConfig(input);
  const response = await request(config, '/uc/openapi/accountStatus', { apiKey: config.apiKey.trim() }, signal);
  const data = obj(response.data);
  const balance = data.remainCoins ?? data.balance;
  return balance === undefined ? '连接成功' : `连接成功 · 余额 ${String(balance)} RH`;
}

export async function uploadRunningHubImage(input: RunningHubSettings, file: File, signal?: AbortSignal): Promise<string> {
  const config = operationConfig(input);
  const url = baseUrl(config);
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || !file.size || file.size > 10 * 1024 * 1024) {
    throw new RunningHubError('参考图必须为 PNG、JPEG 或 WebP，且不超过 10 MB');
  }
  const form = new FormData();
  form.append('apiKey', config.apiKey.trim());
  form.append('file', file);
  form.append('fileType', 'input');
  const controller = new AbortController();
  const abort = () => controller.abort();
  cancelled(signal);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url + '/task/openapi/upload', {
      method: 'POST', headers: { Authorization: `Bearer ${config.apiKey.trim()}` },
      body: form, signal: controller.signal, credentials: 'omit',
    });
    const data = obj(await response.json());
    const filename = obj(data.data).fileName;
    if (!response.ok || (data.code !== 0 && data.code !== '0') || typeof filename !== 'string' || !filename) {
      throw new RunningHubError('参考图上传失败，请检查 Key、站点和文件');
    }
    return filename;
  } catch (error) {
    cancelled(signal);
    if (error instanceof RunningHubError) throw error;
    throw new RunningHubError('参考图上传失败或超时');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function cancelRunningHubTask(config: RunningHubSettings, taskId: string): Promise<void> {
  await request(config, '/task/openapi/cancel', { apiKey: config.apiKey.trim(), taskId }, undefined, 15_000);
}

async function query(config: RunningHubSettings, taskId: string, signal?: AbortSignal): Promise<Json> {
  for (let attempt = 0; ; attempt++) {
    try { return await request(config, '/openapi/v2/query', { taskId }, signal, 15_000); }
    catch (error) {
      cancelled(signal);
      if (attempt >= 2 || (error instanceof RunningHubError && error.status && error.status < 500 && error.status !== 429)) throw error;
      await wait(1000 * (attempt + 1), signal);
    }
  }
}

function number(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function selectRunningHubImage(results: unknown, outputNodeId = ''): string {
  if (!Array.isArray(results)) throw new RunningHubError('任务完成但没有返回图片');
  const images = results.map(obj).filter(item => {
    if (outputNodeId && String(item.nodeId) !== outputNodeId) return false;
    if (typeof item.url !== 'string') return false;
    const type = String(item.outputType ?? '').toLowerCase();
    return /^(image|png|jpe?g|webp|gif|avif|bmp)$/.test(type) || type.startsWith('image/')
      || /\.(png|jpe?g|webp|gif|avif|bmp)(?:\?|$)/i.test(item.url);
  });
  if (!images.length) throw new RunningHubError(outputNodeId ? `节点 ${outputNodeId} 没有图片输出` : '没有可用的图片输出，本渠道不接收视频或压缩包');
  const url = String(images[0].url);
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new RunningHubError('图片地址无效'); }
  if (parsed.protocol !== 'https:') throw new RunningHubError('图片地址必须使用 HTTPS');
  return url;
}

async function downloadImage(url: string, taskId: string, signal?: AbortSignal): Promise<ComfyImageResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  cancelled(signal);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    // Deliberately omit the API Key when fetching files from a separate CDN.
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
    if (!response.ok) throw new RunningHubError(`图片下载失败 (${response.status})，可用任务 ID 重新获取，不必重新生图`);
    const blob = await response.blob();
    cancelled(signal);
    if (!blob.size || blob.size > 50 * 1024 * 1024) throw new RunningHubError('图片为空或超过 50 MB');
    if (!/^image\/(png|jpeg|webp|gif|avif|bmp)$/i.test(blob.type)) {
      throw new RunningHubError('结果不是支持的图片格式');
    }
    const format = blob.type.split('/')[1];
    const local = URL.createObjectURL(blob);
    return { url: local, filename: `runninghub-${taskId}.${format}`, format, revoke: () => URL.revokeObjectURL(local) };
  } catch (error) {
    cancelled(signal);
    if (error instanceof RunningHubError) throw error;
    throw new RunningHubError('图片下载失败或超时，可用任务 ID 重新获取，不必重新生图');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export interface RunningHubProgress {
  onPhase?(phase: RunningHubPhase): void;
  onTask?(taskId: string): void;
}
export interface RunningHubOutput {
  result: ComfyImageResult;
  taskId: string;
  keyId?: string;
  coins?: number;
  seconds?: number;
}

async function receive(
  config: RunningHubSettings, preset: RunningHubPreset, task: RunningHubTask,
  signal?: AbortSignal, hooks: RunningHubProgress = {},
): Promise<RunningHubOutput> {
  const end = Date.now() + Math.max(1, Math.min(60, config.timeoutMinutes)) * 60_000;
  for (;;) {
    cancelled(signal);
    if (Date.now() > end) throw new RunningHubError('等待任务超时；任务可能仍在云端运行，可用任务 ID 继续查询');
    const data = await query(config, task.taskId, signal);
    const status = String(data.status ?? '').toUpperCase();
    if (status === 'SUCCESS') {
      const usage = obj(data.usage);
      task.coins = number(usage.consumeCoins) ?? number(data.consumeCoins);
      task.seconds = number(usage.taskCostTime) ?? number(data.taskCostTime);
      const url = selectRunningHubImage(data.results, preset.outputNodeId);
      task.phase = 'downloading';
      hooks.onPhase?.('downloading');
      const result = await downloadImage(url, task.taskId, signal);
      return { result, taskId: task.taskId, keyId: task.keyId, coins: task.coins, seconds: task.seconds };
    }
    if (status === 'FAILED' || status === 'CANCELLED' || status === 'CANCELED') {
      throw new RunningHubError(safeDetail(data.errorMessage, config.apiKey) || `RunningHub 任务 ${status}`);
    }
    if (status !== 'RUNNING' && status !== 'QUEUED' && status !== 'PENDING') {
      throw new RunningHubError(`未知任务状态：${status || '空响应'}，请用任务 ID 检查云端任务`);
    }
    task.phase = status === 'RUNNING' ? 'running' : 'queued';
    hooks.onPhase?.(task.phase);
    await wait(2000, signal);
  }
}

function addTask(name: string, taskId = ''): RunningHubTask {
  while (runningHubTasks.length >= 20) {
    const index = runningHubTasks.findIndex(t => ['success', 'failed', 'cancelled'].includes(t.phase));
    if (index < 0) break;
    runningHubTasks.splice(index, 1);
  }
  const task = reactive<RunningHubTask>({ localId: ++sequence, taskId, name, phase: 'waiting', startedAt: Date.now(), error: '' });
  runningHubTasks.push(task);
  return task;
}

export async function generateRunningHubImage(
  configInput: RunningHubSettings, presetInput: RunningHubPreset, values: ComfyTemplateValues,
  signal?: AbortSignal, hooks: RunningHubProgress = {},
): Promise<RunningHubOutput> {
  // Capture settings once: editing/switching a preset must not redirect an in-flight task.
  const config = { ...configInput, apiKeys: configInput.apiKeys.map(key => ({ ...key })), apiKey: configInput.apiKey.trim() };
  const preset = { ...presetInput };
  if (preset.keyId) {
    const pinned = enabledRunningHubKeys(config).find(key => key.id === preset.keyId);
    if (!pinned) throw new RunningHubError('此工作流绑定的 Key 已删除、停用或未填写');
    config.apiKeys = [pinned];
  }
  const keys = enabledRunningHubKeys(config);
  if (!keys.length) throw new RunningHubError('没有已启用且填写完整的 RunningHub Key');
  baseUrl({ ...config, apiKey: keys[0].key });
  if (!Number.isInteger(config.timeoutMinutes) || config.timeoutMinutes < 1 || config.timeoutMinutes > 60) {
    throw new RunningHubError('等待超时必须为 1–60 分钟');
  }
  if (!Number.isInteger(config.concurrency) || config.concurrency < 1 || config.concurrency > 5) {
    throw new RunningHubError('并发上限必须为 1–5');
  }
  if (config.retainSeconds !== 0 && (!Number.isInteger(config.retainSeconds) || config.retainSeconds < 10 || config.retainSeconds > 180)) {
    throw new RunningHubError('实例保留时间应为 0 或 10–180 秒');
  }
  const invalid = validateRunningHubWorkflow(preset);
  if (invalid) throw new RunningHubError(invalid);
  const nodeInfoList = buildRunningHubOverrides(preset.workflow, values);
  const task = addTask(preset.name);
  let release: (() => void) | undefined;
  try {
    hooks.onPhase?.('waiting');
    const lease = await acquireRunningHubKey(config, signal);
    release = lease.release;
    config.apiKey = lease.key.key;
    task.keyId = lease.key.id;
    task.keyName = lease.key.name;
    task.site = config.url;
    cancelled(signal);
    task.phase = 'submitting';
    hooks.onPhase?.('submitting');
    const payload: Json = { nodeInfoList, addMetadata: true, usePersonalQueue: false };
    if (config.instanceType !== 'default') payload.instanceType = config.instanceType;
    if (config.retainSeconds >= 10 && config.retainSeconds <= 180) payload.retainSeconds = config.retainSeconds;
    let data: Json;
    try {
      // Do not abort an accepted submission before learning its ID. Once known, the
      // outer cancellation path cancels that exact task. Never retry task creation.
      data = await request(config, `/openapi/v2/run/workflow/${workflowIdFromText(preset.workflowId)}`, payload);
    } catch (error) {
      const detail = error instanceof Error ? error.message : '提交失败';
      throw new RunningHubError(`${detail}。未自动重发；请先检查 RunningHub 任务记录，避免重复扣费`);
    }
    if (typeof data.taskId !== 'string' || !data.taskId) throw new RunningHubError('未返回有效任务 ID；未自动重发，请先检查云端任务记录');
    task.taskId = data.taskId;
    hooks.onTask?.(task.taskId);
    cancelled(signal);
    const output = await receive(config, preset, task, signal, hooks);
    task.phase = 'success';
    hooks.onPhase?.('success');
    return output;
  } catch (error) {
    task.phase = signal?.aborted ? 'cancelled' : 'failed';
    task.error = error instanceof Error ? error.message : '任务失败';
    if (signal?.aborted && task.taskId) {
      try { await cancelRunningHubTask(config, task.taskId); }
      catch { task.error = '本地已取消，但云端取消未确认，请检查 RunningHub 任务记录'; }
    }
    hooks.onPhase?.(task.phase);
    if (signal?.aborted) throw new DOMException(task.error, 'AbortError');
    throw error;
  } finally {
    release?.();
  }
}

export async function recoverRunningHubImage(
  configInput: RunningHubSettings, taskId: string, outputNodeId = '', signal?: AbortSignal,
): Promise<RunningHubOutput> {
  const previous = runningHubTasks.find(task => task.taskId === taskId.trim() && task.keyId);
  if (previous?.keyId && !configInput.apiKeys.some(key => key.id === previous.keyId) && !previous.keyId.startsWith('legacy-')) {
    throw new RunningHubError('原任务的 Key 已删除，请恢复该 Key 后查询');
  }
  const recoveryConfig = { ...configInput, url: previous?.site ?? configInput.url, activeKeyId: previous?.keyId ?? configInput.activeKeyId };
  const config = operationConfig(recoveryConfig);
  baseUrl(config);
  if (!Number.isInteger(config.timeoutMinutes) || config.timeoutMinutes < 1 || config.timeoutMinutes > 60) {
    throw new RunningHubError('等待超时必须为 1–60 分钟');
  }
  if (!/^[\w-]+$/.test(taskId.trim())) throw new RunningHubError('请输入有效任务 ID');
  const task = addTask('恢复已有任务', taskId.trim());
  const key = selectedRunningHubKey(recoveryConfig);
  task.keyId = key?.id;
  task.keyName = key?.name;
  task.site = config.url;
  try {
    const result = await receive({ ...config }, { outputNodeId } as RunningHubPreset, task, signal);
    task.phase = 'success';
    return result;
  } catch (error) {
    task.phase = signal?.aborted ? 'cancelled' : 'failed';
    task.error = error instanceof Error ? error.message : '查询失败';
    throw error;
  }
}
