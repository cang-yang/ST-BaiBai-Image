import { parseWorkflowTemplate, type ComfyWorkflow, type ComfyTemplateValues } from './comfyui';
import { newRunningHubPreset, normalizeRunningHubMangaBundle, type RunningHubPreset } from './runninghubConfig';
import { parseSize } from './size';
import { applyMangaFrames, parseCustomLayout, resizeMangaCanvases, type MangaSettings } from '@/manga/layouts';

export interface NodeOverride { nodeId: string; fieldName: string; fieldValue: string | number | boolean }
export interface WorkflowField {
  nodeId: string;
  fieldName: string;
  title: string;
  value: string | number | boolean;
}

const ALIASES: Record<string, string> = {
  '提示词': 'prompt', '正面提示词': 'prompt', '负面提示词': 'negative_prompt',
  '宽度': 'width', '高度': 'height', '种子': 'seed',
};
const DYNAMIC = new Set(['prompt', 'negative_prompt', 'nl', 'width', 'height', 'seed']);

export function workflowIdFromText(value: string): string {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (!/^(www\.)?runninghub\.(ai|cn)$/.test(url.hostname)) return '';
    return url.pathname.match(/\/(?:workflow|post)\/(\d+)/)?.[1] ?? '';
  } catch {
    return '';
  }
}

export function runningHubFields(template: string): WorkflowField[] {
  const graph = parseWorkflowTemplate(template);
  return Object.entries(graph).flatMap(([nodeId, node]) => {
    const title = String((node._meta as { title?: string } | undefined)?.title ?? node.class_type ?? nodeId);
    const inputs = node.inputs;
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return [];
    return Object.entries(inputs).flatMap(([fieldName, value]) =>
      ['string', 'number', 'boolean'].includes(typeof value)
        ? [{ nodeId, fieldName, title, value: value as string | number | boolean }] : []);
  });
}

export function runningHubPlaceholders(template: string): string[] {
  const found = new Set<string>();
  for (const field of runningHubFields(template)) {
    if (typeof field.value !== 'string') continue;
    for (const match of field.value.matchAll(/%([^%\s]+)%/g)) found.add(ALIASES[match[1]] ?? match[1]);
  }
  return [...found];
}

export function validateRunningHubWorkflow(preset: RunningHubPreset): string {
  if (!workflowIdFromText(preset.workflowId)) return '请填写有效的 RunningHub 工作流 ID 或工作流链接';
  try {
    const placeholders = runningHubPlaceholders(preset.workflow);
    if (!placeholders.includes('prompt')) return '请把正面提示词字段绑定到 %prompt%';
    const unsupported = placeholders.filter(p => !DYNAMIC.has(p));
    if (unsupported.length) return `未配置的占位符：${unsupported.map(p => `%${p}%`).join('、')}。请改为固定参数`;
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : '工作流 JSON 无效';
  }
}

/**
 * RunningHub executes the saved cloud graph, not this local graph. Send all scalar
 * inputs so local fixed quality prompts and LoRA weights are not silently ignored.
 * Links, node classes and graph topology remain the cloud workflow's responsibility.
 */
export function buildRunningHubOverrides(template: string, values: ComfyTemplateValues): NodeOverride[] {
  const placeholders = runningHubPlaceholders(template);
  if (!placeholders.includes('prompt')) throw new Error('工作流缺少 %prompt%');
  const unsupported = placeholders.filter(p => !DYNAMIC.has(p));
  if (unsupported.length) throw new Error(`未配置的占位符：${unsupported.join('、')}`);
  if (placeholders.some(p => p === 'width' || p === 'height') && !(values.width && values.height)) {
    throw new Error('工作流使用了尺寸占位符，请填写有效的横竖尺寸');
  }
  const replacements: Record<string, string | number> = {
    prompt: values.prompt, negative_prompt: values.negative_prompt ?? '', nl: values.nl ?? '',
    seed: values.seed ?? 0, width: values.width ?? 0, height: values.height ?? 0,
  };
  return runningHubFields(template).map(field => {
    let value = field.value;
    if (typeof value === 'string') {
      const exact = value.match(/^%([^%\s]+)%$/);
      if (exact) value = replacements[ALIASES[exact[1]] ?? exact[1]];
      else value = value.replace(/%([^%\s]+)%/g, (_, key: string) => String(replacements[ALIASES[key] ?? key]));
    }
    return { nodeId: field.nodeId, fieldName: field.fieldName, fieldValue: value };
  });
}

export function setRunningHubField(template: string, nodeId: string, fieldName: string, value: string | number | boolean): string {
  const graph = parseWorkflowTemplate(template);
  const inputs = graph[nodeId]?.inputs as Record<string, unknown> | undefined;
  if (!inputs || !Object.hasOwn(inputs, fieldName)) throw new Error('节点字段不存在');
  inputs[fieldName] = value;
  return JSON.stringify(graph, null, 2);
}

export function importRunningHubWorkflow(text: string, fallbackName = '导入工作流'): RunningHubPreset {
  const raw: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('工作流文件必须是 JSON 对象');
  const wrapper = raw as Record<string, unknown>;
  if (wrapper.entries && !wrapper.workflow) throw new Error('这是酒馆世界书，请在世界书界面导入，不是 RunningHub 工作流');
  const preset = newRunningHubPreset(typeof wrapper.name === 'string' ? wrapper.name : fallbackName);
  const data = wrapper.workflow ?? raw;
  const workflow = typeof data === 'string' ? data : JSON.stringify(data);
  parseWorkflowTemplate(workflow);
  preset.workflow = workflow;
  // Snowflake IDs must never pass through Number (loss of precision).
  if (wrapper.workflowId !== undefined && typeof wrapper.workflowId !== 'string') {
    throw new Error('workflowId 必须是带引号的字符串，避免长数字精度丢失');
  }
  preset.workflowId = typeof wrapper.workflowId === 'string' ? workflowIdFromText(wrapper.workflowId) : '';
  const options = wrapper.baibai;
  if (options && typeof options === 'object' && !Array.isArray(options)) {
    const o = options as Record<string, unknown>;
    for (const key of ['portraitSize', 'landscapeSize', 'outputNodeId'] as const) {
      if (typeof o[key] === 'string') preset[key] = o[key];
    }
    preset.naturalLanguage = o.naturalLanguage === true;
    preset.manga = o.manga === true;
    preset.mangaPositive = typeof o.mangaPositive === 'string' ? o.mangaPositive : '';
    preset.mangaBundle = normalizeRunningHubMangaBundle(o.mangaBundle);
    if (preset.mangaBundle) {
      const source = o.mangaBundle as Record<string, unknown>;
      if (source.custom !== undefined && !Array.isArray(source.custom)) throw new Error('漫画版式必须为数组');
      preset.mangaBundle.custom = (source.custom as unknown[] ?? []).map(item => parseCustomLayout(JSON.stringify(item)));
    }
    preset.orientationLock = o.orientationLock === 'portrait' || o.orientationLock === 'landscape' ? o.orientationLock : 'auto';
  }
  return preset;
}

export function exportRunningHubWorkflow(preset: RunningHubPreset): string {
  parseWorkflowTemplate(preset.workflow);
  const { portraitSize, landscapeSize, naturalLanguage, orientationLock, outputNodeId, manga, mangaPositive, mangaBundle } = preset;
  return JSON.stringify({
    name: preset.name, workflowId: workflowIdFromText(preset.workflowId), workflow: preset.workflow,
    baibai: { portraitSize, landscapeSize, naturalLanguage, orientationLock, outputNodeId, manga, mangaPositive, mangaBundle },
  }, null, 2);
}

export function runningHubMangaSettings(preset: RunningHubPreset, current: MangaSettings): MangaSettings {
  const portrait = parseSize(preset.portraitSize), landscape = parseSize(preset.landscapeSize);
  if (!portrait || !landscape || portrait.width > portrait.height
    || portrait.width !== landscape.height || portrait.height !== landscape.width) {
    throw new Error('漫画工作流的横竖尺寸须互为宽高交换，例如 1664x2496 / 2496x1664');
  }
  const bundle = preset.mangaBundle;
  const merged = new Map(current.custom.map(layout => [layout.id, layout]));
  for (const layout of bundle?.custom ?? []) merged.set(layout.id, parseCustomLayout(JSON.stringify(layout)));
  const input = { ...current, custom: [...merged.values()] };
  const custom = resizeMangaCanvases(input, portrait.width, portrait.height);
  return { ...current, enabled: true, custom,
    ...(bundle ? { spec: bundle.spec, thinking: bundle.thinking, selectionNotes: bundle.selectionNotes } : {}),
  };
}

export function prepareRunningHubPrompt(prompt: string, preset: RunningHubPreset, manga: MangaSettings, size: { width?: number; height?: number } | null): string {
  if (preset.manga && !manga.enabled) throw new Error('此工作流需要漫画模式，请先应用漫画配置');
  const compiled = applyMangaFrames(prompt, manga, size);
  const fixed = preset.mangaPositive?.trim();
  if (!fixed) return compiled;
  let layout: Record<string, unknown>;
  try { layout = JSON.parse(compiled); } catch { throw new Error('漫画固定正面词需要有效的 Layout JSON'); }
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)
    || !layout.summary || typeof layout.summary !== 'object' || Array.isArray(layout.summary)) {
    throw new Error('漫画固定正面词需要 summary 对象');
  }
  const summary = layout.summary as Record<string, unknown>;
  summary.caption = `${fixed}\n${typeof summary.caption === 'string' ? summary.caption : ''}`;
  return JSON.stringify(layout);
}

export function outputNodeOptions(template: string): { value: string; label: string }[] {
  let graph: ComfyWorkflow;
  try { graph = parseWorkflowTemplate(template); } catch { return []; }
  return Object.entries(graph).filter(([, node]) => /SaveImage|PreviewImage/i.test(String(node.class_type)))
    .map(([id, node]) => ({ value: id, label: `${id} · ${String((node._meta as { title?: string })?.title ?? node.class_type)}` }));
}
