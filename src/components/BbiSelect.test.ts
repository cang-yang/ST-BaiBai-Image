import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BbiSelect from './BbiSelect.vue';

afterEach(() => vi.unstubAllGlobals());

async function picker() {
  let state: any;
  const setup = BbiSelect.setup!;
  const html = await renderToString(createSSRApp({
    ...BbiSelect,
    setup(props: Parameters<typeof setup>[0], context: Parameters<typeof setup>[1]) {
      state = setup(props, context);
      return state;
    },
  }, {
    modelValue: 'a', ariaLabel: 'Entries', wrapLabels: true,
    options: [{ value: 'a', label: 'Entry A' }, { value: 'b', label: 'Entry B' }],
  }));
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('window', { innerHeight: 800, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  state.trigger.value = {
    getBoundingClientRect: () => ({ top: 200, bottom: 240, left: 40, width: 300 }),
    focus: vi.fn(),
  };
  return { state, html };
}

describe('themed picker interactions', () => {
  it('keeps a long list open when its own menu scrolls, but closes on page scroll', async () => {
    const { state } = await picker();
    const menu = {};
    state.menu.value = menu;
    state.openMenu();
    state.closeOnViewportChange({ composedPath: () => [state.menu.value] });
    expect(state.open.value).toBe(true);
    state.closeOnViewportChange({ composedPath: () => [] });
    expect(state.open.value).toBe(false);
  });

  it.each(['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'])(
    'owns %s without sending it to host shortcuts', async key => {
      const { state } = await picker();
      state.openMenu();
      const event = new Event('keydown', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'key', { value: key });
      state.onDocKeydown(event);
      expect(event.defaultPrevented).toBe(true);
      expect(event.cancelBubble).toBe(true);
      state.closeMenu();
    },
  );

  it('closes on Tab without trapping focus', async () => {
    const { state } = await picker();
    state.openMenu();
    const event = new Event('keydown', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'key', { value: 'Tab' });
    state.onDocKeydown(event);
    expect(state.open.value).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });
});
