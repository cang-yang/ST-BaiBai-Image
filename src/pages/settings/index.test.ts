import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { describe, expect, it } from 'vitest';
import SettingsPage from './index.vue';

describe('settings task groups', () => {
  it('separates generation, references and appearance without discarding settings', async () => {
    const html = await renderToString(createSSRApp(SettingsPage));
    expect(html).toContain('aria-label="设置分类"');
    expect(html).toContain('生成设置');
    expect(html).toContain('参考与过滤');
    expect(html).toContain('界面与存储');
    expect(html).toContain('id="bbi-settings-generation"');
    expect(html).toContain('id="bbi-settings-reference"');
    expect(html).toContain('id="bbi-settings-appearance"');
    expect(html).toContain('aria-label="当前生成配置"');
  });
});
