import type { ChatMsg } from '@/api/client';
import type { PromptRule } from '@/presets/rules';

export function ruleSummary(rule: PromptRule, builtin: string): string {
  const text = rule.mode === 'builtin' ? builtin : rule.mode === 'custom' ? rule.text : '';
  const source = rule.mode === 'builtin' ? '内置参考' : rule.mode === 'custom' ? '本预设自定义' : '不附加';
  return `${source} · ${Array.from(text).length} 字${rule.mode === 'custom' && !text.trim() ? ' · 自定义内容为空' : ''}`;
}

export function previewPurpose(purpose: ChatMsg['purpose']): string {
  return purpose ? { prefix: '通用前置规则', spec: '书写规范与适用版式', contract: '插件固定协议', check: '检查指导' }[purpose] : '剧情与预设内容';
}
