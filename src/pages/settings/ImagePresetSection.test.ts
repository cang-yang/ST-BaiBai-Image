import { createRenderer, createSSRApp, ssrContextKey } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settings } from '@/state/settings';
import { newImagePreset } from '@/presets/model';
import ImagePresetSection from './ImagePresetSection.vue';

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
});

describe('preset section initial setup', () => {
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
