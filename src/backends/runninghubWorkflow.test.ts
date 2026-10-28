import { describe, expect, it } from 'vitest';
import { normalizeRunningHub, runningHubDefaults } from './runninghubConfig';
import {
  buildRunningHubOverrides, exportRunningHubWorkflow, importRunningHubWorkflow,
  runningHubFields, setRunningHubField, validateRunningHubWorkflow, workflowIdFromText,
} from './runninghubWorkflow';

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
    const text = exportRunningHubWorkflow({ ...preset, apiKey: 'secret' } as typeof preset);
    expect(text).not.toContain('secret');
    const copy = importRunningHubWorkflow(text);
    expect(copy).toMatchObject({ naturalLanguage: true, outputNodeId: '18', workflowId: '1234', workflow: template });
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
