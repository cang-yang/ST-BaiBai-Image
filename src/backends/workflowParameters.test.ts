import { describe, expect, it } from 'vitest';
import {
  workflowParameters, editWorkflowParameter, resetWorkflowParameters,
  normalizeParameterControls, parameterSourceOptions, configureWorkflowParameter,
} from './workflowParameters';
import { buildRunningHubOverrides, exportRunningHubWorkflow, importRunningHubWorkflow } from './runninghubWorkflow';
import { normalizeRunningHub } from './runninghubConfig';

const graph = {
  mode: { class_type: 'PrimitiveBoolean', inputs: { value: true }, _meta: { title: '模式开关' } },
  fast: { class_type: 'LoraLoaderModelOnly', inputs: { model: ['base', 0], lora_name: 'dmd.safetensors', strength_model: 0.7 } },
  base: { class_type: 'UNETLoader', inputs: { unet_name: 'moss.safetensors' } },
  model: { class_type: 'ComfySwitchNode', inputs: { switch: ['mode', 0], on_true: ['fast', 0], on_false: ['base', 0] } },
  fastSteps: { class_type: 'PrimitiveInt', inputs: { value: 8 } },
  normalSteps: { class_type: 'PrimitiveInt', inputs: { value: 50 } },
  fastCfg: { class_type: 'PrimitiveFloat', inputs: { value: 1 } },
  normalCfg: { class_type: 'PrimitiveFloat', inputs: { value: 3 } },
  steps: { class_type: 'ComfySwitchNode', inputs: { switch: ['mode', 0], on_true: ['fastSteps', 0], on_false: ['normalSteps', 0] } },
  cfg: { class_type: 'ComfySwitchNode', inputs: { switch: ['mode', 0], on_true: ['fastCfg', 0], on_false: ['normalCfg', 0] } },
  sampler: { class_type: 'KSampler', inputs: { model: ['model', 0], steps: ['steps', 0], cfg: ['cfg', 0], seed: '%seed%', sampler_name: 'euler' } },
  prompt: { class_type: 'PrimitiveStringMultiline', inputs: { value: '%prompt%' } },
  canvas: { class_type: 'EmptyLatentImage', inputs: { width: '%width%', height: '%height%', batch_size: 1 } },
};
const template = JSON.stringify(graph);

describe('workflow parameter controls', () => {
  it('uses original node names and scalar types without inferring workflow-specific meanings', () => {
    const model = workflowParameters(template);
    const mode = model.common.find(f => f.nodeId === 'mode')!;
    expect(mode.label).toBe('模式开关');
    expect(mode.kind).toBe('boolean');
    expect(mode.options).toBeUndefined();
    expect(model.nodeCount).toBe(13);
    expect(model.groups.find(g => g.id === 'canvas')!.fields).toHaveLength(3);
  });
  it('edits the actual boolean and leaves all branch values and links intact', () => {
    const changed = editWorkflowParameter(template, 'mode', 'value', false);
    expect(JSON.parse(changed)).toEqual({ ...graph, mode: { ...graph.mode, inputs: { value: false } } });
    expect(workflowParameters(changed).common.find(f => f.nodeId === 'mode')!.value).toBe(false);
    expect(buildRunningHubOverrides(changed, { prompt: '{}', width: 100, height: 200, seed: 1 }))
      .toContainEqual({ nodeId: 'mode', fieldName: 'value', fieldValue: false });
  });
  it('does not mislabel an unrelated boolean or incomplete switch network as a speed mode', () => {
    const minimal = JSON.stringify({ flag: { class_type: 'CustomFlag', inputs: { enabled: false } } });
    expect(workflowParameters(minimal).common[0].options).toBeUndefined();
    const broken = structuredClone(graph);
    broken.sampler.inputs.cfg = ['fastCfg', 0];
    expect(workflowParameters(JSON.stringify(broken)).common.find(f => f.nodeId === 'mode')!.options).toBeUndefined();
  });
  it('supports explicit selector labels on any boolean without special node classes or topology', () => {
    const generic = JSON.stringify({ flag: { class_type: 'AnyCustomNode', inputs: { enabled: false } } });
    const options = [{ label: '方案甲', value: true }, { label: '方案乙', value: false }];
    const field = workflowParameters(generic, [{ nodeId: 'flag', fieldName: 'enabled', label: '方案', options }]).common[0];
    expect(field.label).toBe('方案');
    expect(field.options).toEqual(options);
  });
  it('ignores non-node metadata and malformed samplers without hiding usable fields', () => {
    const mixed = { ...graph, info: null, extra: 'metadata', broken: { class_type: 'KSampler' } };
    const model = workflowParameters(JSON.stringify(mixed));
    expect(model.common[0].label).toBe('模式开关');
    expect(model.nodeCount).toBe(13);
    expect(model.fieldCount).toBe(workflowParameters(template).fieldCount);
  });
  it('lets users rename and pin any scalar without changing graph values or other controls', () => {
    const controls = [{ nodeId: 'mode', fieldName: 'value', label: '开关', common: true }];
    const pinned = configureWorkflowParameter(template, controls, 'base', 'unet_name', { label: '我的模型', common: true });
    expect(pinned).toContainEqual(controls[0]);
    expect(workflowParameters(template, pinned).common.find(f => f.nodeId === 'base')?.label).toBe('我的模型');
    const hidden = configureWorkflowParameter(template, pinned, 'mode', 'value', { common: false });
    expect(workflowParameters(template, hidden).common.some(f => f.nodeId === 'mode')).toBe(false);
    const cleared = configureWorkflowParameter(template, pinned, 'base', 'unet_name', { label: '' });
    expect(workflowParameters(template, cleared).common.find(f => f.nodeId === 'base')?.label).toBe('主模型文件');
    expect(() => configureWorkflowParameter(template, pinned, 'sampler', 'model', { common: true })).toThrow();
    expect(JSON.parse(template)).toEqual(graph);
  });
  it('keeps valid portable controls, warns about stale controls, and preserves unknown enum values', () => {
    const controls = [
      { nodeId: 'sampler', fieldName: 'sampler_name', label: '采样方法', common: true, options: [{ label: 'Euler', value: 'euler' }] },
      { nodeId: 'missing', fieldName: 'value', label: '失效' },
    ];
    const model = workflowParameters(template, controls);
    expect(model.common.find(f => f.nodeId === 'sampler')?.label).toBe('采样方法');
    expect(model.warnings).toHaveLength(1);
    expect(normalizeParameterControls([{ ...controls[0], label: '<script>bad</script>', options: 'invalid' }])).toEqual([]);
  });
  it('validates numeric edits and does not convert empty input to zero', () => {
    expect(() => editWorkflowParameter(template, 'fastSteps', 'value', '')).toThrow();
    expect(() => editWorkflowParameter(template, 'fastSteps', 'value', '1.5')).toThrow();
    expect(() => editWorkflowParameter(template, 'fastSteps', 'value', 'NaN')).toThrow();
    expect(() => editWorkflowParameter(template, 'mode', 'value', 'false')).toThrow();
    expect(JSON.parse(editWorkflowParameter(template, 'fastSteps', 'value', '12')).fastSteps.inputs.value).toBe(12);
    expect(() => editWorkflowParameter(template, 'sampler', 'model', 'x')).toThrow();
  });
  it('preserves arbitrary string enums even when field names resemble numeric settings', () => {
    const custom = JSON.stringify({ custom: { class_type: 'ThirdPartyNode', inputs: { steps: 'auto', width: 'original' } } });
    const model = workflowParameters(custom);
    expect(model.groups[0].fields.every(f => f.kind === 'text')).toBe(true);
    const options = [{ label: '自动', value: 'auto' }, { label: '自适应', value: 'adaptive' }];
    expect(workflowParameters(custom, [{ nodeId: 'custom', fieldName: 'steps', label: '模式', options }]).groups[0].fields[0].options).toEqual(options);
    expect(JSON.parse(editWorkflowParameter(custom, 'custom', 'steps', 'adaptive')).custom.inputs.steps).toBe('adaptive');
  });
  it('restricts dynamic sources and keeps numeric bindings numeric when made fixed', () => {
    const fields = workflowParameters(template).groups.flatMap(g => g.fields);
    expect(parameterSourceOptions(fields.find(f => f.nodeId === 'base')!)).toEqual([]);
    expect(parameterSourceOptions(fields.find(f => f.nodeId === 'mode')!)).toEqual([]);
    expect(parameterSourceOptions(fields.find(f => f.fieldName === 'width')!).map(o => o.value)).toEqual(['%width%']);
    expect(() => editWorkflowParameter(template, 'mode', 'value', '%prompt%', 'source')).toThrow();
    expect(() => editWorkflowParameter(template, 'canvas', 'width', '%prompt%', 'source')).toThrow();
    expect(JSON.parse(editWorkflowParameter(template, 'canvas', 'width', '1664')).canvas.inputs.width).toBe(1664);
  });
  it('restores only scalars of matching existing nodes without reverting topology', () => {
    const changed = JSON.parse(editWorkflowParameter(template, 'mode', 'value', false));
    changed.sampler.inputs.model = ['base', 0];
    changed.extra = { class_type: 'Unknown', inputs: { value: 9 } };
    const restored = JSON.parse(resetWorkflowParameters(JSON.stringify(changed), template, 'mode', 'value'));
    expect(restored.mode.inputs.value).toBe(true);
    expect(restored.sampler.inputs.model).toEqual(['base', 0]);
    expect(restored.extra.inputs.value).toBe(9);
    const altered = structuredClone(graph);
    altered.mode.class_type = 'DifferentType';
    expect(JSON.parse(resetWorkflowParameters(JSON.stringify(altered), template)).mode.class_type).toBe('DifferentType');
    expect(workflowParameters(JSON.stringify(changed), [], template).common[0].modified).toBe(true);
  });
  it('persists and exports definitions and original scalar defaults without credentials', () => {
    const controls = [{ nodeId: 'mode', fieldName: 'value', label: '生成模式' }];
    const imported = importRunningHubWorkflow(JSON.stringify({
      workflowId: '1234', workflow: graph, baibai: { parameterControls: controls },
    }));
    expect(imported.parameterControls).toEqual(controls);
    expect(imported.initialWorkflow).toBe(imported.workflow);
    imported.workflow = editWorkflowParameter(imported.workflow, 'mode', 'value', false);
    const normalized = normalizeRunningHub({ workflows: [imported] }).workflows[0];
    expect(normalized.parameterControls).toEqual(controls);
    expect(JSON.parse(normalized.initialWorkflow!).mode.inputs.value).toBe(true);
    const copy = importRunningHubWorkflow(exportRunningHubWorkflow(normalized));
    expect(copy.parameterControls).toEqual(controls);
    expect(JSON.parse(copy.initialWorkflow!).mode.inputs.value).toBe(true);
    expect(JSON.parse(copy.workflow).mode.inputs.value).toBe(false);
  });
});
