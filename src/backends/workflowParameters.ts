import { parseWorkflowTemplate, type ComfyWorkflow } from './comfyui';
import { normalizeParameterControls, type ParameterScalar as Scalar, type ParameterOption, type ParameterControl } from './workflowParameterSchema';
export { normalizeParameterControls } from './workflowParameterSchema';
export type { ParameterControl } from './workflowParameterSchema';
export interface WorkflowParameter {
  nodeId: string;
  fieldName: string;
  title: string;
  classType: string;
  label: string;
  value: Scalar;
  kind: 'boolean' | 'number' | 'text';
  integer: boolean;
  options?: ParameterOption[];
  common: boolean;
  modified: boolean;
}

const isScalar = (v: unknown): v is Scalar =>
  typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v);
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const INTEGERS = new Set(['width', 'height', 'seed', 'noise_seed', 'batch_size', 'steps']);
const LABELS: Record<string, string> = {
  unet_name: '主模型文件', ckpt_name: '模型文件', weight_dtype: '模型精度',
  clip_name: '文本编码器', vae_name: 'VAE 文件', lora_name: 'LoRA 文件',
  strength_model: '模型强度', strength_clip: '文本编码强度',
  width: '画布宽度', height: '画布高度', seed: '随机种子', noise_seed: '随机种子',
  batch_size: '批次数量', steps: '采样步数', cfg: '提示词引导强度（CFG）',
  sampler_name: '采样方法', scheduler: '调度方式', denoise: '降噪强度',
  text: '提示词文本', image: '参考图', filename_prefix: '输出文件名前缀',
  shift: '采样偏移', sampling: '采样类型', delimiter: '拼接分隔符',
  device: '运行设备', type: '类型', double_layers: '双流层', single_layers: '单流层',
  start_percent: '开始比例', end_percent: '结束比例', enabled: '启用',
  switch: '开关', value: '参数值',
};
const NODE_LABELS: Record<string, string> = {
  UNETLoader: '主模型', CheckpointLoaderSimple: '模型加载', CLIPLoader: '文本编码器',
  VAELoader: 'VAE 加载', CLIPTextEncode: '提示词编码', EmptyFlux2LatentImage: '画布',
  EmptyLatentImage: '画布', KSampler: '采样设置', LoraLoaderModelOnly: 'LoRA',
  LoraLoader: 'LoRA', PrimitiveBoolean: '开关', PrimitiveInt: '整数参数',
  PrimitiveFloat: '数值参数', PrimitiveStringMultiline: '文本内容',
  SaveImage: '图片输出', ModelSamplingAuraFlow: '模型采样',
  SkipLayerGuidanceDiTSimple: '跳层引导', StringConcatenate: '文本拼接',
};
const SOURCES: Record<string, string> = {
  '%prompt%': '剧情提示词', '%negative_prompt%': '动态负面词', '%nl%': '自然语言描述',
  '%prompt%\n%nl%': '剧情提示词＋自然语言', '%width%': '跟随画布宽度',
  '%height%': '跟随画布高度', '%seed%': '跟随本次种子',
};
const ALIASES: Record<string, string> = {
  '%提示词%': '%prompt%', '%正面提示词%': '%prompt%', '%负面提示词%': '%negative_prompt%',
  '%宽度%': '%width%', '%高度%': '%height%', '%种子%': '%seed%',
};
export function parameterSourceLabel(value: Scalar): string {
  if (typeof value !== 'string') return '';
  return SOURCES[ALIASES[value] ?? value] ?? (/%[^%\s]+%/.test(value) ? '混合动态内容' : '');
}

function fields(graph: ComfyWorkflow): WorkflowParameter[] {
  return Object.entries(graph).flatMap(([nodeId, node]) => {
    if (!record(node) || !record(node.inputs) || typeof node.class_type !== 'string') return [];
    const classType = node.class_type;
    return Object.entries(node.inputs).flatMap(([fieldName, value]) => {
      if (!isScalar(value)) return [];
      const numeric = typeof value === 'number' || typeof value === 'string' &&
        ['%width%', '%height%', '%seed%'].includes(ALIASES[value] ?? value);
      const title = String((node._meta as any)?.title ?? classType);
      return [{
        nodeId, fieldName, title,
        classType, label: fieldName === 'value' ? title : fieldName === 'strength_model' && /Lora/.test(classType) ? 'LoRA 模型强度' : LABELS[fieldName] ?? fieldName, value,
        kind: typeof value === 'boolean' ? 'boolean' : numeric ? 'number' : 'text',
        integer: numeric && (INTEGERS.has(fieldName) || fieldName === 'value' && classType === 'PrimitiveInt'),
        modified: false, common: false,
      } satisfies WorkflowParameter];
    });
  });
}

export function workflowParameters(template: string, definitions: unknown = [], initialWorkflow = '') {
  const graph = parseWorkflowTemplate(template);
  let baseline: ComfyWorkflow = {};
  try { baseline = parseWorkflowTemplate(initialWorkflow); } catch { /* Older imports have no baseline. */ }
  const all = fields(graph);
  const controls = normalizeParameterControls(definitions);
  const warnings: string[] = [];
  for (const control of controls) {
    const field = all.find(f => f.nodeId === control.nodeId && f.fieldName === control.fieldName);
    if (!field) { warnings.push(`控件“${control.label}”对应的参数不存在`); continue; }
    field.label = control.label;
    if (control.options) {
      const valid = control.options.every(o => typeof o.value === typeof field.value &&
        (!field.integer || typeof o.value === 'number' && Number.isSafeInteger(o.value)));
      if (valid) field.options = control.options;
      else warnings.push(`控件“${control.label}”的选项类型不匹配，已使用普通输入`);
    }
  }
  const common: WorkflowParameter[] = [];
  for (const field of all) {
    const original = baseline[field.nodeId];
    field.modified = original?.class_type === field.classType &&
      record(original.inputs) && isScalar(original.inputs[field.fieldName]) &&
      original.inputs[field.fieldName] !== field.value;
    const control = controls.find(c => c.nodeId === field.nodeId && c.fieldName === field.fieldName);
    field.common = control?.common ?? (field.kind === 'boolean' || ['steps', 'cfg', 'denoise', 'strength_model'].includes(field.fieldName));
    if (field.common) common.push(field);
  }
  common.sort((a, b) => Number(b.kind === 'boolean') - Number(a.kind === 'boolean'));
  const groups = [...new Set(all.map(f => f.nodeId))].map(id => ({
    id, title: all.find(f => f.nodeId === id)!.title,
    label: NODE_LABELS[all.find(f => f.nodeId === id)!.classType] ?? all.find(f => f.nodeId === id)!.title,
    classType: all.find(f => f.nodeId === id)!.classType, fields: all.filter(f => f.nodeId === id),
  }));
  return { common, groups, sources: all.filter(f => parameterSourceLabel(f.value)), nodeCount: Object.values(graph).filter(n => record(n) && typeof n.class_type === 'string' && record(n.inputs)).length,
    fieldCount: all.length, modifiedCount: all.filter(f => f.modified).length, warnings };
}

export function configureWorkflowParameter(template: string, definitions: unknown, nodeId: string, fieldName: string, patch: { label?: string; common?: boolean }): ParameterControl[] {
  const field = fields(parseWorkflowTemplate(template)).find(f => f.nodeId === nodeId && f.fieldName === fieldName);
  if (!field) throw new Error('此参数不是可编辑的标量输入');
  const controls = normalizeParameterControls(definitions);
  const index = controls.findIndex(c => c.nodeId === nodeId && c.fieldName === fieldName);
  const control: ParameterControl = { ...(controls[index] ?? { nodeId, fieldName, label: field.label }) };
  if (patch.label !== undefined) {
    const label = patch.label.trim() || field.label;
    if (label.length > 200) throw new Error('显示名称不能超过 200 个字符');
    control.label = label;
  }
  if (patch.common !== undefined) control.common = patch.common;
  if (index < 0) controls.push(control);
  else controls[index] = control;
  return controls;
}

export function parameterSourceOptions(field: WorkflowParameter): { value: string; label: string }[] {
  let values: string[] = [];
  if (field.kind === 'boolean') return [];
  if (field.fieldName === 'width' || field.fieldName === 'height') values = [`%${field.fieldName}%`];
  else if (['seed', 'noise_seed'].includes(field.fieldName)) values = ['%seed%'];
  else if (field.kind === 'text' && (field.fieldName === 'text' ||
    field.fieldName === 'value' && /String/.test(field.classType))) values = ['%prompt%', '%negative_prompt%', '%nl%', '%prompt%\n%nl%'];
  return values.map(value => ({ value, label: SOURCES[value] }));
}

export function editWorkflowParameter(template: string, nodeId: string, fieldName: string, raw: Scalar, action: 'value' | 'source' = 'value'): string {
  const graph = parseWorkflowTemplate(template);
  const field = fields(graph).find(f => f.nodeId === nodeId && f.fieldName === fieldName);
  if (!field) throw new Error('此参数不是可编辑的标量输入');
  let value: Scalar = raw;
  if (action === 'source') {
    if (!parameterSourceOptions(field).some(o => o.value === raw)) throw new Error('此参数不支持该动态来源');
  } else if (field.kind === 'boolean') {
    if (typeof raw !== 'boolean') throw new Error('开关必须使用布尔值');
  } else if (field.kind === 'number') {
    if (typeof raw === 'boolean' || typeof raw === 'string' && !raw.trim()) throw new Error('请输入有效数字');
    value = Number(raw);
    if (!Number.isFinite(value) || field.integer && !Number.isSafeInteger(value)) throw new Error(field.integer ? '请输入安全范围内的整数' : '请输入有效数字');
  } else if (typeof raw !== 'string') throw new Error('请输入文本');
  (graph[nodeId].inputs as Record<string, unknown>)[fieldName] = value;
  return JSON.stringify(graph, null, 2);
}

export function resetWorkflowParameters(template: string, initialWorkflow: string, nodeId?: string, fieldName?: string): string {
  const graph = parseWorkflowTemplate(template), baseline = parseWorkflowTemplate(initialWorkflow);
  for (const field of fields(graph)) {
    if (nodeId !== undefined && field.nodeId !== nodeId || fieldName !== undefined && field.fieldName !== fieldName) continue;
    const original = baseline[field.nodeId];
    if (original?.class_type !== field.classType || !record(original.inputs)) continue;
    const value = original.inputs[field.fieldName];
    if (isScalar(value)) (graph[field.nodeId].inputs as Record<string, unknown>)[field.fieldName] = value;
  }
  return JSON.stringify(graph, null, 2);
}
