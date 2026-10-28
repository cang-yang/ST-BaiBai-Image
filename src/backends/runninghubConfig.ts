import { normalizeOrientationLock, type OrientationLock, type SizePair } from './size';
import { randomUuid } from '@/randomUuid';

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
}

export interface RunningHubSettings {
  url: string;
  apiKey: string;
  workflows: RunningHubPreset[];
  activeWorkflowId: string;
  concurrency: number;
  instanceType: 'default' | 'plus';
  retainSeconds: number;
  timeoutMinutes: number;
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
    url: RUNNINGHUB_SITES[0].value, apiKey: '', workflows: [preset],
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
  const workflows = (Array.isArray(raw.workflows) ? raw.workflows : []).map(item => {
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
    };
  });
  if (!workflows.length) workflows.push(defaults.workflows[0]);
  return {
    ...defaults,
    url: RUNNINGHUB_SITES.some(site => site.value === raw.url) ? String(raw.url) : defaults.url,
    apiKey: text(raw.apiKey).trim(),
    workflows,
    activeWorkflowId: workflows.some(w => w.id === raw.activeWorkflowId)
      ? String(raw.activeWorkflowId) : workflows[0].id,
    concurrency: integer(raw.concurrency, 1, 1, 5),
    instanceType: raw.instanceType === 'plus' ? 'plus' : 'default',
    retainSeconds: raw.retainSeconds === 0 ? 0 : integer(raw.retainSeconds, 0, 10, 180),
    timeoutMinutes: integer(raw.timeoutMinutes, 10, 1, 60),
  };
}
