import { describe, expect, it, vi } from 'vitest';
import { newImagePreset } from './model';
import { assertMangaText, MangaTextError, MangaTextCorrectionError, withMangaTextCorrection } from './mangaText';
import { mangaDefaults } from '@/manga/layouts';
import type { ImagePlan } from '@/autoTag/protocol';
import type { ChatMsg } from '@/api/client';

const preset = { ...newImagePreset(), mangaText: 'required' as const };
const manga = { ...mangaDefaults(), enabled: true };
function page(items: unknown[] = []): ImagePlan['images'][number] {
  return { position: 'P1', sourceLine: 0, size: 'portrait', negative: '', nl: '', characters: [],
    tag: JSON.stringify({ layout: 'balanced_1', summary: { caption: 'A manga page.' }, items: [
      { panel: 1, slot: 'S', label: 'character', caption: 'A traveler waits.' }, ...items,
    ] }) };
}
const text = (caption: string, value = '我回来了。', slot = 'TR') =>
  ({ panel: 1, slot, label: 'text', caption, text: value });
const plan = (...images: ImagePlan['images']): ImagePlan => ({ images, changes: [] });

describe('required manga lettering', () => {
  it('leaves legacy and non-manga plans unchanged', () => {
    expect(() => assertMangaText(plan(page()), newImagePreset(), true, manga)).not.toThrow();
    expect(() => assertMangaText(plan(page()), preset, false, manga)).not.toThrow();
    expect(() => assertMangaText(plan(), preset, true, manga)).not.toThrow();
  });
  it('rejects blank pages, whitespace, SFX and signs as narrative text', () => {
    for (const items of [[], [text('speech bubble', '  ')], [text('Japanese handwritten sound effect', 'ドン')],
      [text('lettering on a shop sign')], [text('a blank speech bubble', '')]]) {
      expect(() => assertMangaText(plan(page(items)), preset, true, manga)).toThrow(MangaTextError);
    }
  });
  it('accepts speech, thoughts, narration and readable messages', () => {
    for (const caption of ['spoken by Alice, an oval bubble', 'a tailless thought bubble',
      'a narration box', 'a chat message box with Chinese lettering',
      'a speech bubble, not a sound effect', 'a chat message box quoting a shop sign']) {
      expect(() => assertMangaText(plan(page([text(caption)])), preset, true, manga)).not.toThrow();
    }
  });
  it('checks every page and validates actual text slots', () => {
    expect(() => assertMangaText(plan(page([text('speech bubble')]), page()), preset, true, manga)).toThrow(/第 2 页/);
    expect(() => assertMangaText(plan(page([text('speech bubble', '你好', 'S')])), preset, true, manga)).toThrow(/字区/);
    const bad = page([text('speech bubble')]);
    bad.tag = bad.tag.replace('balanced_1', 'nonexistent');
    expect(() => assertMangaText(plan(bad), preset, true, manga)).toThrow(/版式/);
  });
});

describe('one bounded lettering correction', () => {
  const messages: ChatMsg[] = [{ role: 'user', content: 'source story' }];
  it('reuses source context, marks history and validates a single corrected response', async () => {
    const send = vi.fn(async (_messages: ChatMsg[], _source: string, validate: (raw: string) => void) => {
      const raw = send.mock.calls.length === 1 ? 'missing' : 'good';
      validate(raw); return raw;
    });
    const validate = (raw: string) => { if (raw === 'missing') throw new MangaTextError('第 1 页缺少叙事文字'); };
    expect(await withMangaTextCorrection(messages, 'test', undefined, send, validate)).toBe('good');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][1]).toContain('文字补正 1/1');
    expect(send.mock.calls[1][0][0]).toEqual(messages[0]);
    expect(send.mock.calls[1][0].at(-1)?.content).toContain('第 1 页');
    expect(messages).toHaveLength(1);
  });
  it('stops after a failed correction and never retries unrelated network failures', async () => {
    const validate = () => { throw new MangaTextError('missing'); };
    const send = vi.fn(async (_m: ChatMsg[], _s: string, check: (raw: string) => void) => { check('bad'); return 'bad'; });
    await expect(withMangaTextCorrection(messages, 'test', undefined, send, validate)).rejects.toBeInstanceOf(MangaTextCorrectionError);
    expect(send).toHaveBeenCalledTimes(2);
    const network = vi.fn(async () => { throw new Error('network'); });
    await expect(withMangaTextCorrection(messages, 'test', undefined, network, validate)).rejects.toThrow('network');
    expect(network).toHaveBeenCalledTimes(1);
  });
  it('does not correct after cancellation', async () => {
    const controller = new AbortController();
    const send = vi.fn(async () => { controller.abort(); throw new MangaTextError('missing'); });
    await expect(withMangaTextCorrection(messages, 'test', controller.signal, send, () => {})).rejects.toMatchObject({ name: 'AbortError' });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
