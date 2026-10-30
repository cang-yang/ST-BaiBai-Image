import type { ChatMsg } from '@/api/client';
import { defaultRules, legacyRules, readRules, type PresetRules, type RuleKey } from './rules';

export interface PromptEntry {
  id: string;
  name: string;
  enabled: boolean;
  role: ChatMsg['role'];
  content: string;
  placement?: 'before_data' | 'after_data';
  trigger: 'always' | 'keywords';
  keywords: string;
  andKeywords: string;
}

export interface ImagePromptPreset {
  id: string;
  name: string;
  description: string;
  output: 'text' | 'tool';
  format?: 'auto' | 'moss_layout';
  mangaText?: 'auto' | 'required';
  mangaComposition?: 'auto' | 'expressive';
  /** v1 import compatibility only; v2 uses independently owned rules. */
  useBackendRules?: boolean;
  rules?: PresetRules;
  entries: PromptEntry[];
  variables: Record<string, string>;
  warnings: string[];
}

export interface ImagePresetSettings {
  activeId: string;
  presets: ImagePromptPreset[];
  /** Plugin-local: shared API channel normalization must not erase this preference. */
  directChannels: string[];
  rulesVersion?: 2;
}

export const PRESET_FORMAT = 'baibai_image_prompt_preset';
export const MAX_PRESET_BYTES = 2_000_000;
export const MAX_LIBRARY_BYTES = 10_000_000;
const MAX_ENTRIES = 2000;
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, fallback = ''): string => typeof v === 'string' ? v : fallback;
const id = (): string => crypto.randomUUID();

export function presetDefaults(): ImagePresetSettings {
  return { activeId: '', presets: [], directChannels: [] };
}

export function newPromptEntry(): PromptEntry {
  return { id: id(), name: '新条目', enabled: true, role: 'system', content: '', trigger: 'always', keywords: '', andKeywords: '' };
}

export function newImagePreset(): ImagePromptPreset {
  return {
    id: id(), name: '我的正文配图', description: '', output: 'text', mangaText: 'auto', mangaComposition: 'auto', rules: defaultRules(),
    entries: [{ ...newPromptEntry(), name: '画面要求', content: '忠于正文，保持人物外貌与场景连续。优先选择有明确主体、动作和情绪的画面。' }],
    variables: {}, warnings: [],
  };
}

function readPreset(raw: unknown, freshIds: boolean): ImagePromptPreset {
  if (!record(raw) || !Array.isArray(raw.entries)) throw new Error('预设需要 entries 条目列表');
  if (raw.entries.length > MAX_ENTRIES) throw new Error(`单份预设最多 ${MAX_ENTRIES} 个条目`);
  const entries = raw.entries.map((e: unknown, index: number): PromptEntry => {
    if (!record(e) || typeof e.content !== 'string') throw new Error(`第 ${index + 1} 个条目缺少文本 content`);
    if (!['system', 'user', 'assistant'].includes(e.role)) throw new Error(`第 ${index + 1} 个条目的角色不支持`);
    if (e.trigger !== undefined && !['always', 'keywords'].includes(e.trigger)) throw new Error(`第 ${index + 1} 个条目的触发方式不支持`);
    if (e.placement !== undefined && !['before_data', 'after_data'].includes(e.placement)) throw new Error(`第 ${index + 1} 个条目的插入位置不支持`);
    return {
      id: freshIds ? id() : text(e.id) || id(), name: text(e.name, `条目 ${index + 1}`),
      enabled: e.enabled !== false, role: e.role, content: e.content,
      ...(e.placement ? { placement: e.placement } : {}),
      trigger: e.trigger === 'keywords' ? 'keywords' : 'always',
      keywords: text(e.keywords), andKeywords: text(e.andKeywords),
    };
  });
  if (new Set(entries.map(e => e.id)).size !== entries.length) throw new Error('条目 ID 重复');
  if (raw.output !== undefined && !['text', 'tool'].includes(raw.output)) throw new Error('不支持的输出方式');
  if (raw.format !== undefined && !['auto', 'moss_layout'].includes(raw.format)) throw new Error('不支持的提示词格式');
  if (raw.mangaText !== undefined && !['auto', 'required'].includes(raw.mangaText)) throw new Error('不支持的漫画文字要求');
  if (raw.mangaComposition !== undefined && !['auto', 'expressive'].includes(raw.mangaComposition)) throw new Error('不支持的漫画构图要求');
  const variables: Record<string, string> = Object.create(null);
  if (raw.variables !== undefined && !record(raw.variables)) throw new Error('变量必须是名称与文本组成的对象');
  for (const [key, value] of Object.entries(raw.variables ?? {})) {
    if (!/^[\w\u3400-\u9fff.-]{1,80}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(`变量名不合法: ${key}`);
    if (typeof value !== 'string') throw new Error(`变量 ${key} 的值必须是文本`);
    variables[key] = value;
  }
  return {
    id: freshIds ? id() : text(raw.id) || id(), name: text(raw.name).trim() || '未命名预设',
    description: text(raw.description), output: raw.output === 'tool' ? 'tool' : 'text',
    ...(raw.format ? { format: raw.format } : {}),
    mangaText: raw.mangaText === 'required' ? 'required' : 'auto',
    mangaComposition: raw.mangaComposition === 'expressive' ? 'expressive' : 'auto',
    ...(raw.rules !== undefined ? { rules: readRules(raw.rules) }
      : freshIds ? { rules: legacyRules({}, {}, raw.useBackendRules !== false) }
      : { useBackendRules: raw.useBackendRules !== false }), entries, variables,
    warnings: Array.isArray(raw.warnings) ? raw.warnings.filter((v: unknown) => typeof v === 'string').slice(0, 50) : [],
  };
}

export function validatePreset(raw: unknown): ImagePromptPreset {
  if (new Blob([JSON.stringify(raw)]).size > MAX_PRESET_BYTES) throw new Error('单份预设不能超过 2 MB');
  return readPreset(raw, false);
}

export function normalizeImagePresets(
  raw: unknown,
  oldPrompts?: Partial<Record<RuleKey, string>>,
  oldManga: { spec?: string; thinking?: string } = {},
): ImagePresetSettings {
  if (!record(raw)) raw = presetDefaults();
  const input = raw as Record<string, any>;
  const presets: ImagePromptPreset[] = [];
  for (const item of Array.isArray(input.presets) ? input.presets : []) {
    try {
      const preset = validatePreset(item);
      if (!preset.rules && oldPrompts) {
        preset.rules = legacyRules(oldPrompts, oldManga, preset.useBackendRules !== false);
        if (oldPrompts.comfySpec?.includes('[BBI_FORMAT:MOSS_LAYOUT]')) preset.format = 'moss_layout';
        delete preset.useBackendRules;
      }
      if (presets.some(p => p.id === preset.id)) preset.id = id();
      presets.push(preset);
    } catch { /* Preserve other valid presets if one saved record is corrupt. */ }
  }
  let activeId = presets.some(p => p.id === input.activeId) ? input.activeId : '';
  if (oldPrompts && input.rulesVersion !== 2 &&
      [...Object.values(oldPrompts), oldManga.spec, oldManga.thinking].some(value => value?.trim())) {
    const migrated = newImagePreset();
    migrated.name = '原有提示词（已迁移）';
    migrated.description = '升级前的自定义提示词与漫画规范，已独立保存。';
    migrated.entries = [];
    migrated.rules = legacyRules(oldPrompts, oldManga, true, true);
    presets.push(migrated);
    if (!activeId) activeId = migrated.id;
  }
  return {
    activeId, presets,
    directChannels: Array.isArray(input.directChannels) ? [...new Set(input.directChannels.filter((v: unknown): v is string => typeof v === 'string'))] as string[] : [],
    ...(oldPrompts || input.rulesVersion === 2 ? { rulesVersion: 2 as const } : {}),
  };
}

export function snapshotPreset(config: ImagePresetSettings): ImagePromptPreset | null {
  if (!config.activeId) return null;
  const found = config.presets.find(p => p.id === config.activeId);
  if (!found) throw new Error('所选配图预设不存在，请重新选择');
  return validatePreset(JSON.parse(JSON.stringify(found)));
}

export function exportPreset(preset: ImagePromptPreset): string {
  // Explicit allowlist: no channel, key, host settings or unrelated request profiles.
  const { name, description, output, format, mangaText, mangaComposition, useBackendRules, entries, variables, warnings, rules } = validatePreset(preset);
  const version = entries.some(entry => entry.placement === 'after_data') ? 3 : 2;
  return JSON.stringify({ format: PRESET_FORMAT, version, preset: { name, description, output, ...(format ? { format } : {}), mangaText, mangaComposition, rules: rules ?? legacyRules({}, {}, useBackendRules !== false), entries, variables, warnings } }, null, 2);
}

export function presetWithMangaRules(base: ImagePromptPreset, name: string, bundle: { spec: string; thinking: string }): ImagePromptPreset {
  const copy = importPresets(exportPreset(base))[0];
  copy.name = `${name} · 漫画`;
  copy.description = '工作流附带的漫画规范，独立保存于此预设。';
  copy.format = 'moss_layout';
  copy.rules!.mangaSpec = bundle.spec.trim() ? { mode: 'custom', text: bundle.spec } : { mode: 'builtin', text: '' };
  copy.rules!.mangaThinking = bundle.thinking.trim() ? { mode: 'custom', text: bundle.thinking } : { mode: 'builtin', text: '' };
  return validatePreset(copy);
}

function fromLegacy(name: string, raw: unknown): ImagePromptPreset {
  if (!record(raw) || !Array.isArray(raw.entries)) throw new Error(`预设 ${name} 缺少 entries`);
  const entries = raw.entries.map((e: any) => ({
    ...e, trigger: e.triggerMode === 'trigger' ? 'keywords' : 'always',
    keywords: text(e.triggerWords), andKeywords: text(e.andTriggerWords),
  }));
  return readPreset({
    name, entries, useBackendRules: true,
    description: '从智绘姬正文配图预设转换',
    warnings: [
      '仅转换提示词条目、启用状态和关键词条件；不导入 API 档案或其他任务。',
      '最终输出统一使用柏宝绘 JSON 协议；原预设的 XML、挂载正则和 ToolCall 引导不会作为可执行协议。',
      '不提供智绘姬专属服装库、角色调用或脚本环境；未知变量会在检查时报告，需自行补全或停用相关条目。',
    ],
  }, true);
}

export function importPresets(json: string, filename = '导入预设'): ImagePromptPreset[] {
  if (new Blob([json]).size > MAX_PRESET_BYTES) throw new Error('导入文件不能超过 2 MB');
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new Error('文件不是有效的 JSON'); }
  if (record(raw) && raw.format === PRESET_FORMAT) {
    if (![1, 2, 3].includes(raw.version)) throw new Error(`不支持的预设版本 ${raw.version}`);
    if (raw.version >= 2 && !record(raw.preset?.rules)) throw new Error(`v${raw.version} 预设缺少独立书写规范`);
    return [readPreset({ ...raw.preset, rules: raw.preset?.rules ?? legacyRules({}, {}, raw.preset?.useBackendRules !== false) }, true)];
  }
  if (record(raw) && raw.type === 'st_chatu8_request_type_profile') {
    const name = raw.request_type_profile?.image_gen?.context_profile;
    if (typeof name !== 'string' || !raw.context_presets?.[name]) throw new Error('档案中没有可用的正文配图 image_gen 预设');
    return [fromLegacy(name, raw.context_presets[name])];
  }
  if (record(raw) && Array.isArray(raw.entries)) {
    return ['triggerMode', 'triggerWords'].some(k => raw.entries.some((e: any) => record(e) && k in e))
      ? [fromLegacy(text(raw.name, filename), raw)]
      : [readPreset({ ...raw, name: text(raw.name, filename) }, true)];
  }
  const messages = Array.isArray(raw) ? raw : record(raw) ? raw.messages : null;
  if (Array.isArray(messages)) {
    if (record(raw) && ((Array.isArray(raw.tools) && raw.tools.length) ||
      (Array.isArray(raw.functions) && raw.functions.length) || record(raw.tool_choice) || record(raw.function_call) ||
      raw.tool_choice === 'required' || raw.function_call === 'required')) {
      throw new Error('这是完整 API 请求，其中包含工具协议，不能当作提示词预设等价导入。请导出正文配图预设；插件的提交方式由预设中的普通 JSON / 工具输出选项决定。');
    }
    return [readPreset({ name: filename.replace(/\.json$/i, ''), entries: messages }, true)];
  }
  if (record(raw)) {
    const pairs = Object.entries(raw);
    if (pairs.length && pairs.every(([, p]) => record(p) && Array.isArray(p.entries))) {
      return pairs.map(([name, p]) => fromLegacy(name, p));
    }
  }
  throw new Error('无法识别此文件。支持柏宝绘预设、role/content 消息列表和智绘姬正文配图预设；世界书请在生图世界书中导入。');
}
