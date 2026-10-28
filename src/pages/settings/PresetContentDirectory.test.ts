import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { describe, expect, it } from 'vitest';
import { newImagePreset } from '@/presets/model';
import { defaultRules, RULE_KEYS } from '@/presets/rules';
import PresetContentDirectory from './PresetContentDirectory.vue';
import { previewPurpose } from './presetEditor';

describe('complete preset directory', () => {
  const builtinRules = Object.fromEntries(RULE_KEYS.map(key => [key, '内置参考'])) as Record<typeof RULE_KEYS[number], string>;
  const target = { label: '漫画', spec: 'mangaSpec', check: 'mangaThinking' } as const;

  it('renders enabled and disabled entries alongside rules, output and readonly additions', async () => {
    const preset = newImagePreset();
    preset.entries = [
      { ...preset.entries[0], id: 'active', name: '画面风格', content: '柔和线条' },
      { ...preset.entries[0], id: 'disabled', name: '条件要求', content: '特殊构图', enabled: false, trigger: 'keywords', keywords: 'example' },
    ];
    preset.mangaText = 'required';
    const rules = defaultRules();
    rules.mangaSpec = { mode: 'custom', text: '自定义规范' };
    const html = await renderToString(createSSRApp(PresetContentDirectory, {
      preset, rules, builtinRules, target, variableCount: 2, hasPreview: false,
    }));
    for (const text of ['画面风格', '条件要求', '停用 · 关键词条件 · 4 字', '书写规范', '检查指导', '通用前置规则', '本预设自定义 · 5 字', '输出设置', '必须有叙事文字', '自定义变量', '2 个', '版式设置', '固定协议', '剧情上下文', '本地检查后可见', '只读']) {
      expect(html).toContain(text);
    }
    expect(html).toContain('type="button"');
    expect(html).not.toContain('<details');
  });

  it('distinguishes an inactive manga policy and available local preview', async () => {
    const html = await renderToString(createSSRApp(PresetContentDirectory, {
      preset: newImagePreset(), rules: defaultRules(), builtinRules,
      target: { label: '普通配图', spec: 'comfySpec', check: 'comfyThinking' }, variableCount: 0, hasPreview: true,
    }));
    expect(html).toContain('按剧情安排 · 当前未启用漫画');
    expect(html).toContain('已有本地预览');
    expect(html).not.toContain('本地检查后可见');
  });
});

describe('request preview purposes', () => {
  it('preserves each existing purpose as a distinct label', () => {
    expect(['prefix', 'spec', 'contract', 'check', undefined].map(purpose => previewPurpose(purpose as Parameters<typeof previewPurpose>[0]))).toEqual([
      '通用前置规则', '书写规范与适用版式', '插件固定协议', '检查指导', '剧情与预设内容',
    ]);
  });
});
