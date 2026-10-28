import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { describe, expect, it, vi } from 'vitest';
import PresetRuleEditor from './PresetRuleEditor.vue';

vi.mock('@/presets/catalog', () => ({ BUILTIN_RULES: { mangaSpec: '内置规范' } }));

describe('preset rule source visibility', () => {
  it('shows the builtin source and effective character count before expansion', async () => {
    const html = await renderToString(createSSRApp(PresetRuleEditor, {
      rule: { mode: 'builtin', text: 'unused custom text' }, ruleKey: 'mangaSpec', title: '书写规范',
    }));
    expect(html).toContain('内置参考 · 4 字');
    expect(html).toContain('内置规范');
  });

  it('counts custom content and makes an empty override explicit', async () => {
    const html = await renderToString(createSSRApp(PresetRuleEditor, {
      rule: { mode: 'custom', text: '你好🌸' }, ruleKey: 'mangaSpec', title: '书写规范',
    }));
    expect(html).toContain('本预设自定义 · 3 字');
    const empty = await renderToString(createSSRApp(PresetRuleEditor, {
      rule: { mode: 'custom', text: '' }, ruleKey: 'mangaSpec', title: '书写规范',
    }));
    expect(empty).toContain('自定义内容为空');
  });

  it('does not count retained custom text when the rule is disabled', async () => {
    const html = await renderToString(createSSRApp(PresetRuleEditor, {
      rule: { mode: 'off', text: 'retained but inactive' }, ruleKey: 'mangaSpec', title: '书写规范',
    }));
    expect(html).toContain('不附加 · 0 字');
    expect(html).not.toContain('retained but inactive');
  });
});
