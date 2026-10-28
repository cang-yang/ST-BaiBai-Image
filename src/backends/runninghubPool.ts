import { enabledRunningHubKeys, type RunningHubKey, type RunningHubSettings } from './runninghubConfig';

interface Active { count: number; lastUsed: number }
interface Pending {
  site: string;
  keys: RunningHubKey[];
  signal?: AbortSignal;
  resolve(lease: RunningHubLease): void;
  reject(error: Error): void;
  abort(): void;
}
export interface RunningHubLease {
  key: RunningHubKey;
  release(): void;
}

const active = new Map<string, Active>();
const pending: Pending[] = [];
let sequence = 0;
const identity = (site: string, key: RunningHubKey) => `${site}\n${key.key}`;

function pump(): void {
  for (let i = 0; i < pending.length;) {
    const job = pending[i];
    const available = job.keys.filter(key => (active.get(identity(job.site, key))?.count ?? 0) < key.concurrency);
    available.sort((a, b) => {
      const aa = active.get(identity(job.site, a)), bb = active.get(identity(job.site, b));
      return (aa?.count ?? 0) / a.concurrency - (bb?.count ?? 0) / b.concurrency
        || (aa?.lastUsed ?? 0) - (bb?.lastUsed ?? 0);
    });
    const key = available[0];
    if (!key) { i++; continue; }
    pending.splice(i, 1);
    job.signal?.removeEventListener('abort', job.abort);
    const id = identity(job.site, key);
    const state = active.get(id) ?? { count: 0, lastUsed: 0 };
    state.count++;
    state.lastUsed = ++sequence;
    active.set(id, state);
    let released = false;
    job.resolve({ key, release() {
      if (released) return;
      released = true;
      state.count--;
      pump();
      // Do not retain credentials after all work on the page has finished.
      if (!pending.length && ![...active.values()].some(value => value.count)) active.clear();
    } });
  }
}

export function acquireRunningHubKey(config: RunningHubSettings, signal?: AbortSignal): Promise<RunningHubLease> {
  const keys = enabledRunningHubKeys(config);
  if (!keys.length) return Promise.reject(new Error('没有已启用且填写完整的 RunningHub Key'));
  if (keys.some(key => !Number.isInteger(key.concurrency) || key.concurrency < 1 || key.concurrency > 5)) {
    return Promise.reject(new Error('每个 Key 的并发上限必须为 1–5'));
  }
  if (signal?.aborted) return Promise.reject(new DOMException('已取消', 'AbortError'));
  return new Promise((resolve, reject) => {
    const job: Pending = {
      site: config.url, keys, signal, resolve, reject,
      abort() {
        const index = pending.indexOf(job);
        if (index >= 0) pending.splice(index, 1);
        signal?.removeEventListener('abort', job.abort);
        reject(new DOMException('已取消', 'AbortError'));
      },
    };
    pending.push(job);
    signal?.addEventListener('abort', job.abort, { once: true });
    pump();
  });
}
