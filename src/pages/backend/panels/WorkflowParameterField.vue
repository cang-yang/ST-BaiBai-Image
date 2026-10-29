<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BbiSelect from '@/components/BbiSelect.vue';
import Icon from '@/components/Icon.vue';
import { parameterSourceLabel, parameterSourceOptions, type WorkflowParameter } from '@/backends/workflowParameters';

const props = defineProps<{ field: WorkflowParameter; advanced?: boolean; uploadDisabled?: boolean }>();
const emit = defineEmits<{
  edit: [value: string | number | boolean, action?: 'value' | 'source'];
  reset: [];
  upload: [event: Event];
  configure: [patch: { label?: string; common?: boolean }];
}>();
const draft = ref('');
watch(() => props.field.value, value => { draft.value = String(value); }, { immediate: true });
const source = computed(() => parameterSourceLabel(props.field.value));
const sources = computed(() => parameterSourceOptions(props.field));
const options = computed(() => {
  const result = (props.field.options ?? []).map(o => ({ label: o.label, value: JSON.stringify(o.value) }));
  if (!props.field.options?.some(o => o.value === props.field.value)) {
    result.push({ label: `当前值：${String(props.field.value)}`, value: JSON.stringify(props.field.value) });
  }
  return result;
});
const multiline = computed(() => props.field.kind === 'text' &&
  (['text', 'value'].includes(props.field.fieldName) && /String|TextEncode/.test(props.field.classType) ||
  String(props.field.value).includes('\n') || String(props.field.value).length > 120));
function saveDraft() { emit('edit', draft.value); }
</script>

<template>
  <div class="wf-field">
    <div class="wf-heading">
      <label :for="`wf-${advanced ? 'all' : 'common'}-${field.nodeId}-${field.fieldName}`" :title="`${field.title} · ${field.nodeId}.${field.fieldName}`">{{ field.label }}</label>
      <span v-if="field.modified" class="wf-changed">已修改</span>
      <button v-if="advanced || field.common" type="button" class="wf-icon wf-pin" :class="{ 'wf-pinned': field.common }" :aria-pressed="field.common" :title="field.common ? '移出常用设置' : '加入常用设置'" :aria-label="`${field.common ? '移出' : '加入'}常用 ${field.nodeId}.${field.fieldName}`" @click="emit('configure', { common: !field.common })"><Icon name="star" /></button>
      <button v-if="field.modified" type="button" class="wf-icon" :title="`恢复 ${field.label}`" :aria-label="`恢复 ${field.nodeId}.${field.fieldName}`" @click="emit('reset')"><Icon name="history" /></button>
    </div>
    <div v-if="field.options && field.kind === 'boolean'" class="wf-modes" role="group" :aria-label="field.label">
      <button v-for="option in field.options" :key="String(option.value)" type="button" :aria-pressed="field.value === option.value" @click="emit('edit', option.value)">{{ option.label }}</button>
    </div>
    <div v-else-if="source" class="wf-source"><Icon name="vars" /><span>{{ source }}</span></div>
    <BbiSelect v-else-if="field.options" :model-value="JSON.stringify(field.value)" :options="options" :aria-label="field.label" wrap-labels @update:model-value="emit('edit', JSON.parse($event))" />
    <label v-else-if="field.kind === 'boolean'" class="wf-toggle">
      <input :id="`wf-${advanced ? 'all' : 'common'}-${field.nodeId}-${field.fieldName}`" type="checkbox" class="bbi-checkbox" :checked="field.value === true" :aria-label="field.label" @change="emit('edit', ($event.target as HTMLInputElement).checked)" />
      <span>{{ field.value ? 'true' : 'false' }}</span>
    </label>
    <textarea v-else-if="multiline" :id="`wf-${advanced ? 'all' : 'common'}-${field.nodeId}-${field.fieldName}`" v-model="draft" class="bbi-input" rows="3" :aria-label="field.label" spellcheck="false" @change="saveDraft" />
    <input v-else :id="`wf-${advanced ? 'all' : 'common'}-${field.nodeId}-${field.fieldName}`" v-model="draft" class="bbi-input" :type="field.kind === 'number' ? 'number' : 'text'" :step="field.integer ? '1' : 'any'" :aria-label="field.label" spellcheck="false" @change="saveDraft" />
    <p v-if="!advanced && field.title !== field.label" class="wf-summary">{{ field.title }}</p>
    <div v-if="advanced" class="wf-technical"><code>{{ field.nodeId }}.{{ field.fieldName }}</code></div>
    <details v-if="advanced" class="wf-binding"><summary>显示名称</summary><input class="bbi-input" :value="field.label" :aria-label="`${field.nodeId}.${field.fieldName} 显示名称`" maxlength="200" @change="emit('configure', { label: ($event.target as HTMLInputElement).value })" /></details>
    <details v-if="advanced && (sources.length || source)" class="wf-binding">
      <summary>参数来源</summary>
      <BbiSelect :model-value="typeof field.value === 'string' ? field.value : ''" :options="sources" :aria-label="`${field.nodeId}.${field.fieldName} 参数来源`" wrap-labels @update:model-value="emit('edit', $event, 'source')" />
      <div class="wf-fixed">
        <input v-model="draft" class="bbi-input" :aria-label="`${field.nodeId}.${field.fieldName} 固定值`" spellcheck="false" />
        <button type="button" class="bbi-btn bbi-btn-sm" @click="saveDraft">设为固定值</button>
      </div>
    </details>
    <details v-if="advanced && field.options && field.kind !== 'boolean'" class="wf-binding"><summary>自定义值</summary><div class="wf-fixed"><input v-model="draft" class="bbi-input" :aria-label="`${field.nodeId}.${field.fieldName} 自定义值`" /><button type="button" class="bbi-btn bbi-btn-sm" @click="saveDraft">应用</button></div></details>
    <label v-if="advanced && field.fieldName === 'image'" class="wf-upload">参考图<input type="file" accept="image/png,image/jpeg,image/webp" :aria-label="`${field.nodeId} 上传参考图`" :disabled="uploadDisabled" @change="emit('upload', $event)" /></label>
  </div>
</template>

<style scoped>
.wf-field { display: grid; gap: 7px; min-width: 0; padding: 12px 0; }
.wf-heading { display: flex; align-items: center; gap: 8px; min-width: 0; }
.wf-heading label { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.wf-changed { font-size: 11px; color: var(--bbi-accent); margin-left: auto; white-space: nowrap; }
.wf-pin { margin-left: auto; }
.wf-changed + .wf-pin { margin-left: 0; }
.wf-pinned { color: var(--bbi-accent) !important; }
.wf-icon { border: 0; background: transparent; color: var(--bbi-ink-soft); cursor: pointer; width: 30px; height: 30px; flex: 0 0 30px; }
.wf-icon:hover { color: var(--bbi-ink); background: var(--bbi-surface-2); }
.wf-icon:focus-visible, .wf-modes button:focus-visible, summary:focus-visible { outline: 2px solid var(--bbi-accent); outline-offset: 2px; }
.wf-modes { display: flex; padding: 3px; background: var(--bbi-surface-2); border-radius: var(--bbi-radius-sm); gap: 3px; }
.wf-modes button { flex: 1; min-width: 0; min-height: 38px; border: 0; background: transparent; color: var(--bbi-ink-soft); border-radius: var(--bbi-radius-sm); cursor: pointer; font: inherit; font-size: 13px; overflow-wrap: anywhere; }
.wf-modes button[aria-pressed="true"] { background: var(--bbi-surface); color: var(--bbi-accent); font-weight: 600; }
.wf-toggle, .wf-source { display: flex; align-items: center; gap: 9px; font-size: 13px; min-height: 32px; }
.wf-source { background: var(--bbi-surface-2); padding: 8px 10px; border-radius: var(--bbi-radius-sm); }
.wf-source span { overflow-wrap: anywhere; }
.bbi-input { width: 100%; min-width: 0; box-sizing: border-box; }
textarea { resize: vertical; }
p { margin: 0; }
.wf-summary { font-size: 12px; color: var(--bbi-ink-soft); line-height: 1.6; }
.wf-technical { font-size: 11px; color: var(--bbi-ink-soft); overflow-wrap: anywhere; }
summary { cursor: pointer; font-size: 12px; color: var(--bbi-ink-soft); padding: 6px 0; }
.wf-binding[open] { display: grid; gap: 8px; }
.wf-fixed { display: flex; gap: 8px; min-width: 0; }
.wf-fixed .bbi-btn { flex-shrink: 0; }
.wf-upload { display: grid; gap: 6px; font-size: 12px; }
.wf-upload input { max-width: 100%; }
@media (max-width: 420px) { .wf-fixed { flex-direction: column; } }
</style>
