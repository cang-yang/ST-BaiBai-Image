import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { editorialLayouts } from './editorialLayouts';
import { parseCustomLayout, resizeMangaPanels } from './layouts';
import type { FrameBox, MangaCustomLayout } from './layouts';

const panelsOf = (layout: MangaCustomLayout) => layout.portrait!;
const area = ([top, left, bottom, right]: FrameBox) => (bottom - top) * (right - left);
const intersection = (a: FrameBox, b: FrameBox) =>
  Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
  Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
const inside = (a: FrameBox, b: FrameBox) =>
  a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];
const textSlots = /^(TL|TR|BL|BR)$/;
const capacity = (box: FrameBox) =>
  Math.floor((box[3] - box[1] - 48) / 32) * Math.floor((box[2] - box[0] - 48) / 40);

describe('opt-in editorial layouts', () => {
  it('ships importable JSON examples matching the layout factory', () => {
    editorialLayouts().forEach((layout,index)=>{
      const file=new URL(`../../examples/manga/0${index+3}-${layout.id}.json`,import.meta.url);
      expect(parseCustomLayout(readFileSync(file,'utf8'))).toEqual(layout);
    });
  });
  it('provides three named, independently editable artifacts with distinct topology', () => {
    const layouts = editorialLayouts();
    expect(layouts.map(layout => layout.id)).toEqual([
      'editorial_dialogue_3', 'editorial_reaction_4', 'editorial_message_3',
    ]);
    expect(layouts.map(layout => panelsOf(layout).length)).toEqual([3, 4, 3]);
    for (const layout of layouts) {
      expect(layout.label).toMatch(/[\u4e00-\u9fff]/);
      expect(layout.usage).toBeTruthy();
      expect(layout.readingOrder).toBeTruthy();
      expect(layout.landscape).toBeUndefined();
      expect(parseCustomLayout(JSON.stringify(layout))).toEqual(layout);
      for (const panel of panelsOf(layout)) {
        expect(panel.slotNotes?.F).toBeTruthy();
        expect(panel.shapes).toBeUndefined();
      }
    }
    const [dialogue, reaction, message] = layouts.map(panelsOf);
    expect(dialogue[0].slots.F[0]).toBe(dialogue[1].slots.F[0]);
    expect(dialogue[0].slots.F[3] - dialogue[0].slots.F[1])
      .not.toBe(dialogue[1].slots.F[3] - dialogue[1].slots.F[1]);
    expect(dialogue[2].slots.F[1]).toBe(dialogue[0].slots.F[1]);
    expect(reaction[0].slots.F[1]).toBe(reaction[3].slots.F[1]);
    expect(reaction[1].slots.F[0]).toBe(reaction[2].slots.F[0]);
    expect(message[0].slots.F[2]).toBe(message[2].slots.F[2]);
    expect(message[1].slots.F[1]).toBe(message[2].slots.F[1]);
    expect(message[0].slots.F[3] + 42).toBe(message[1].slots.F[1]);
    expect(message[1].slots.F[2] + 42).toBe(message[2].slots.F[0]);
    layouts[0].portrait![0].slots.F[0] = 0;
    expect(editorialLayouts()[0].portrait![0].slots.F[0]).toBe(-1192);
  });

  it('keeps all geometry on canvas, with real modest subject breakouts and protected text', () => {
    for (const layout of editorialLayouts()) {
      const canvas: FrameBox = [-1248, -832, 1248, 832];
      const panels = panelsOf(layout);
      const crossing: FrameBox[] = [];
      for (const panel of panels) {
        const frame = panel.slots.F;
        expect(inside(frame, [-1192, -776, 1192, 776])).toBe(true);
        expect(inside(panel.slots.C, frame)).toBe(true);
        for (const box of Object.values(panel.slots)) {
          expect(inside(box, canvas)).toBe(true);
          expect(box.every(Number.isSafeInteger)).toBe(true);
          expect(box[2]).toBeGreaterThan(box[0]);
          expect(box[3]).toBeGreaterThan(box[1]);
        }
        for (const [key, box] of Object.entries(panel.slots)) {
          if (/^(S|L|R)$/.test(key) && !inside(box, frame)) {
            crossing.push(box);
            expect(intersection(box, frame) / area(box)).toBeGreaterThan(.8);
            expect(Math.max(frame[0] - box[0], frame[1] - box[1], box[2] - frame[2], box[3] - frame[3]))
              .toBeLessThanOrEqual(160);
            expect(panel.slotNotes?.[key]).toContain('连续');
          }
          if (textSlots.test(key)) expect(inside(box, frame)).toBe(true);
        }
      }
      expect(crossing).toHaveLength(1);
      for (const panel of panels) {
        const text = Object.entries(panel.slots).filter(([key]) => textSlots.test(key));
        for (let i = 0; i < text.length; i++) {
          for (const subject of crossing) expect(intersection(text[i][1], subject)).toBe(0);
          for (const [, other] of text.slice(i + 1)) expect(intersection(text[i][1], other)).toBe(0);
        }
      }
    }
    const dialogue = panelsOf(editorialLayouts()[0]);
    expect(dialogue[0].slots.L).toBeDefined();
    expect(dialogue[0].slots.R).toBeDefined();
    expect(dialogue[2].slots.F[0] - dialogue[0].slots.F[2]).toBe(42);
    expect(dialogue[2].slots.F[0] - dialogue[2].slots.S[0]).toBeGreaterThanOrEqual(100);
    expect(capacity(dialogue[2].slots.TR)).toBeGreaterThanOrEqual(65);
    expect(capacity(dialogue[2].slots.BR)).toBeGreaterThanOrEqual(65);
    const message = panelsOf(editorialLayouts()[2]);
    expect(inside(message[0].slots.S,message[0].slots.F)).toBe(true);
    expect(message[2].slots.S[0]).toBeLessThan(message[1].slots.F[2]);
    for (const panel of message.slice(1)) {
      expect(capacity(panel.slots.TR ?? panel.slots.BR)).toBeGreaterThanOrEqual(65);
      expect(panel.slots.O).toBeDefined();
      expect(intersection(panel.slots.TR ?? panel.slots.BR, panel.slots.O)).toBe(0);
    }
  });

  it.each([[832, 1248], [1024, 1536], [2048, 3072]])(
    'uses the shared resize helper and parser for %i x %i',
    (width, height) => {
      const original = editorialLayouts();
      const resized = editorialLayouts(width, height);
      for (let index = 0; index < resized.length; index++) {
        expect(resized[index].canvas).toEqual({ width, height });
        expect(resized[index].portrait).toEqual(resizeMangaPanels(
          panelsOf(original[index]), { width: 1664, height: 2496 }, { width, height },
        ));
        expect(parseCustomLayout(JSON.stringify(resized[index]))).toEqual(resized[index]);
      }
    },
  );

  it.each([[1663, 2496], [1664, 2495], [2496, 1664], [0, 2496], [1664, 9000], [NaN, 2496]])(
    'rejects invalid or landscape canvases %s x %s through existing validation',
    (width, height) => {
      expect(() => editorialLayouts(width, height)).toThrow();
    },
  );
});
