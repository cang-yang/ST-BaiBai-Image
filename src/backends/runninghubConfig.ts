import { normalizeOrientationLock, type OrientationLock, type SizePair } from './size';
import { randomUuid } from '@/randomUuid';
import { normalizeManga, type MangaCustomLayout } from '@/manga/layouts';
import { normalizeParameterControls, type ParameterControl } from './workflowParameterSchema';

export interface RunningHubMangaBundle {
  spec: string;
  thinking: string;
  selectionNotes: string;
  custom: MangaCustomLayout[];
}

export const RUNNINGHUB_SITES = [
  { value: 'https://www.runninghub.ai', label: 'RunningHub 国际站 (.ai)' },
  { value: 'https://www.runninghub.cn', label: 'RunningHub 国内站 (.cn)' },
] as const;

export interface RunningHubPreset extends SizePair {
  id: string;
  name: string;
  workflowId: string;
  workflow: string;
  naturalLanguage: boolean;
  orientationLock: OrientationLock;
  outputNodeId: string;
  /** Optional account binding for private workflows and uploaded input files. */
  keyId?: string;
  manga?: boolean;
  mangaPositive?: string;
  mangaBundle?: RunningHubMangaBundle;
  parameterControls?: ParameterControl[];
  initialWorkflow?: string;
}

export function normalizeRunningHubMangaBundle(value: unknown): RunningHubMangaBundle | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const manga = normalizeManga({ ...value, textSlotsVersion: 1 });
  return { spec: manga.spec, thinking: manga.thinking, selectionNotes: manga.selectionNotes, custom: manga.custom };
}

export interface RunningHubSettings {
  url: string;
  apiKey: string;
  apiKeys: RunningHubKey[];
  activeKeyId: string;
  workflows: RunningHubPreset[];
  activeWorkflowId: string;
  concurrency: number;
  instanceType: 'default' | 'plus';
  retainSeconds: number;
  timeoutMinutes: number;
}

export interface RunningHubKey {
  id: string;
  name: string;
  key: string;
  enabled: boolean;
  concurrency: number;
}

export function newRunningHubKey(name = 'Key', key = '', concurrency = 1): RunningHubKey {
  return { id: randomUuid(), name, key, enabled: true, concurrency };
}

export function configuredRunningHubKeys(config: RunningHubSettings): RunningHubKey[] {
  if (config.apiKeys.length) return config.apiKeys.map(item => ({ ...item, key: item.key.trim() }));
  return [...new Set(config.apiKey.split(/[\r\n,;]+/).map(s => s.trim()).filter(Boolean))]
    .map((key, index) => ({ id: `legacy-${index}`, name: `Key ${index + 1}`, key, enabled: true, concurrency: config.concurrency }));
}

export function enabledRunningHubKeys(config: RunningHubSettings): RunningHubKey[] {
  const seen = new Set<string>();
  return configuredRunningHubKeys(config).filter(item => {
    if (!item.enabled || !item.key || seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

export function selectedRunningHubKey(config: RunningHubSettings): RunningHubKey | undefined {
  const keys = configuredRunningHubKeys(config);
  return keys.find(item => item.id === config.activeKeyId) ?? keys.find(item => item.key);
}

export function newRunningHubPreset(name = '默认工作流'): RunningHubPreset {
  return {
    id: randomUuid(), name, workflowId: '', workflow: '',
    portraitSize: '768x1024', landscapeSize: '1024x768',
    naturalLanguage: false, orientationLock: 'auto', outputNodeId: '',
  };
}

export function runningHubDefaults(): RunningHubSettings {
  const preset = newRunningHubPreset();
  return {
    url: RUNNINGHUB_SITES[0].value, apiKey: '', apiKeys: [], activeKeyId: '', workflows: [preset],
    activeWorkflowId: preset.id, concurrency: 1, instanceType: 'default',
    retainSeconds: 0, timeoutMinutes: 10,
  };
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function normalizeRunningHub(value: unknown): RunningHubSettings {
  const raw = object(value);
  const defaults = runningHubDefaults();
  const seen = new Set<string>();
  const workflows: RunningHubPreset[] = (Array.isArray(raw.workflows) ? raw.workflows : []).map(item => {
    const w = object(item);
    const preset = newRunningHubPreset(text(w.name, '工作流'));
    const id = text(w.id) || preset.id;
    preset.id = seen.has(id) ? preset.id : id;
    seen.add(preset.id);
    return {
      ...preset, workflowId: text(w.workflowId), workflow: text(w.workflow),
      portraitSize: text(w.portraitSize, preset.portraitSize),
      landscapeSize: text(w.landscapeSize, preset.landscapeSize),
      naturalLanguage: w.naturalLanguage === true,
      orientationLock: normalizeOrientationLock(w.orientationLock),
      outputNodeId: text(w.outputNodeId),
      keyId: text(w.keyId),
      manga: w.manga === true,
      mangaPositive: text(w.mangaPositive),
      mangaBundle: normalizeRunningHubMangaBundle(w.mangaBundle),
      parameterControls: normalizeParameterControls(w.parameterControls),
      initialWorkflow: text(w.initialWorkflow) || text(w.workflow),
    };
  });
  if (!workflows.length) workflows.push(defaults.workflows[0]);
  const keyIds = new Set<string>();
  const keys = Array.isArray(raw.apiKeys) ? raw.apiKeys : text(raw.apiKey).split(/[\r\n,;]+/)
    .map(s => s.trim()).filter(Boolean).map((key, index) => ({ key, name: `Key ${index + 1}`, concurrency: raw.concurrency }));
  const apiKeys = keys.map((item, index) => {
    const o = object(item), key = newRunningHubKey(text(o.name, `Key ${index + 1}`), text(o.key).trim());
    const id = text(o.id);
    if (id && !keyIds.has(id)) key.id = id;
    keyIds.add(key.id);
    key.enabled = o.enabled !== false;
    key.concurrency = integer(o.concurrency, 1, 1, 5);
    return key;
  });
  return {
    ...defaults,
    url: RUNNINGHUB_SITES.some(site => site.value === raw.url) ? String(raw.url) : defaults.url,
    apiKey: text(raw.apiKey).trim(),
    apiKeys,
    activeKeyId: apiKeys.some(key => key.id === raw.activeKeyId) ? String(raw.activeKeyId) : apiKeys[0]?.id ?? '',
    workflows,
    activeWorkflowId: workflows.some(w => w.id === raw.activeWorkflowId)
      ? String(raw.activeWorkflowId) : workflows[0].id,
    concurrency: integer(raw.concurrency, 1, 1, 5),
    instanceType: raw.instanceType === 'plus' ? 'plus' : 'default',
    retainSeconds: raw.retainSeconds === 0 ? 0 : integer(raw.retainSeconds, 0, 10, 180),
    timeoutMinutes: integer(raw.timeoutMinutes, 10, 1, 60),
  };
}
