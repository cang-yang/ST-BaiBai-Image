<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import Icon from '@/components/Icon.vue';
import BbiSelect from '@/components/BbiSelect.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import { activeRunningHubPreset, ORIENTATION_LOCKS, settings } from '@/state/settings';
import { newRunningHubPreset, newRunningHubKey, configuredRunningHubKeys, enabledRunningHubKeys, selectedRunningHubKey, RUNNINGHUB_SITES, type RunningHubKey } from '@/backends/runninghubConfig';
import {
  exportRunningHubWorkflow, importRunningHubWorkflow, outputNodeOptions, runningHubFields,
  setRunningHubField, validateRunningHubWorkflow, workflowIdFromText, runningHubMangaSettings, prepareRunningHubPrompt, type WorkflowField,
} from '@/backends/runninghubWorkflow';
import {
  generateRunningHubImage, recoverRunningHubImage, runningHubTasks, testRunningHubConnection, uploadRunningHubImage,
  type RunningHubOutput, type RunningHubPhase,
} from '@/backends/runninghub';
import { parseSize } from '@/backends/size';
import { randomSeed } from '@/backends/comfyui';
import { saveExternalImage } from '@/floor/storage';
import { getContext } from '@/st/context';
import type { GenerationMeta } from '@/generationMeta';
import { presetWithMangaRules, snapshotPreset, MAX_LIBRARY_BYTES } from '@/presets/model';
import { builtinImagePreset } from '@/presets/catalog';

const active = computed(() => activeRunningHubPreset());
const config = computed(() => settings.runninghub);
const inUse = computed(() => settings.defaultBackend === 'runninghub');
const activeId = computed({
  get: () => active.value.id,
  set: (id: string) => { config.value.activeWorkflowId = id; },
});
const presets = computed(() => config.value.workflows.map(w => ({ value: w.id, label: w.name || '未命名工作流' })));
const invalid = computed(() => validateRunningHubWorkflow(active.value));
const fields = computed(() => {
  try { return runningHubFields(active.value.workflow); } catch { return []; }
});
const fieldError = computed(() => {
  if (!active.value.workflow.trim()) return '尚未导入工作流';
  try {
    return runningHubFields(active.value.workflow).length ? '' : '此工作流没有可编辑的标量输入参数';
  } catch (e) { return message(e); }
});
const nodesOpen = ref(false);
if (!config.value.apiKeys.length) {
  config.value.apiKeys = configuredRunningHubKeys(config.value).map(key => ({ ...key, id: newRunningHubKey().id }));
  if (!config.value.apiKeys.length) config.value.apiKeys.push(newRunningHubKey('Key 1'));
  config.value.activeKeyId = config.value.apiKeys[0].id;
}
config.value.apiKey = '';
const hasKeys = computed(() => enabledRunningHubKeys(config.value).length > 0);
const selectedKey = computed(() => selectedRunningHubKey(config.value));
const keyOptions = computed(() => config.value.apiKeys.map(key => ({ value: key.id, label: key.name || '未命名 Key' })));
const keyStatus = ref<Record<string, string>>({});
const outputOptions = computed(() => [{ value: '', label: '第一张图片' }, ...outputNodeOptions(active.value.workflow)]);
const sites = [...RUNNINGHUB_SITES];
const removeOpen = ref(false);
const mangaOpen = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const paste = ref('');
const error = ref('');
const testing = ref(false);
const uploading = ref(false);
const showKey = ref(false);
const prompt = ref('');
const negative = ref('');
const nl = ref('');
const seed = ref(-1);
const orientation = ref<'portrait' | 'landscape'>('portrait');
const busy = ref(false);
const saving = ref(false);
const preview = ref<RunningHubOutput | null>(null);
const previewPrompt = ref('');
const previewSeed = ref(0);
const previewMeta = ref<GenerationMeta>();
const previewSaved = ref(false);
const recoverId = ref('');
const phase = ref<RunningHubPhase>('waiting');
let controller: AbortController | undefined;
let testController: AbortController | undefined;
let uploadController: AbortController | undefined;
const phaseLabels: Record<RunningHubPhase, string> = {
  waiting: '本地排队', submitting: '提交中', queued: '云端排队', running: '生成中',
  downloading: '下载中', success: '已完成', failed: '失败', cancelled: '已取消',
};
const placeholders = ['', '%prompt%', '%prompt%\n%nl%', '%negative_prompt%', '%seed%', '%width%', '%height%', '%nl%'];
const message = (e: unknown) => e instanceof Error ? e.message : String(e);

function add() {
  const p = newRunningHubPreset(`工作流 ${config.value.workflows.length + 1}`);
  config.value.workflows.push(p);
  activeId.value = p.id;
}
function duplicate() {
  const p = { ...active.value, id: newRunningHubPreset().id, name: `${active.value.name} 副本` };
  config.value.workflows.push(p);
  activeId.value = p.id;
}
function remove() {
  removeOpen.value = false;
  if (config.value.workflows.length < 2) return;
  const index = config.value.workflows.findIndex(p => p.id === activeId.value);
  config.value.workflows.splice(index, 1);
  activeId.value = config.value.workflows[Math.min(index, config.value.workflows.length - 1)].id;
}
function importText(text: string, name?: string) {
  try {
    const p = importRunningHubWorkflow(text, name);
    // Keep the first unconfigured slot tidy, without overwriting a user's preset.
    if (config.value.workflows.length === 1 && !active.value.workflow && !active.value.workflowId) {
      config.value.workflows.splice(0, 1, p);
    } else config.value.workflows.push(p);
    activeId.value = p.id;
    error.value = '';
    paste.value = '';
    if (p.manga) mangaOpen.value = true;
  } catch (e) { error.value = message(e); }
}
function applyManga() {
  try {
    const manga = runningHubMangaSettings(active.value, settings.manga);
    const bundle = active.value.mangaBundle;
    if (bundle) {
      const preset = presetWithMangaRules(snapshotPreset(settings.imagePresets) ?? builtinImagePreset(), active.value.name, bundle);
      if (new Blob([JSON.stringify([...settings.imagePresets.presets, preset])]).size > MAX_LIBRARY_BYTES) throw new Error('预设库总大小不能超过 10 MB');
      settings.imagePresets.presets.push(preset);
      settings.imagePresets.activeId = preset.id;
      toastr.success(`已使用配图预设「${preset.name}」`, '柏宝绘');
    }
    // These fields are legacy backups only; new text belongs to the named preset above.
    settings.manga = { ...manga, spec: settings.manga.spec, thinking: settings.manga.thinking };
    active.value.manga = true;
    active.value.naturalLanguage = false;
    error.value = '';
    mangaOpen.value = false;
  } catch (e) { error.value = message(e); mangaOpen.value = false; }
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  try {
    if (file) {
      if (file.size > 5 * 1024 * 1024) throw new Error('工作流文件超过 5 MB');
      importText(await file.text(), file.name.replace(/\.json$/i, ''));
    }
  } catch (e) { error.value = message(e); }
  input.value = '';
}
function exportFile() {
  try {
    const url = URL.createObjectURL(new Blob([exportRunningHubWorkflow(active.value)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${active.value.name.replace(/[\\/:*?"<>|]/g, '_') || 'runninghub'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { error.value = message(e); }
}
function editField(field: WorkflowField, event: Event) {
  const input = event.target as HTMLInputElement;
  const value = typeof field.value === 'boolean' ? input.checked
    : typeof field.value === 'number' ? Number(input.value) : input.value;
  if (typeof value === 'number' && !Number.isFinite(value)) return;
  active.value.workflow = setRunningHubField(active.value.workflow, field.nodeId, field.fieldName, value);
}
function bind(field: WorkflowField, event: Event) {
  const input = event.target as HTMLSelectElement;
  if (input.value) active.value.workflow = setRunningHubField(active.value.workflow, field.nodeId, field.fieldName, input.value);
  input.value = '';
}
function addKey() {
  const key = newRunningHubKey(`Key ${config.value.apiKeys.length + 1}`);
  config.value.apiKeys.push(key);
  config.value.activeKeyId = key.id;
}
function removeKey(id: string) {
  config.value.apiKeys = config.value.apiKeys.filter(key => key.id !== id);
  if (!config.value.apiKeys.length) config.value.apiKeys.push(newRunningHubKey('Key 1'));
  if (config.value.activeKeyId === id) config.value.activeKeyId = config.value.apiKeys[0].id;
}
async function testConnection(key?: RunningHubKey) {
  if (testing.value) return;
  testing.value = true;
  testController = new AbortController();
  const targets = key ? [{ ...key }] : config.value.apiKeys.filter(item => item.key.trim()).map(item => ({ ...item }));
  try {
    for (const target of targets) {
      keyStatus.value[target.id] = '连接中…';
      try {
        keyStatus.value[target.id] = await testRunningHubConnection({
          ...config.value, apiKeys: [target], activeKeyId: target.id,
        }, testController.signal);
      } catch (e) { keyStatus.value[target.id] = message(e); }
      if (testController.signal.aborted) break;
    }
  }
  finally { testing.value = false; }
}
async function uploadReference(field: WorkflowField, event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || uploading.value) return;
  uploading.value = true;
  uploadController = new AbortController();
  const target = active.value;
  const account = selectedKey.value;
  try {
    const filename = await uploadRunningHubImage({ ...config.value }, file, uploadController.signal);
    target.workflow = setRunningHubField(target.workflow, field.nodeId, field.fieldName, filename);
    target.keyId = account?.id;
    error.value = '';
  } catch (e) { error.value = message(e); }
  finally { uploading.value = false; input.value = ''; }
}
function setPreview(output: RunningHubOutput) {
  preview.value?.result.revoke();
  preview.value = output;
  previewSaved.value = false;
}
async function run(recover = false) {
  if (busy.value || saving.value) return;
  busy.value = true;
  error.value = '';
  phase.value = 'waiting';
  controller = new AbortController();
  const p = { ...active.value };
  const text = prompt.value.trim();
  const usedSeed = seed.value >= 0 ? Math.floor(seed.value) : randomSeed();
  try {
    if (!Number.isSafeInteger(usedSeed)) throw new Error('种子必须为安全范围内的整数');
    if (recover) {
      setPreview(await recoverRunningHubImage({ ...config.value }, recoverId.value.trim(), p.outputNodeId, controller.signal));
    } else {
      const size = p.orientationLock === 'auto' ? orientation.value : p.orientationLock;
      const px = parseSize(size === 'portrait' ? p.portraitSize : p.landscapeSize);
      const compiled = prepareRunningHubPrompt(text, p, settings.manga, px);
      setPreview(await generateRunningHubImage({ ...config.value }, p, {
        prompt: compiled, nl: compiled !== text ? '' : nl.value, negative_prompt: negative.value, seed: usedSeed, width: px?.width, height: px?.height,
      }, controller.signal, { onPhase: value => { phase.value = value; }, onTask: id => { recoverId.value = id; } }));
    }
    previewPrompt.value = recover ? `RunningHub task ${recoverId.value.trim()}` : text;
    previewSeed.value = recover ? 0 : usedSeed;
    const output = preview.value!;
    previewMeta.value = {
      backend: 'runninghub', model: recover ? '恢复已有任务' : p.name,
      width: 0, height: 0, positive: '', negative: '', artist: null, vibes: [],
      params: { mode: 'cloud', taskId: output.taskId, workflowId: recover ? undefined : workflowIdFromText(p.workflowId),
        coins: output.coins, seconds: output.seconds },
    };
  } catch (e) { error.value = message(e); }
  finally { busy.value = false; }
}
async function savePreview() {
  if (!preview.value || saving.value) return;
  saving.value = true;
  try {
    await saveExternalImage(getContext()?.name2 ?? 'RunningHub', previewPrompt.value, previewSeed.value, preview.value.result, previewMeta.value);
    previewSaved.value = true;
  } catch (e) { error.value = message(e); }
  finally { saving.value = false; }
}
onBeforeUnmount(() => {
  controller?.abort();
  testController?.abort();
  uploadController?.abort();
  preview.value?.result.revoke();
});
</script>

<template>
  <div class="rh-panel">
    <header class="rh-bar">
      <h3 class="bbi-title bbi-title-sub">RunningHub</h3>
      <button class="bbi-btn" :class="{ 'bbi-btn-primary': !inUse }" :disabled="inUse" @click="settings.defaultBackend = 'runninghub'">
        <Icon :name="inUse ? 'check' : 'backend'" />{{ inUse ? '当前出图渠道' : '使用此渠道出图' }}
      </button>
    </header>
    <section class="rh-section">
      <h4>连接</h4>
      <div class="rh-field"><span>站点</span><BbiSelect v-model="config.url" :options="sites" aria-label="RunningHub 站点" /></div>
      <div class="rh-bar">
        <h4>API Keys</h4>
        <div class="rh-tools">
          <button class="bbi-icon-btn" type="button" title="添加 Key" aria-label="添加 Key" @click="addKey"><Icon name="plus" /></button>
          <button class="bbi-icon-btn" type="button" title="显示或隐藏密钥" aria-label="显示或隐藏密钥" @click="showKey = !showKey"><Icon name="eye" /></button>
        </div>
      </div>
      <div v-for="key in config.apiKeys" :key="key.id" class="rh-key">
        <div class="rh-bar">
          <input v-model="key.name" class="bbi-input rh-key-name" aria-label="Key 名称" />
          <label class="rh-key-enable"><input v-model="key.enabled" type="checkbox" class="bbi-checkbox" :aria-label="`启用 ${key.name}`" />启用</label>
          <button class="bbi-icon-btn" type="button" :title="`删除 ${key.name}`" :aria-label="`删除 ${key.name}`" @click="removeKey(key.id)"><Icon name="trash" /></button>
        </div>
        <input v-model="key.key" :type="showKey ? 'text' : 'password'" class="bbi-input" autocomplete="off" spellcheck="false" :aria-label="`RunningHub API Key ${key.name}`" />
        <div class="rh-bar">
          <label class="rh-key-limit">并发上限<input v-model.number="key.concurrency" type="number" min="1" max="5" class="bbi-input" :aria-label="`${key.name} 并发上限`" /></label>
          <button class="bbi-btn" :disabled="testing || !key.key.trim()" @click="testConnection(key)"><Icon name="backend" />测试连接</button>
        </div>
        <span v-if="keyStatus[key.id]" role="status">{{ keyStatus[key.id] }}</span>
      </div>
      <div class="rh-bar"><button class="bbi-btn" :disabled="testing || !config.apiKeys.some(key => key.key.trim())" @click="testConnection()"><Icon name="backend" />{{ testing ? '连接中…' : '测试全部 Key' }}</button><span>可用 Key：{{ enabledRunningHubKeys(config).length }}</span></div>
      <div class="rh-field"><span>上传 / 恢复任务 Key</span><BbiSelect v-model="config.activeKeyId" :options="keyOptions" aria-label="上传与恢复任务 Key" /></div>
    </section>
    <section class="rh-section">
      <div class="rh-bar">
        <h4>工作流</h4>
        <div class="rh-tools">
          <button class="bbi-icon-btn" title="新建工作流" aria-label="新建工作流" @click="add"><Icon name="plus" /></button>
          <button class="bbi-icon-btn" title="复制工作流" aria-label="复制工作流" @click="duplicate"><Icon name="copy" /></button>
          <button class="bbi-icon-btn" title="导入工作流 JSON" aria-label="导入工作流 JSON" @click="fileInput?.click()"><Icon name="upload" /></button>
          <button class="bbi-icon-btn" title="导出工作流（不含 Key）" aria-label="导出工作流" :disabled="!active.workflow.trim()" @click="exportFile"><Icon name="download" /></button>
          <button class="bbi-icon-btn" title="删除工作流" aria-label="删除工作流" :disabled="config.workflows.length < 2" @click="removeOpen = true"><Icon name="trash" /></button>
          <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="importFile" />
        </div>
      </div>
      <BbiSelect v-model="activeId" :options="presets" aria-label="当前 RunningHub 工作流" />
      <label class="rh-field"><span>名称</span><input v-model="active.name" class="bbi-input" /></label>
      <label class="rh-field"><span>工作流 ID / 链接</span><input v-model="active.workflowId" class="bbi-input" spellcheck="false" @blur="active.workflowId = workflowIdFromText(active.workflowId) || active.workflowId" /></label>
      <div class="rh-field"><span>生成 Key</span><BbiSelect :model-value="active.keyId || ''" :options="[{ value: '', label: '自动分配（所有已启用 Key）' }, ...keyOptions]" aria-label="工作流生成 Key" @update:model-value="active.keyId = $event" /></div>
      <div class="rh-sizes">
        <label>竖屏尺寸<input v-model="active.portraitSize" class="bbi-input" placeholder="768x1024" /></label>
        <label>横屏尺寸<input v-model="active.landscapeSize" class="bbi-input" placeholder="1024x768" /></label>
      </div>
      <div class="rh-field"><span>画幅方向</span><BbiSelect v-model="active.orientationLock" :options="ORIENTATION_LOCKS" aria-label="画幅方向" /></div>
      <div class="rh-bar"><button class="bbi-btn" @click="mangaOpen = true"><Icon name="check" />应用漫画配置</button><span v-if="settings.manga.enabled">漫画模式已启用</span></div>
      <label v-if="active.manga">漫画固定正面词<textarea v-model="active.mangaPositive" class="bbi-input" rows="3" aria-label="漫画固定正面词"></textarea></label>
      <label class="bbi-switch-row"><span>生成自然语言</span><input v-model="active.naturalLanguage" type="checkbox" class="bbi-checkbox" /></label>
      <div class="rh-field"><span>输出节点</span><BbiSelect v-model="active.outputNodeId" :options="outputOptions" aria-label="输出图片节点" /></div>
      <p v-if="invalid" class="rh-warning" role="status">{{ invalid }}</p>
      <p v-else class="rh-ok" role="status">配置就绪 · {{ fields.length }} 个节点参数</p>
      <details><summary>粘贴导入</summary>
        <textarea v-model="paste" class="bbi-input rh-code" rows="5" aria-label="待导入的工作流 JSON" spellcheck="false"></textarea>
        <button class="bbi-btn" :disabled="!paste.trim()" @click="importText(paste)"><Icon name="upload" />导入为新工作流</button>
      </details>
      <div class="rh-node-editor">
        <button class="rh-disclosure" type="button" :aria-expanded="nodesOpen" aria-controls="rh-node-fields" @click.stop="nodesOpen = !nodesOpen"><span>节点参数 · {{ fields.length }}</span><Icon name="chevron" :class="{ 'rh-open': nodesOpen }" /></button>
        <div v-if="nodesOpen" id="rh-node-fields">
        <p v-if="fieldError" class="rh-warning" role="status">{{ fieldError }}</p>
        <div v-for="field in fields" :key="`${active.id}/${field.nodeId}/${field.fieldName}`" class="rh-node">
          <label :for="`rh-${field.nodeId}-${field.fieldName}`">{{ field.nodeId }} · {{ field.title }} · {{ field.fieldName }}</label>
          <div class="rh-node-controls">
            <input v-if="typeof field.value === 'boolean'" :id="`rh-${field.nodeId}-${field.fieldName}`" type="checkbox" class="bbi-checkbox" :checked="field.value" @change="editField(field, $event)" />
            <input v-else-if="typeof field.value === 'number'" :id="`rh-${field.nodeId}-${field.fieldName}`" type="number" step="any" class="bbi-input" :value="field.value" @change="editField(field, $event)" />
            <textarea v-else :id="`rh-${field.nodeId}-${field.fieldName}`" class="bbi-input" rows="2" :value="field.value" @change="editField(field, $event)"></textarea>
            <select class="bbi-input rh-bind" :aria-label="`${field.nodeId}.${field.fieldName} 参数绑定`" @change="bind(field, $event)">
              <option v-for="p in placeholders" :key="p" :value="p">{{ p || '改为动态参数…' }}</option>
            </select>
          </div>
          <label v-if="field.fieldName === 'image'" class="rh-reference">
            <span>{{ uploading ? '上传中…' : '上传参考图' }}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" :disabled="uploading || !selectedKey?.key" :aria-label="`${field.nodeId} 上传参考图`" @change="uploadReference(field, $event)" />
          </label>
        </div>
        </div>
      </div>
      <details><summary>工作流 JSON</summary><textarea v-model="active.workflow" class="bbi-input rh-code" rows="12" spellcheck="false" aria-label="RunningHub 工作流 JSON"></textarea></details>
    </section>
    <section class="rh-section">
      <details><summary>执行设置</summary>
        <label class="rh-field"><span>等待超时（分钟）</span><input v-model.number="config.timeoutMinutes" type="number" min="1" max="60" class="bbi-input" /></label>
        <label class="rh-field"><span>实例</span><select v-model="config.instanceType" class="bbi-input"><option value="default">默认</option><option value="plus">Plus（额外计费）</option></select></label>
        <label class="rh-field"><span>保留实例（秒，0 关闭）</span><input v-model.number="config.retainSeconds" type="number" min="0" max="180" class="bbi-input" /></label>
        <p v-if="config.retainSeconds" class="rh-warning">仅支持企业共享 Key，10–180 秒，保留期间额外计费。</p>
      </details>
    </section>
    <section class="rh-section">
      <h4>试生成</h4>
      <label>正面提示词<textarea v-model="prompt" class="bbi-input" rows="3" aria-label="试生成正面提示词"></textarea></label>
      <label v-if="active.naturalLanguage">自然语言描述<textarea v-model="nl" class="bbi-input" rows="2" aria-label="试生成自然语言描述"></textarea></label>
      <label>动态负面词<textarea v-model="negative" class="bbi-input" rows="2" aria-label="试生成动态负面词"></textarea></label>
      <div class="rh-sizes">
        <label>画幅<select v-model="orientation" class="bbi-input"><option value="portrait">竖屏</option><option value="landscape">横屏</option></select></label>
        <label>种子（-1 随机）<input v-model.number="seed" type="number" min="-1" class="bbi-input" /></label>
      </div>
      <div class="rh-bar">
        <button class="bbi-btn bbi-btn-primary" :disabled="busy || saving || !!invalid || !hasKeys || !prompt.trim()" @click="run()"><Icon name="generate" />生成一张（计费）</button>
        <button v-if="busy" class="bbi-btn" @click="controller?.abort()"><Icon name="close" />取消</button>
        <span v-if="busy" role="status">{{ phaseLabels[phase] }}</span>
      </div>
      <details><summary>恢复已有任务</summary>
        <label class="rh-field"><span>任务 ID</span><input v-model="recoverId" class="bbi-input" /></label>
        <button class="bbi-btn" :disabled="busy || saving || !recoverId.trim() || !selectedKey?.key" @click="run(true)"><Icon name="refresh" />获取结果（不重新生图）</button>
      </details>
      <p v-if="error" class="rh-warning" role="alert">{{ error }}</p>
      <figure v-if="preview" class="rh-preview">
        <img :src="preview.result.url" alt="RunningHub 生成结果" />
        <figcaption class="rh-bar">
          <span>{{ preview.coins === undefined ? '' : `${preview.coins} RH` }} {{ preview.seconds === undefined ? '' : `· ${preview.seconds} 秒` }}</span>
          <button class="bbi-btn" :disabled="busy || saving || previewSaved" @click="savePreview"><Icon name="gallery" />{{ previewSaved ? '已保存' : saving ? '保存中…' : '保存到图库' }}</button>
          <a class="bbi-icon-btn" :href="preview.result.url" :download="preview.result.filename" title="下载图片" aria-label="下载图片"><Icon name="download" /></a>
        </figcaption>
      </figure>
    </section>
    <section v-if="runningHubTasks.length" class="rh-section">
      <h4>本次会话任务</h4>
      <article v-for="task in [...runningHubTasks].reverse()" :key="task.localId" class="rh-task">
        <div class="rh-bar"><strong>{{ task.name }}</strong><span>{{ phaseLabels[task.phase] }} {{ task.coins === undefined ? '' : `· ${task.coins} RH` }}</span></div>
        <code v-if="task.taskId">{{ task.taskId }}</code>
        <span v-if="task.keyName"> · {{ task.keyName }}</span>
        <p v-if="task.error" class="rh-warning">{{ task.error }}</p>
      </article>
    </section>
    <ConfirmDialog v-model:open="removeOpen" title="删除工作流" confirm-text="删除" tone="danger" @confirm="remove">删除“{{ active.name }}”？云端工作流不会被删除。</ConfirmDialog>
    <ConfirmDialog v-model:open="mangaOpen" title="应用漫画配置" confirm-text="应用" @confirm="applyManga">启用漫画模式，并将漫画版式缩放到 {{ active.portraitSize }} / {{ active.landscapeSize }}？<template v-if="active.mangaBundle">漫画规范与检查指导将保存为新配图预设并立即使用，原预设保留；附带的版式说明及同 ID 版式会更新。</template>其他自定义版式和启停状态保留；版式设置也会影响其他漫画工作流。</ConfirmDialog>
  </div>
</template>

<style scoped>
.rh-panel { display: grid; gap: 16px; min-width: 0; }
.rh-bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; min-width: 0; }
.rh-section { display: grid; gap: 12px; border-top: 1px solid var(--bbi-line); padding-top: 16px; min-width: 0; }
h3, h4, p, figure { margin: 0; }
h4 { font-size: 14px; }
.rh-field { display: grid; grid-template-columns: minmax(110px, 0.7fr) minmax(0, 1.7fr); align-items: center; gap: 12px; }
.rh-tools, .rh-inline { display: flex; align-items: center; gap: 6px; min-width: 0; }
.rh-inline input { flex: 1; min-width: 0; }
.bbi-icon-btn { width: 36px; height: 36px; flex: 0 0 36px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: var(--bbi-radius-sm); background: var(--bbi-surface-2); color: var(--bbi-ink-soft); cursor: pointer; }
.bbi-icon-btn:hover { color: var(--bbi-ink); background: var(--bbi-line-strong); }
.bbi-icon-btn:disabled { opacity: 0.45; cursor: default; }
.bbi-icon-btn:focus-visible { outline: 2px solid var(--bbi-accent); outline-offset: 2px; }
.rh-tools .bbi-icon-btn { width: 32px; height: 32px; flex: 0 0 32px; }
.rh-sizes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
label:not(.bbi-switch-row) { display: grid; gap: 6px; min-width: 0; }
.rh-panel :deep(.bbi-select-box) { width: 100%; min-width: 0; }
.rh-panel :deep(.bbi-select-label) { white-space: normal; overflow-wrap: anywhere; text-align: left; }
.bbi-input { width: 100%; min-width: 0; box-sizing: border-box; }
textarea { resize: vertical; }
.rh-code { font-family: monospace; font-size: 12px; }
details { min-width: 0; }
summary { cursor: pointer; padding: 8px 0; font-weight: 600; }
details[open] > :not(summary) { margin-top: 10px; }
.rh-node { display: grid; gap: 6px; border-top: 1px solid var(--bbi-line); padding-top: 10px; }
.rh-node > label { overflow-wrap: anywhere; font-size: 12px; }
.rh-node-controls { display: grid; grid-template-columns: minmax(0, 1fr) 155px; align-items: start; gap: 8px; }
.rh-bind { font-family: monospace; font-size: 12px; }
.rh-warning { color: var(--bbi-danger, #b44b31); overflow-wrap: anywhere; font-size: 13px; }
.rh-ok { color: var(--bbi-accent, #27845d); font-size: 13px; }
.rh-preview { display: grid; gap: 8px; }
.rh-preview img { max-width: 100%; width: auto; max-height: 440px; object-fit: contain; justify-self: center; }
.rh-task { border-bottom: 1px solid var(--bbi-line); padding-bottom: 10px; overflow-wrap: anywhere; }
.rh-task code { user-select: all; font-size: 12px; }
.rh-task strong { font-size: 13px; }
.rh-reference { font-size: 12px; }
.rh-reference input { max-width: 100%; }
.rh-key { display: grid; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--bbi-line); }
.rh-key-name { flex: 1; max-width: 240px; }
.rh-key-enable, .rh-key-limit { display: flex !important; align-items: center; gap: 8px; }
.rh-key-limit input { width: 70px; }
.rh-disclosure { display: flex; align-items: center; justify-content: space-between; width: 100%; border: 0; padding: 8px 0; background: transparent; color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
.rh-disclosure:focus-visible { outline: 2px solid var(--bbi-accent); }
.rh-open { transform: rotate(180deg); }
@media (max-width: 480px) {
  .rh-field { grid-template-columns: minmax(0, 1fr); gap: 6px; }
  .rh-node-controls { grid-template-columns: minmax(0, 1fr); }
}
</style>
