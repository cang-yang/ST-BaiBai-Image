import { addMissingWorldInfoFields, GENERATION_TYPE_TRIGGERS } from './vendor/entries';

export interface ImageWorldEntry extends Record<string, unknown> {
  uid: number;
  comment: string;
  content: string;
  key: string[];
  keysecondary: string[];
  disable: boolean;
  constant: boolean;
  selective: boolean;
  selectiveLogic: number;
  order: number;
  position: number;
  depth: number;
  role: number;
  probability: number;
  useProbability: boolean;
  excludeRecursion: boolean;
  preventRecursion: boolean;
  delayUntilRecursion: boolean | number;
  scanDepth: number | null;
  caseSensitive: boolean | null;
  matchWholeWords: boolean | null;
  useGroupScoring: boolean | null;
  group: string;
  groupOverride: boolean;
  groupWeight: number;
  sticky: number | null;
  cooldown: number | null;
  delay: number | null;
  ignoreBudget: boolean;
  triggers: string[];
  outletName: string;
}

export interface ImageWorldBook {
  id: string;
  name: string;
  enabled: boolean;
  document: Record<string, unknown> & { entries: Record<string, ImageWorldEntry> };
}

export const scanDefaults = () => ({
  world_info_depth: 2,
  world_info_min_activations: 0,
  world_info_min_activations_depth_max: 0,
  world_info_budget: 25,
  world_info_budget_cap: 0,
  world_info_include_names: true,
  world_info_recursive: false,
  world_info_case_sensitive: false,
  world_info_match_whole_words: false,
  world_info_use_group_scoring: false,
  world_info_max_recursion_steps: 0,
});
export type ScanSettings = ReturnType<typeof scanDefaults>;
export interface ImageWorldbookSettings {
  enabled: boolean;
  inherit: boolean;
  contextSize: number;
  trigger: string;
  scan: ScanSettings;
  books: ImageWorldBook[];
}
export const imageWorldbookDefaults = (): ImageWorldbookSettings => ({
  enabled: true, inherit: true, contextSize: 8192, trigger: 'normal',
  scan: scanDefaults(), books: [],
});
export const generationTriggers: string[] = [...GENERATION_TYPE_TRIGGERS];
export function entryDefaults(uid = 0): ImageWorldEntry {
  return addMissingWorldInfoFields([{ uid }])[0] as ImageWorldEntry;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function parseEntry(raw: unknown, fallbackId: number): ImageWorldEntry {
  if (!object(raw)) throw new Error('条目必须是 JSON 对象');
  const base = entryDefaults(fallbackId);
  // Backfill and repair fields before validation, exactly as the native editor does.
  const entry = addMissingWorldInfoFields([{ ...base, ...raw }])[0] as ImageWorldEntry;
  // The native scanner also supplies these effective defaults for null values.
  if (entry.role == null) entry.role = base.role;
  if (entry.selectiveLogic == null) entry.selectiveLogic = base.selectiveLogic;
  if (entry.triggers == null) entry.triggers = [];
  for (const field of ['key', 'keysecondary', 'triggers'] as const) {
    if (!Array.isArray(entry[field]) || entry[field].some(v => typeof v !== 'string')) throw new Error(`${field} 必须是字符串数组`);
  }
  if (!Number.isInteger(entry.uid) || entry.uid < 0) throw new Error('uid 必须是非负整数');
  for (const field of ['comment', 'content', 'group', 'outletName'] as const) {
    if (typeof entry[field] !== 'string') throw new Error(`${field} 必须是文本`);
  }
  for (const field of ['order', 'depth', 'probability', 'groupWeight', 'sticky', 'cooldown', 'delay', 'scanDepth'] as const) {
    const value = entry[field];
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error(`${field} 必须是非负数或 null`);
    if (value === null && base[field] !== null) entry[field] = base[field] as never;
  }
  for (const [field, max] of [['selectiveLogic', 3], ['position', 7], ['role', 2]] as const) {
    if (!Number.isInteger(entry[field]) || entry[field] < 0 || entry[field] > max) throw new Error(`${field} 超出酒馆原版范围`);
  }
  for (const field of ['disable', 'constant', 'selective', 'useProbability', 'excludeRecursion', 'preventRecursion', 'groupOverride', 'ignoreBudget'] as const) {
    if (typeof entry[field] !== 'boolean') throw new Error(`${field} 必须是布尔值`);
  }
  for (const field of ['caseSensitive', 'matchWholeWords', 'useGroupScoring'] as const) {
    if (entry[field] !== null && typeof entry[field] !== 'boolean') throw new Error(`${field} 必须是布尔值或 null`);
  }
  if (typeof entry.delayUntilRecursion !== 'boolean' && !(typeof entry.delayUntilRecursion === 'number' && Number.isFinite(entry.delayUntilRecursion) && entry.delayUntilRecursion >= 0)) throw new Error('递归延迟必须是布尔值或非负数');
  if (entry.characterFilter !== undefined && (!object(entry.characterFilter)
    || ['names', 'tags'].some(k => entry.characterFilter && (entry.characterFilter as Record<string, unknown>)[k] !== undefined
      && (!Array.isArray((entry.characterFilter as Record<string, unknown>)[k]) || ((entry.characterFilter as Record<string, unknown>)[k] as unknown[]).some(v => typeof v !== 'string'))))) throw new Error('角色过滤格式无效');
  if (entry.probability > 100 || entry.content.length > 100_000) throw new Error('条目概率或正文长度超出范围');
  return entry;
}

export function importImageWorldBook(text: string, name: string): ImageWorldBook {
  if (new Blob([text]).size > 2_000_000) throw new Error('单本世界书不能超过 2 MB');
  const doc: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (!object(doc) || !object(doc.entries)) throw new Error('请选择酒馆导出的世界书 JSON（根对象需要 entries）');
  const items = Object.entries(doc.entries);
  if (items.length > 2000) throw new Error('单本世界书最多 2000 个条目');
  const entries: Record<string, ImageWorldEntry> = {};
  const uids = new Set<number>();
  for (const [key, raw] of items) {
    let entry: ImageWorldEntry;
    try { entry = parseEntry(raw, Number(key)); }
    catch (error) { throw new Error(`条目 ${key}：${error instanceof Error ? error.message : String(error)}`); }
    if (uids.has(entry.uid)) throw new Error(`重复的条目 uid：${entry.uid}`);
    uids.add(entry.uid);
    Object.defineProperty(entries, key, { value: entry, writable: true, enumerable: true, configurable: true });
  }
  return { id: crypto.randomUUID(), name: name.replace(/\.json$/i, '') || '世界书', enabled: true, document: { ...doc, entries } };
}

export function normalizeImageWorldbooks(raw: unknown): ImageWorldbookSettings {
  const out = imageWorldbookDefaults();
  if (!object(raw)) return out;
  out.enabled = raw.enabled !== false;
  out.inherit = raw.inherit !== false;
  if (typeof raw.contextSize === 'number' && Number.isFinite(raw.contextSize)) out.contextSize = Math.max(256, Math.min(2_000_000, Math.round(raw.contextSize)));
  if (typeof raw.trigger === 'string' && generationTriggers.includes(raw.trigger)) out.trigger = raw.trigger;
  out.scan = normalizeScan(raw.scan);
  if (Array.isArray(raw.books)) {
    out.books = raw.books.filter(b => object(b) && typeof b.id === 'string' && typeof b.name === 'string' && object(b.document) && object(b.document.entries)) as ImageWorldBook[];
  }
  return out;
}
export function normalizeScan(raw: unknown): ScanSettings {
  const out = scanDefaults();
  if (!object(raw)) return out;
  for (const key of Object.keys(out) as Array<keyof ScanSettings>) {
    const value = raw[key];
    if (typeof out[key] === 'boolean' && typeof value === 'boolean') (out as Record<string, unknown>)[key] = value;
    if (typeof out[key] === 'number' && typeof value === 'number' && Number.isFinite(value)) (out as Record<string, unknown>)[key] = Math.max(0, Math.floor(value));
  }
  out.world_info_depth = Math.min(1000, out.world_info_depth);
  out.world_info_budget = Math.min(100, out.world_info_budget);
  return out;
}

export function compatibilityWarnings(entry: ImageWorldEntry): string[] {
  const notes: string[] = [];
  if (entry.vectorized) notes.push('向量召回依赖酒馆向量扩展，不在局部书库中执行；关键词仍按原版扫描。');
  if (entry.automationId) notes.push('自动化 ID 保留但不执行。');
  if (/<%|\{\{(?!char\s*\}\}|user\s*\}\}|persona\s*\}\}|description\s*\}\}|personality\s*\}\}|scenario\s*\}\}|getvar::[^{}]+\}\}|getglobalvar::[^{}]+\}\})/i.test(entry.content + entry.key.join(' ') + entry.keysecondary.join(' '))) notes.push('脚本及非只读宏不执行，未知宏保留原文。');
  if (entry.position === 7) notes.push('Outlet 仅在本次副 API 消息的 {{outlet::名称}} 中展开；无引用不注入。');
  return notes;
}
