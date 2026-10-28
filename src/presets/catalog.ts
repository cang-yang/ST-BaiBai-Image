import {
  DEFAULT_COMFY_SPEC, DEFAULT_COMFY_THINKING, DEFAULT_JAILBREAK_PROMPT,
  DEFAULT_NAI_SPEC, DEFAULT_NAI_THINKING, DEFAULT_NAI_V5_SPEC, DEFAULT_NAI_V5_THINKING,
} from '@/state/settings';
import type { ImagePromptPreset } from './model';
import { defaultRules, legacyRules, RULE_KEYS, type RuleKey } from './rules';

export const BUILTIN_RULES: Record<RuleKey, string> = {
  jailbreak: DEFAULT_JAILBREAK_PROMPT,
  comfySpec: DEFAULT_COMFY_SPEC, comfyThinking: DEFAULT_COMFY_THINKING,
  naiSpec: DEFAULT_NAI_SPEC, naiThinking: DEFAULT_NAI_THINKING,
  naiV5Spec: DEFAULT_NAI_V5_SPEC, naiV5Thinking: DEFAULT_NAI_V5_THINKING,
  mangaSpec: 'Use the host MOSS Layout JSON format. Describe each visible scene and subject in captions, keep character identity and scene continuity, and put exact lettering in text fields. Follow the supplied layout and coordinate contract; do not prepend tag lists to Layout JSON.',
  mangaThinking: '内部核对事实与状态、人物归属、镜头与接触、文字读序、JSON 与版式；只提交最终配图计划，不输出逐格推理或草稿。',
};

export function builtinImagePreset(): ImagePromptPreset {
  const rules = defaultRules();
  rules.jailbreak.mode = 'builtin';
  return { id: '', name: '内置默认', description: '', output: 'text', rules, entries: [], variables: {}, warnings: [] };
}

export function resolvePresetRules(preset: ImagePromptPreset): Record<RuleKey, string> {
  const rules = preset.rules ?? legacyRules({}, {}, preset.useBackendRules !== false);
  return Object.fromEntries(RULE_KEYS.map(key => {
    const rule = rules[key];
    return [key, rule.mode === 'off' ? '' : rule.mode === 'builtin' ? BUILTIN_RULES[key] : rule.text];
  })) as Record<RuleKey, string>;
}

export const RULE_TARGETS = [
  { value: 'comfy', label: '普通配图 · RunningHub / ComfyUI', spec: 'comfySpec', check: 'comfyThinking' },
  { value: 'manga', label: '漫画 · MOSS Layout', spec: 'mangaSpec', check: 'mangaThinking' },
  { value: 'naiV5', label: 'NovelAI 4.5 / V5', spec: 'naiV5Spec', check: 'naiV5Thinking' },
  { value: 'nai', label: '旧版 NovelAI', spec: 'naiSpec', check: 'naiThinking' },
] as const;
