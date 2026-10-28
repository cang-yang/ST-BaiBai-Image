export const RULE_KEYS = [
  'jailbreak', 'comfySpec', 'comfyThinking', 'naiSpec', 'naiThinking',
  'naiV5Spec', 'naiV5Thinking', 'mangaSpec', 'mangaThinking',
] as const;
export type RuleKey = typeof RULE_KEYS[number];
export interface PromptRule {
  mode: 'builtin' | 'custom' | 'off';
  text: string;
}
export type PresetRules = Record<RuleKey, PromptRule>;

export function defaultRules(): PresetRules {
  return Object.fromEntries(RULE_KEYS.map(key => [key, { mode: key === 'jailbreak' ? 'off' : 'builtin', text: '' }])) as PresetRules;
}

export function readRules(raw: unknown): PresetRules {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('预设书写规范必须是对象');
  const rules = defaultRules();
  for (const key of RULE_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`规范 ${key} 无效`);
    const block = value as PromptRule;
    if (!['builtin', 'custom', 'off'].includes(block.mode) || typeof block.text !== 'string') throw new Error(`规范 ${key} 的模式或文本无效`);
    rules[key] = { mode: block.mode, text: block.text };
  }
  return rules;
}

/** Copy old effective overrides once. Never retain a live link to global settings. */
export function legacyRules(
  prompts: Partial<Record<RuleKey, string>> = {},
  manga: { spec?: string; thinking?: string } = {},
  useBackendRules = true,
  includePrefix = false,
): PresetRules {
  const rules = defaultRules();
  for (const key of RULE_KEYS) {
    const value = key === 'mangaSpec' ? manga.spec || prompts.comfySpec
      : key === 'mangaThinking' ? manga.thinking || prompts.comfyThinking
      : prompts[key];
    if (value?.trim()) rules[key] = { mode: 'custom', text: value };
    if (!useBackendRules && key !== 'mangaSpec') rules[key].mode = 'off';
  }
  if (!includePrefix) rules.jailbreak = { mode: 'off', text: '' };
  else if (!prompts.jailbreak?.trim()) rules.jailbreak = { mode: 'builtin', text: '' };
  return rules;
}
