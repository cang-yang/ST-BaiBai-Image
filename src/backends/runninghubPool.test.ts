import { describe, expect, it } from 'vitest';
import { acquireRunningHubKey } from './runninghubPool';
import { enabledRunningHubKeys, newRunningHubKey, normalizeRunningHub, runningHubDefaults } from './runninghubConfig';

function pool() {
  const config = runningHubDefaults();
  const unique = crypto.randomUUID();
  config.apiKeys = [newRunningHubKey('A', unique + '-a'), newRunningHubKey('B', unique + '-b')];
  return config;
}

describe('RunningHub multi-Key scheduling', () => {
  it('leases separate keys concurrently and queues until capacity is available', async () => {
    const config = pool();
    const a = await acquireRunningHubKey(config), b = await acquireRunningHubKey(config);
    expect(a.key.id).not.toBe(b.key.id);
    let granted = false;
    const next = acquireRunningHubKey(config).then(lease => { granted = true; return lease; });
    await Promise.resolve();
    expect(granted).toBe(false);
    b.release();
    const c = await next;
    expect(c.key.id).toBe(b.key.id);
    c.release(); a.release();
  });
  it('honors per-Key capacity and never adds capacity for duplicate secrets', async () => {
    const config = pool();
    config.apiKeys[0].concurrency = 2;
    config.apiKeys[1].enabled = false;
    config.apiKeys.push({ ...config.apiKeys[0], id: 'duplicate' });
    expect(enabledRunningHubKeys(config)).toHaveLength(1);
    const a = await acquireRunningHubKey(config), b = await acquireRunningHubKey(config);
    const abort = new AbortController();
    const c = acquireRunningHubKey(config, abort.signal);
    abort.abort();
    await expect(c).rejects.toMatchObject({ name: 'AbortError' });
    a.release(); a.release(); b.release();
    const d = await acquireRunningHubKey(config);
    d.release();
  });
  it('does not consume a slot after cancellation and drains queued jobs in order', async () => {
    const config = pool();
    config.apiKeys[1].enabled = false;
    const first = await acquireRunningHubKey(config);
    const abort = new AbortController();
    const cancelled = acquireRunningHubKey(config, abort.signal);
    const third = acquireRunningHubKey(config);
    abort.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    first.release();
    (await third).release();
  });
  it('rejects disabled/empty pools instead of falling back to an old secret', async () => {
    const config = pool();
    config.apiKey = 'legacy-secret';
    config.apiKeys.forEach(key => { key.enabled = false; });
    await expect(acquireRunningHubKey(config)).rejects.toThrow('没有');
  });
  it('rejects invalid per-Key limits', async () => {
    const config = pool();
    config.apiKeys[0].concurrency = NaN;
    await expect(acquireRunningHubKey(config)).rejects.toThrow('并发');
  });
  it('migrates legacy multi-line keys and preserves enabled flags, limits and IDs', () => {
    const migrated = normalizeRunningHub({ apiKey: 'a\nb', concurrency: 2 });
    expect(migrated.apiKeys.map(key => key.key)).toEqual(['a', 'b']);
    expect(migrated.apiKeys[0].concurrency).toBe(2);
    migrated.apiKeys[1].enabled = false;
    const restored = normalizeRunningHub(migrated);
    expect(restored.apiKeys).toEqual(migrated.apiKeys);
    expect(enabledRunningHubKeys(restored).map(key => key.key)).toEqual(['a']);
  });
});
