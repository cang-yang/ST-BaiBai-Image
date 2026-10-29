export type ParameterScalar = string | number | boolean;
export interface ParameterOption { label: string; value: ParameterScalar }
export interface ParameterControl {
  nodeId: string;
  fieldName: string;
  label: string;
  common?: boolean;
  options?: ParameterOption[];
}

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const scalar = (v: unknown) => typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v);

export function normalizeParameterControls(raw: unknown): ParameterControl[] {
  if (!Array.isArray(raw)) return [];
  const result: ParameterControl[] = [];
  for (const item of raw.slice(0, 200)) {
    if (!record(item) || !['nodeId', 'fieldName', 'label'].every(k => typeof item[k] === 'string' && item[k].trim() && item[k].length <= 200)) continue;
    if (item.common !== undefined && typeof item.common !== 'boolean') continue;
    if (result.some(c => c.nodeId === item.nodeId && c.fieldName === item.fieldName)) continue;
    let options: ParameterOption[] | undefined;
    if (item.options !== undefined) {
      if (!Array.isArray(item.options) || !item.options.length || item.options.length > 100) continue;
      if (!item.options.every((o: unknown) => record(o) && typeof o.label === 'string' && o.label.length > 0 && o.label.length <= 200 && scalar(o.value))) continue;
      options = item.options.map((o: ParameterOption) => ({ label: o.label, value: o.value }));
      if (new Set(options.map(o => JSON.stringify(o.value))).size !== options.length) continue;
    }
    result.push({ nodeId: item.nodeId, fieldName: item.fieldName, label: item.label,
      ...(item.common !== undefined ? { common: item.common } : {}), ...(options ? { options } : {}) });
  }
  return result;
}
