<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Icon from '@/components/Icon.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import WorkflowParameterField from './WorkflowParameterField.vue';
import type { RunningHubPreset } from '@/backends/runninghubConfig';
import { workflowParameters, editWorkflowParameter, resetWorkflowParameters, parameterSourceLabel, configureWorkflowParameter, type WorkflowParameter } from '@/backends/workflowParameters';
import type { ParameterControl } from '@/backends/workflowParameterSchema';

const props = defineProps<{ preset: RunningHubPreset; uploadDisabled?: boolean }>();
const emit = defineEmits<{ update: [workflow: string]; configure: [controls: ParameterControl[]]; upload: [field: WorkflowParameter, event: Event] }>();
const query = ref(''), error = ref(''), advanced = ref(false), confirmReset = ref(false);
watch(() => props.preset.id, () => { query.value = ''; error.value = ''; advanced.value = false; });
watch(() => props.preset.workflow, workflow => {
  if (workflow.trim() && !props.preset.initialWorkflow) props.preset.initialWorkflow = workflow;
}, { immediate: true });
const model = computed(() => {
  try { return workflowParameters(props.preset.workflow, props.preset.parameterControls, props.preset.initialWorkflow); }
  catch { return null; }
});
const groups = computed(() => {
  const search = query.value.trim().toLowerCase();
  return (model.value?.groups ?? []).map(group => ({
    ...group, fields: group.fields.filter(field => `${group.label} ${group.title} ${group.classType} ${group.id} ${field.label} ${field.fieldName}`.toLowerCase().includes(search)),
  })).filter(group => group.fields.length);
});
function edit(field: WorkflowParameter, value: string | number | boolean, action?: 'value' | 'source') {
  try {
    emit('update', editWorkflowParameter(props.preset.workflow, field.nodeId, field.fieldName, value, action));
    error.value = '';
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
}
function reset(field?: WorkflowParameter) {
  try {
    emit('update', resetWorkflowParameters(props.preset.workflow, props.preset.initialWorkflow!, field?.nodeId, field?.fieldName));
    error.value = '';
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  confirmReset.value = false;
}
function configure(field: WorkflowParameter, patch: { label?: string; common?: boolean }) {
  try {
    emit('configure', configureWorkflowParameter(props.preset.workflow, props.preset.parameterControls, field.nodeId, field.fieldName, patch));
    error.value = '';
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
}
</script>

<template>
  <section class="wp-editor">
    <div class="wp-header">
      <h4>工作流参数</h4>
      <span v-if="model" class="wp-count">{{ model.nodeCount }} 个节点 · {{ model.fieldCount }} 项参数</span>
    </div>
    <p v-if="!model" class="wp-warning" role="status">{{ preset.workflow.trim() ? '工作流格式无效' : '尚未导入工作流' }}</p>
    <template v-else>
      <p v-if="!model.fieldCount" class="wp-count" role="status">此工作流没有可编辑的标量参数</p>
      <div v-if="model.common.length" class="wp-common" aria-label="常用设置">
        <h5>常用设置</h5>
        <WorkflowParameterField v-for="field in model.common" :key="`${preset.id}/${field.nodeId}/${field.fieldName}`" :field="field" @edit="(value, action) => edit(field, value, action)" @reset="reset(field)" @configure="configure(field, $event)" />
      </div>
      <dl v-if="model.sources.length" class="wp-sources" aria-label="自动输入">
        <div v-for="field in model.sources" :key="`${field.nodeId}/${field.fieldName}`"><dt>{{ field.fieldName === 'value' || field.fieldName === 'text' ? parameterSourceLabel(field.value) : field.label }}</dt><dd>{{ ['%width%', '%height%', '%seed%'].includes(String(field.value)) ? parameterSourceLabel(field.value) : '插件自动填入' }}</dd></div>
      </dl>
      <p v-for="warning in model.warnings" :key="warning" class="wp-warning" role="status">{{ warning }}</p>
      <button v-if="model.fieldCount" type="button" class="wp-disclosure" :aria-expanded="advanced" @click="advanced = !advanced"><span>全部参数<span v-if="model.modifiedCount"> · {{ model.modifiedCount }} 项已修改</span></span><Icon name="chevron" :class="{ 'wp-open': advanced }" /></button>
      <div v-if="advanced" class="wp-advanced">
        <div class="wp-toolbar">
          <div class="wp-search"><Icon name="search" /><input v-model="query" type="search" class="bbi-input" aria-label="搜索工作流参数" placeholder="搜索节点或参数" /></div>
          <button type="button" class="bbi-icon-btn" :disabled="!model.modifiedCount" title="恢复导入时的参数" aria-label="恢复全部工作流参数" @click="confirmReset = true"><Icon name="history" /></button>
        </div>
        <p v-if="!groups.length" class="wp-count" role="status">没有匹配的参数</p>
        <details v-for="group in groups" :key="`${preset.id}/${group.id}`" class="wp-node" :open="!!query.trim()">
          <summary><span>{{ group.label }}</span><small>{{ group.title }} · 节点 {{ group.id }} · {{ group.fields.length }} 项</small></summary>
          <div class="wp-node-fields">
            <WorkflowParameterField v-for="field in group.fields" :key="`${preset.id}/${field.nodeId}/${field.fieldName}`" :field="field" advanced :upload-disabled="uploadDisabled" @edit="(value, action) => edit(field, value, action)" @reset="reset(field)" @upload="emit('upload', field, $event)" @configure="configure(field, $event)" />
          </div>
        </details>
      </div>
    </template>
    <p v-if="error" class="wp-warning" role="alert">{{ error }}</p>
    <ConfirmDialog v-model:open="confirmReset" title="恢复工作流参数" confirm-text="恢复" @confirm="reset()">恢复此工作流导入时的参数值？节点连接、API Key、配图预设和漫画版式不会改变。</ConfirmDialog>
  </section>
</template>

<style scoped>
.wp-editor { min-width: 0; border-top: 1px solid var(--bbi-line); padding-top: 14px; }
.wp-header, .wp-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
h4 { margin: 0; font-size: 14px; }
h5 { margin: 8px 0 0; color: var(--bbi-ink-soft); font-size: 12px; font-weight: 400; }
.wp-count { font-size: 12px; color: var(--bbi-ink-soft); overflow-wrap: anywhere; }
.wp-common { padding: 4px 0 8px; }
.wp-common > :not(:first-child) { border-top: 1px solid var(--bbi-line); }
.wp-sources { margin: 4px 0 12px; display: grid; gap: 8px; font-size: 12px; }
.wp-sources > div { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px 12px; }
.wp-sources dt { color: var(--bbi-ink); }
.wp-sources dd { margin: 0; color: var(--bbi-ink-soft); }
.wp-disclosure { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 42px; padding: 8px 0; border: 0; border-top: 1px solid var(--bbi-line); color: var(--bbi-ink); background: transparent; cursor: pointer; font: inherit; font-size: 13px; text-align: left; }
.wp-disclosure:focus-visible { outline: 2px solid var(--bbi-accent); }
.wp-open { transform: rotate(180deg); }
.wp-advanced { display: grid; gap: 8px; min-width: 0; padding-top: 8px; }
.wp-search { position: relative; flex: 1; min-width: 140px; }
.wp-search > .bbi-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--bbi-ink-soft); pointer-events: none; }
.wp-search .bbi-input { padding-left: 32px; width: 100%; box-sizing: border-box; }
.wp-node { border-top: 1px solid var(--bbi-line); min-width: 0; }
.wp-node summary { cursor: pointer; padding: 12px 0; font-size: 13px; color: var(--bbi-ink); overflow-wrap: anywhere; }
.wp-node summary small { display: block; margin-top: 4px; margin-left: 16px; color: var(--bbi-ink-soft); font-size: 11px; }
.wp-node-fields { padding: 0 0 6px 12px; }
.wp-node-fields > :not(:first-child) { border-top: 1px solid var(--bbi-line); }
.wp-warning { font-size: 13px; color: var(--bbi-danger); overflow-wrap: anywhere; }
.wp-toolbar .bbi-icon-btn { width: 34px; height: 34px; flex: 0 0 34px; }
</style>
