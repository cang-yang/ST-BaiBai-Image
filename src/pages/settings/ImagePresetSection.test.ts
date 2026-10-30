import { createRenderer, createSSRApp, ssrContextKey } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settings } from '@/state/settings';
import { newImagePreset } from '@/presets/model';
import ImagePresetSection from './ImagePresetSection.vue';
import * as st from '@/st/context';
import * as api from '@/api/client';
import * as prompt from '@/autoTag/prompt';

const previousConfig = settings.imagePresets;
const previousBackend = settings.defaultBackend;
const previousManga = settings.manga.enabled;
type TestNode = { type: string; text: string; children: TestNode[]; parent: TestNode | null };
const node = (type: string, text = ''): TestNode => ({ type, text, children: [], parent: null });
const renderer = createRenderer<TestNode, TestNode>({
  createElement: type => node(type),
  createText: text => node('text', text),
  createComment: text => node('comment', text),
  setText: (target, text) => { target.text = text; },
  setElementText: (target, text) => { target.text = text; target.children = []; },
  parentNode: target => target.parent,
  nextSibling: target => target.parent?.children[target.parent.children.indexOf(target) + 1] ?? null,
  insert(target, parent, anchor) {
    if (target.parent) target.parent.children.splice(target.parent.children.indexOf(target), 1);
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, target);
    target.parent = parent;
  },
  remove(target) {
    if (target.parent) target.parent.children.splice(target.parent.children.indexOf(target), 1);
    target.parent = null;
  },
  patchProp: () => {},
  setScopeId: () => {},
  insertStaticContent(content, parent, anchor) {
    const target = node('static', content);
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, target);
    target.parent = parent;
    return [target, target];
  },
});
afterEach(() => {
  settings.imagePresets = previousConfig;
  settings.defaultBackend = previousBackend;
  settings.manga.enabled = previousManga;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('preset section initial setup', () => {
  it('locally previews the retained story and marks an inactive preset without sending', async () => {
    const active = newImagePreset(), selected = newImagePreset();
    selected.name = 'Candidate preset';
    settings.imagePresets = { activeId: active.id, presets: [active, selected], directChannels: [] };
    vi.spyOn(st, 'getContext').mockReturnValue({
      chat: [{ mes: '<thinking>Notes.</thinking>\nA traveler arrives.', is_user: false, is_system: false }],
      chatMetadata: {}, name1: 'User', name2: 'Char',
    } as any);
    vi.spyOn(prompt, 'buildAutoTagMessages').mockResolvedValueOnce([{ role: 'user', content: 'compiled' }]);
    const request = vi.spyOn(api, 'requestCompletion'), main = vi.spyOn(api, 'requestViaMainApi');
    let state!: Record<string, any>;
    const originalSetup = ImagePresetSection.setup!;
    const component = {
      ...ImagePresetSection,
      setup(props: Parameters<typeof originalSetup>[0], context: Parameters<typeof originalSetup>[1]) {
        state = originalSetup(props, context) as Record<string, any>;
        state.selected.value = selected.id;
        return state;
      },
    };
    await renderToString(createSSRApp(component));
    await state.inspect(false);
    expect(state.error.value).toBe('');
    expect(state.inputCheck.value).toMatchObject({
      presetName: 'Candidate preset', active: false, paragraphs: 1, cleanedText: 'A traveler arrives.',
    });
    expect(request).not.toHaveBeenCalled();
    expect(main).not.toHaveBeenCalled();
  });
  it('shows cleaned input and blocks paid tests before sending when no story remains', async () => {
    vi.spyOn(st, 'getContext').mockReturnValue({
      chat: [{ mes: '<thinking>Only private notes.</thinking>', is_user: false, is_system: false }],
      chatMetadata: {}, name1: 'User', name2: 'Char',
    } as any);
    const request = vi.spyOn(api, 'requestCompletion');
    const main = vi.spyOn(api, 'requestViaMainApi');
    let state!: Record<string, any>;
    const originalSetup = ImagePresetSection.setup!;
    const component = {
      ...ImagePresetSection,
      setup(props: Parameters<typeof originalSetup>[0], context: Parameters<typeof originalSetup>[1]) {
        state = originalSetup(props, context) as Record<string, any>;
        return state;
      },
    };
    await renderToString(createSSRApp(component));
    await state.inspect(true);
    expect(state.error.value).toContain('清洗后没有可用正文');
    expect(state.inputCheck.value).toMatchObject({ originalChars: 40, paragraphs: 0, cleanedText: '' });
    expect(request).not.toHaveBeenCalled();
    expect(main).not.toHaveBeenCalled();
  });
  it('edits entries with the themed picker without a duplicate content directory', async () => {
    const preset = newImagePreset();
    preset.format = 'moss_layout';
    preset.entries[0].name = 'A named creative entry';
    preset.entries[0].placement = 'after_data';
    settings.imagePresets = { activeId: preset.id, presets: [preset], directChannels: [] };
    const originalSetup = ImagePresetSection.setup!;
    const component = {
      ...ImagePresetSection,
      setup(props: Parameters<typeof originalSetup>[0], context: Parameters<typeof originalSetup>[1]) {
        const state = originalSetup(props, context) as Record<string, any>;
        state.edit(preset);
        return state;
      },
    };
    const html = await renderToString(createSSRApp(component));
    expect(html).not.toContain('内容目录');
    expect(html).toContain('bbi-select-trigger');
    expect(html).toContain('aria-label="选择预设条目"');
    expect(html).toContain('A named creative entry');
    expect(html).toContain('A named creative entry · 资料后');
    expect(html).toContain('aria-label="条目插入位置"');
    expect(html).toContain('资料前 · 任务约定');
    expect(html).toContain('资料后 · 执行与核对');
    expect(html).toContain('规范与检查');
    expect(html).toContain('输出与变量');
    const creativePanel = html.slice(html.indexOf('id="ip-panel-content"'), html.indexOf('id="ip-panel-rules"'));
    expect(creativePanel).toContain('漫画表现');
    expect(creativePanel).toContain('生动叙事 · 不强制出框');
    expect(html).not.toContain('>叙事出框</option>');
    expect(html).toContain('<details class="ip-effective"');
  });

  it('runs the real client setup before a draft exists', () => {
    settings.imagePresets = { activeId: '', presets: [], directChannels: [] };
    settings.defaultBackend = 'runninghub';
    settings.manga.enabled = false;
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const root = node('root');
    // Vitest compiles SFCs for SSR. Mount their real setup in a client renderer
    // because SSR deliberately skips non-immediate watchers.
    const app = renderer.createApp({ ...ImagePresetSection, render: () => null });
    app.provide(ssrContextKey, { modules: new Set() });
    let mounted = false;
    try {
      expect(() => { app.mount(root); mounted = true; }).not.toThrow();
    } finally {
      if (mounted) app.unmount();
    }
  });

  it('renders the builtin preset before an edit draft exists', async () => {
    settings.imagePresets = { activeId: '', presets: [], directChannels: [] };
    settings.defaultBackend = 'runninghub';
    settings.manga.enabled = false;

    const html = await renderToString(createSSRApp(ImagePresetSection));

    expect(html).toContain('aria-label="正文配图预设"');
    expect(html).toContain('内置默认');
    expect(html).toContain('当前生效配置');
    expect(html).toContain('检查与试运行');
    expect(html).toContain('复制并编辑');
    expect(html).not.toContain('保存预设');
  });

  it('renders an active saved preset and its rule sources before editing', async () => {
    const preset = newImagePreset();
    preset.name = 'SSR manga fixture';
    preset.format = 'moss_layout';
    preset.rules!.mangaSpec = { mode: 'custom', text: 'A concise test rule.' };
    settings.imagePresets = { activeId: preset.id, presets: [preset], directChannels: [] };
    settings.defaultBackend = 'runninghub';

    const html = await renderToString(createSSRApp(ImagePresetSection));

    expect(html).toContain('SSR manga fixture');
    expect(html).toContain('漫画 · MOSS Layout');
    expect(html).toContain('本预设自定义');
    expect(html).toContain('1 个开启条目');
    expect(html).toContain('检查与试运行');
    expect(html).not.toContain('保存预设');
  });
});

describe('preset tab keyboard ownership', () => {
  it.each([
    { key: 'ArrowRight', index: 3, focused: 0 },
    { key: 'ArrowLeft', index: 0, focused: 3 },
    { key: 'Home', index: 2, focused: 0 },
    { key: 'End', index: 1, focused: 3 },
    { key: 'Escape', index: 1, focused: -1 },
  ])('scopes $key only when the tab handler uses it', ({ key, index, focused }) => {
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const app = renderer.createApp({ ...ImagePresetSection, render: () => null });
    app.provide(ssrContextKey, { modules: new Set() });
    app.mount(node('root'));
    try {
      const tabs = Array.from({ length: 4 }, () => ({ focus: vi.fn() }));
      const event = new Event('keydown', { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        key: { value: key },
        currentTarget: { value: { parentElement: { querySelectorAll: () => tabs } } },
      });
      const instance = app._instance as unknown as { setupState: { tabKey: (event: KeyboardEvent, index: number) => void } };

      instance.setupState.tabKey(event as KeyboardEvent, index);

      expect(event.defaultPrevented).toBe(focused >= 0);
      expect(event.cancelBubble).toBe(focused >= 0);
      tabs.forEach((tab, tabIndex) => expect(tab.focus).toHaveBeenCalledTimes(tabIndex === focused ? 1 : 0));
    } finally {
      app.unmount();
    }
  });
});
