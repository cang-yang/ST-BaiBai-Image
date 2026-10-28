import { describe, expect, it } from 'vitest';
import { normalizeRunningHub, runningHubDefaults } from './runninghubConfig';
import {
  buildRunningHubOverrides, exportRunningHubWorkflow, importRunningHubWorkflow,
  runningHubFields, setRunningHubField, validateRunningHubWorkflow, workflowIdFromText, runningHubMangaSettings, prepareRunningHubPrompt,
} from './runninghubWorkflow';
import { applyMangaFrames, buildMangaSpec, mangaDefaults, resolveLayouts } from '@/manga/layouts';

const graph = {
  '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['48', 0], text: 'best quality, %prompt%\n%nl%' } },
  '5': { class_type: 'CLIPTextEncode', inputs: { text: 'bad anatomy' } },
  '6': { class_type: 'EmptyLatentImage', inputs: { width: '%width%', height: '%height%', batch_size: 1 } },
  '16': { class_type: 'KSampler', inputs: { seed: '%seed%', model: ['78', 0], steps: 30 } },
  '78': { class_type: 'LoraLoaderModelOnly', inputs: { strength_model: 0.5, lora_name: 'alba.safetensors' } },
};
const template = JSON.stringify(graph);
const values = { prompt: 'portrait "A" \\ $&\nsecond line', nl: 'An adult.', width: 768, height: 1024, seed: 42 };

describe('RunningHub workflow compatibility', () => {
  it('distinguishes a Tavern world book from a workflow', () => {
    expect(() => importRunningHubWorkflow('{"entries":{"0":{"content":"reference"}}}')).toThrow('世界书');
  });
  it('roundtrips a manga bundle without credentials and applies it only on request', () => {
    const p = importRunningHubWorkflow(template);
    p.manga = true;
    p.mangaPositive = '@style, best quality';
    p.portraitSize = '1664x2496';
    p.landscapeSize = '2496x1664';
    p.mangaBundle = { spec: 'author spec', thinking: 'author checklist', selectionNotes: 'prefer breakouts', custom: [{
      id: 'breakout', canvas: { width: 1664, height: 2496 },
      portrait: [{ position: 'main', slots: { F: [-500, -800, 1200, 800], S: [-650, -600, 1200, 600] } }],
    }] };
    const copy = importRunningHubWorkflow(exportRunningHubWorkflow(p));
    expect(copy.mangaBundle).toEqual(p.mangaBundle);
    expect(normalizeRunningHub({ workflows: [copy] }).workflows[0].mangaPositive).toBe(p.mangaPositive);
    const original = mangaDefaults();
    original.spec = 'existing';
    original.disabled = ['balanced_1'];
    expect(original.spec).toBe('existing');
    const applied = runningHubMangaSettings(copy, original);
    expect(applied.spec).toBe('author spec');
    expect(applied.thinking).toBe('author checklist');
    expect(applied.disabled).toEqual(['balanced_1']);
    expect(original.custom).toEqual([]);
    const symbolic = JSON.stringify({ layout: 'breakout', summary: { canvas: 'single', caption: 'An adult traveler.' },
      items: [{ panel: 1, slot: 'S', label: 'character', caption: 'An adult traveler in a coat.' }] });
    const compiled = prepareRunningHubPrompt(symbolic, copy, applied, { width: 1664, height: 2496 });
    const json = JSON.parse(compiled);
    expect(json.summary.caption).toMatch(/^@style, best quality\n/);
    expect(json.summary.caption).toContain('extending across the outer border');
    expect(json.items[0].bbox).toEqual([-650, -600, 1200, 600]);
    expect(json.layout).toBeUndefined();
    expect(JSON.parse(symbolic).layout).toBe('breakout');
    expect(() => prepareRunningHubPrompt(symbolic, copy, original, { width: 1664, height: 2496 })).toThrow('漫画模式');
  });
  it('rejects malformed bundled layouts instead of silently enabling a different layout', () => {
    expect(() => importRunningHubWorkflow(JSON.stringify({ workflow: graph, baibai: {
      manga: true, mangaBundle: { custom: [{ id: 'bad', canvas: { width: 1664, height: 2496 }, portrait: [
        { position: 'first', slots: { F: [-9999, 0, 20, 40] } },
      ] }] },
    } }))).toThrow();
  });
  it('imports the existing three-key Tavern wrapper, preserving the snowflake ID', () => {
    const preset = importRunningHubWorkflow(JSON.stringify({ name: 'ALBA', workflowId: '2110000000000000001', workflow: template }));
    expect(preset.workflowId).toBe('2110000000000000001');
    expect(preset.name).toBe('ALBA');
    expect(validateRunningHubWorkflow(preset)).toBe('');
  });
  it('rejects numeric snowflake IDs instead of accepting rounded numbers', () => {
    expect(() => importRunningHubWorkflow(JSON.stringify({ workflowId: 2110000000000000001, workflow: template }))).toThrow('字符串');
  });
  it('accepts UTF-8 BOM, raw API graphs, and object-valued workflows', () => {
    expect(importRunningHubWorkflow('\uFEFF' + template).workflowId).toBe('');
    expect(JSON.parse(importRunningHubWorkflow(JSON.stringify({ workflow: graph })).workflow)).toEqual(graph);
  });
  it('rejects UI graphs with nodes/links arrays and malformed files', () => {
    expect(() => importRunningHubWorkflow('{"nodes":[],"links":[]}')).toThrow('API');
    expect(() => importRunningHubWorkflow('[]')).toThrow();
  });
  it('preserves literal prompt characters and typed scalar values without touching graph links', () => {
    const overrides = buildRunningHubOverrides(template, values);
    expect(overrides).toContainEqual({ nodeId: '4', fieldName: 'text', fieldValue: `best quality, ${values.prompt}\nAn adult.` });
    expect(overrides).toContainEqual({ nodeId: '6', fieldName: 'width', fieldValue: 768 });
    expect(overrides).toContainEqual({ nodeId: '16', fieldName: 'seed', fieldValue: 42 });
    expect(overrides.some(o => o.fieldName === 'clip' || o.fieldName === 'model')).toBe(false);
  });
  it('sends fixed negative and LoRA weights even when they have no placeholders', () => {
    const overrides = buildRunningHubOverrides(template, values);
    expect(overrides).toContainEqual({ nodeId: '5', fieldName: 'text', fieldValue: 'bad anatomy' });
    expect(overrides).toContainEqual({ nodeId: '78', fieldName: 'strength_model', fieldValue: 0.5 });
  });
  it('supports Chinese prompt/size/seed placeholders used by Chatu8 exports', () => {
    const text = template.replace('%prompt%', '%正面提示词%').replace('%width%', '%宽度%').replace('%seed%', '%种子%');
    expect(buildRunningHubOverrides(text, values)).toEqual(buildRunningHubOverrides(template, values));
  });
  it('rejects unresolved and missing prompt placeholders before making billable calls', () => {
    expect(() => buildRunningHubOverrides(template.replace('%seed%', '%steps%'), values)).toThrow('steps');
    expect(() => buildRunningHubOverrides(template.replace('%prompt%', 'fixed'), values)).toThrow('%prompt%');
    expect(() => buildRunningHubOverrides(template, { prompt: 'x' })).toThrow('尺寸');
  });
  it('exports no credentials and roundtrips per-workflow settings', () => {
    const preset = importRunningHubWorkflow(template);
    preset.workflowId = '1234';
    preset.naturalLanguage = true;
    preset.outputNodeId = '18';
    preset.manga = true;
    preset.keyId = 'private-account';
    const text = exportRunningHubWorkflow({ ...preset, apiKey: 'secret' } as typeof preset);
    expect(text).not.toContain('secret');
    expect(text).not.toContain('private-account');
    const copy = importRunningHubWorkflow(text);
    expect(copy).toMatchObject({ naturalLanguage: true, outputNodeId: '18', workflowId: '1234', workflow: template, manga: true });
  });
  it('resizes manga layouts to workflow dimensions without changing the input or enable flags', () => {
    const preset = importRunningHubWorkflow(template);
    preset.portraitSize = '1664x2496';
    preset.landscapeSize = '2496x1664';
    const original = mangaDefaults();
    original.disabled = ['balanced_1'];
    original.selectionNotes = 'keep my notes';
    const manga = runningHubMangaSettings(preset, original);
    expect(original.custom).toEqual([]);
    expect(original.enabled).toBe(false);
    expect(manga).toMatchObject({ enabled: true, disabled: ['balanced_1'], selectionNotes: 'keep my notes' });
    for (const direction of ['portrait', 'landscape'] as const) {
      const layouts = resolveLayouts(manga, direction);
      const canvas = direction === 'portrait' ? { width: 1664, height: 2496 } : { width: 2496, height: 1664 };
      expect(layouts.length).toBeGreaterThan(0);
      for (const layout of layouts) expect(layout.canvas).toEqual(canvas);
      const prompt = JSON.stringify({ layout: layouts[0].id, items: [{ panel: 1, slot: 'F', caption: 'An empty room.' }] });
      expect(JSON.parse(applyMangaFrames(prompt, manga, canvas)).bbox_coord_space).toBe('abs_centralized');
    }
    expect(buildMangaSpec(manga)).toContain('portrait(1664×2496)');
    expect(buildMangaSpec(manga)).not.toContain('portrait(1088×1920)');
  });
  it('rejects inconsistent manga sizes before mutating settings', () => {
    const preset = importRunningHubWorkflow(template);
    preset.portraitSize = '1664x2496';
    expect(() => runningHubMangaSettings(preset, mangaDefaults())).toThrow('宽高交换');
  });
  it('edits an existing input only and keeps its connections intact', () => {
    const updated = setRunningHubField(template, '5', 'text', 'fixed, %negative_prompt%');
    expect(runningHubFields(updated).find(f => f.nodeId === '5')?.value).toBe('fixed, %negative_prompt%');
    expect(JSON.parse(updated)['4'].inputs.clip).toEqual(['48', 0]);
    expect(() => setRunningHubField(template, '5', 'made-up', 'x')).toThrow();
  });
  it('accepts only known workflow URL patterns without rounding IDs', () => {
    expect(workflowIdFromText('https://www.runninghub.ai/zh-cn/workflow/2110000000000000001')).toBe('2110000000000000001');
    expect(workflowIdFromText('https://runninghub.cn/post/1234')).toBe('1234');
    expect(workflowIdFromText('https://evil.test/workflow/1234')).toBe('');
  });
});

describe('RunningHub settings normalization', () => {
  it('preserves selected workflows and valid credentials on reload', () => {
    const config = runningHubDefaults();
    config.apiKey = ' key ';
    config.workflows[0].workflow = template;
    expect(normalizeRunningHub(config)).toMatchObject({ apiKey: 'key', activeWorkflowId: config.activeWorkflowId });
    expect(normalizeRunningHub(config).workflows[0].workflow).toBe(template);
  });
  it('disables costly options by default and normalizes invalid values', () => {
    const c = normalizeRunningHub({ url: 'https://evil.test', concurrency: 999, retainSeconds: 5, timeoutMinutes: 0, workflows: [] });
    expect(c).toMatchObject({ url: 'https://www.runninghub.ai', concurrency: 1, retainSeconds: 0, timeoutMinutes: 10, instanceType: 'default' });
    expect(c.workflows).toHaveLength(1);
    expect(c.activeWorkflowId).toBe(c.workflows[0].id);
  });
  it('repairs duplicate preset IDs', () => {
    const c = normalizeRunningHub({ workflows: [{ id: 'x' }, { id: 'x' }] });
    expect(new Set(c.workflows.map(w => w.id)).size).toBe(2);
  });
});
