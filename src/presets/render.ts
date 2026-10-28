import type { ChatMsg } from '@/api/client';
import type { ImagePromptPreset } from './model';

export const PRESET_VARIABLES = [
  ['story', '目标正文'], ['context', '此前上下文'], ['character', '角色卡'], ['persona', '用户人设'],
  ['worldbook', '已触发的全局世界书'], ['library', '角色固定外貌库'], ['memory', '柏宝书记忆'],
  ['task', '本次任务备注'], ['user', '用户名字'], ['char', '角色名字'],
  ['min_images', '最少图片数'], ['max_images', '最多图片数'],
] as const;
const aliases: Record<string, string> = {
  '正文': 'story', '上下文': 'context', '世界书触发': 'worldbook',
  '角色启用列表': 'library', '通用角色启用列表': 'library', '用户需求': 'task',
};

export interface RenderedPreset {
  messages: ChatMsg[];
  activated: string[];
  warnings: string[];
}

export function renderPreset(
  preset: ImagePromptPreset,
  values: Record<string, string>,
  triggerText: string,
  random: () => number = Math.random,
): RenderedPreset {
  const locals = new Map(Object.entries(preset.variables));
  const warnings = new Set<string>();
  const activated: string[] = [];
  const messages: ChatMsg[] = [];
  const match = (words: string) => words.split(/[,，\n]/).map(s => s.trim()).filter(Boolean).some(word => triggerText.includes(word));
  const get = (key: string, original: string): string => {
    if (locals.has(key)) return locals.get(key)!;
    const canonical = aliases[key] ?? key;
    if (Object.hasOwn(values, canonical)) return values[canonical];
    warnings.add(`未提供变量: ${key}`);
    return original;
  };
  for (const entry of preset.entries) {
    if (!entry.enabled) continue;
    if (entry.trigger === 'keywords' && (!match(entry.keywords) || (entry.andKeywords.trim() && !match(entry.andKeywords)))) continue;
    activated.push(entry.name);
    // Only literal local assignment/read. Never invoke host macros, slash commands or scripts.
    const content = entry.content.replace(
      /\{@(setvar::([^:@{}]+)::([\s\S]*?)|getvar::([^@{}]+))@\}|\{\{([^{}]+)\}\}/g,
      (original, _op: string, setKey: string, setValue: string, getKey: string, macro: string) => {
        if (setKey !== undefined) { locals.set(setKey.trim(), setValue); return ''; }
        if (getKey !== undefined) return get(getKey.trim(), original);
        const key = macro.trim();
        const roll = key.match(/^roll\s+(\d+)$/);
        if (roll) {
          const sides = Number(roll[1]);
          if (Number.isSafeInteger(sides) && sides > 0) return String(Math.floor(random() * sides) + 1);
        }
        return get(key, original);
      },
    );
    if (content.includes('【ToolCall引导】')) warnings.add('条目包含旧 ToolCall 引导，请移除该块；工具输出由“输出方式”统一控制');
    if (content.trim()) messages.push({ role: entry.role, content });
  }
  return { messages, activated, warnings: [...warnings] };
}

export function assertPresetReady(result: RenderedPreset): void {
  if (result.warnings.length) throw new Error(`预设需要调整：${result.warnings.slice(0, 8).join('；')}`);
}
