<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import Icon from '@/components/Icon.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import { settings } from '@/state/settings';
import { getContext, isAiStoryMessage } from '@/st/context';
import { buildAutoTagMessages, autoTagProfile } from '@/autoTag/prompt';
import { prepareTargetText } from '@/autoTag/clean';
import { parseImagePlan } from '@/autoTag/protocol';
import { readBookMemory } from '@/autoTag/bookMemory';
import { charTagsBeforeFloor, lockedCharTagNames } from '@/state/charTags';
import { resolveCharAnchors } from '@/autoTag/charAnchors';
import { requestCompletion, requestViaMainApi, type ChatMsg } from '@/api/client';
import {
  exportPreset, importPresets, newImagePreset, newPromptEntry, validatePreset, MAX_LIBRARY_BYTES,
  type ImagePromptPreset,
} from '@/presets/model';
import { PRESET_VARIABLES, type RenderedPreset } from '@/presets/render';

const config = computed(() => settings.imagePresets);
const picker = ref<HTMLInputElement>();
const selected = ref(config.value.activeId);
const preset = computed(() => config.value.presets.find(p => p.id === selected.value));
const activeName = computed(() => config.value.presets.find(p => p.id === config.value.activeId)?.name ?? '内置默认');
const draft = ref<ImagePromptPreset>();
const variables = ref<{ name: string; value: string }[]>([]);
const entryId = ref('');
const entry = computed(() => draft.value?.entries.find(e => e.id === entryId.value));
const search = ref('');
const filteredEntries = computed(() => draft.value?.entries.filter(e => `${e.name} ${e.content}`.toLowerCase().includes(search.value.toLowerCase())) ?? []);
const removeTarget = ref<ImagePromptPreset>();
const error = ref(''), notice = ref(''), testText = ref('');
const busy = ref(false), result = ref(''), preview = ref<ChatMsg[]>([]);
const checkResult = ref<RenderedPreset>();
let controller: AbortController | undefined;
onBeforeUnmount(() => controller?.abort());
watch(selected, () => { preview.value = []; checkResult.value = undefined; result.value = ''; error.value = ''; });

function fail(e: unknown): void { error.value = e instanceof Error ? e.message : String(e); }
function edit(value: ImagePromptPreset): void {
  draft.value = JSON.parse(JSON.stringify(value));
  variables.value = Object.entries(value.variables).map(([name, value]) => ({ name, value }));
  entryId.value = value.entries[0]?.id ?? '';
  search.value = ''; error.value = ''; notice.value = ''; preview.value = []; checkResult.value = undefined; result.value = '';
}
function current(): ImagePromptPreset | null {
  if (!draft.value) return preset.value ? validatePreset(JSON.parse(JSON.stringify(preset.value))) : null;
  const names = variables.value.map(v => v.name.trim());
  if (new Set(names).size !== names.length) throw new Error('变量名不能重复');
  return validatePreset({ ...draft.value, variables: Object.fromEntries(variables.value.map((v, i) => [names[i], v.value])) });
}
function save(): void {
  try {
    const value = current();
    if (!value) return;
    const next = config.value.presets.filter(p => p.id !== value.id).concat(value);
    if (new Blob([JSON.stringify(next)]).size > MAX_LIBRARY_BYTES) throw new Error('预设库总大小不能超过 10 MB');
    const index = config.value.presets.findIndex(p => p.id === value.id);
    if (index < 0) config.value.presets.push(value);
    else config.value.presets[index] = value;
    selected.value = value.id; draft.value = undefined; error.value = '';
    notice.value = config.value.activeId === value.id ? '已保存，下次配图生效' : '已保存；点击“使用此预设”后生效';
  } catch (e) { fail(e); }
}
function duplicate(): void {
  if (!preset.value) return;
  const copy = importPresets(exportPreset(preset.value))[0];
  copy.name += ' 副本'; edit(copy);
}
async function importFiles(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  error.value = ''; notice.value = '';
  try {
    const incoming: ImagePromptPreset[] = [];
    for (const file of [...input.files ?? []]) {
      if (file.size > 2_000_000) throw new Error(`${file.name} 超过 2 MB`);
      incoming.push(...importPresets(await file.text(), file.name));
    }
    if (!incoming.length) return;
    const names = new Set(config.value.presets.map(p => p.name));
    for (const item of incoming) {
      const base = item.name; let n = 2;
      while (names.has(item.name)) item.name = `${base} (${n++})`;
      names.add(item.name);
    }
    if (new Blob([JSON.stringify([...config.value.presets, ...incoming])]).size > MAX_LIBRARY_BYTES) throw new Error('预设库总大小不能超过 10 MB');
    config.value.presets.push(...incoming);
    selected.value = incoming[0].id;
    notice.value = `已导入 ${incoming.length} 份，尚未启用`;
  } catch (e) { fail(e); }
  finally { input.value = ''; }
}
function download(): void {
  if (!preset.value) return;
  try {
    const url = URL.createObjectURL(new Blob([exportPreset(preset.value)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `${preset.value.name.replace(/[<>:"/\\|?*]/g, '_')}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { fail(e); }
}
function remove(): void {
  const id = removeTarget.value?.id;
  config.value.presets = config.value.presets.filter(p => p.id !== id);
  if (config.value.activeId === id) config.value.activeId = '';
  selected.value = config.value.activeId; removeTarget.value = undefined;
}
function addEntry(): void {
  const added = newPromptEntry(); draft.value?.entries.push(added); entryId.value = added.id; search.value = '';
}
function move(offset: number): void {
  if (!draft.value || !entry.value) return;
  const entries = draft.value.entries;
  const index = entries.indexOf(entry.value), next = index + offset;
  if (next < 0 || next >= entries.length) return;
  [entries[index], entries[next]] = [entries[next], entries[index]];
}
function removeEntry(): void {
  if (!draft.value) return;
  draft.value.entries = draft.value.entries.filter(e => e.id !== entryId.value);
  entryId.value = draft.value.entries[0]?.id ?? '';
}
async function inspect(send: boolean): Promise<void> {
  busy.value = true; error.value = ''; result.value = ''; preview.value = []; checkResult.value = undefined;
  controller = new AbortController();
  try {
    const chosen = current();
    const host = getContext();
    if (!host) throw new Error('酒馆上下文未就绪');
    const context = { ...host, chat: host.chat.map(m => ({ ...m })), chatMetadata: JSON.parse(JSON.stringify(host.chatMetadata ?? {})) };
    let floor = context.chat.findLastIndex(isAiStoryMessage);
    if (testText.value.trim()) {
      context.chat = [{ mes: testText.value, name: context.name2, is_user: false, is_system: false }]; floor = 0;
    }
    if (floor < 0) throw new Error('请先填写测试正文，或打开已有回复的聊天');
    const prepared = prepareTargetText(context.chat[floor].mes, settings.excludes.customStripTags);
    const options = JSON.parse(JSON.stringify(settings.autoTag));
    const profile = autoTagProfile();
    const assigned = settings.channels.find(c => c.id === settings.assignments.tagGen);
    const channel = assigned ? JSON.parse(JSON.stringify(assigned)) as typeof assigned : null;
    const direct = !!channel && config.value.directChannels.includes(channel.id);
    if (send && chosen?.output === 'tool' && !channel) throw new Error('工具输出需要先指派独立副 API 渠道');
    if (send && options.dshSession) throw new Error('预设测试暂不使用 DSH 会话，请先关闭 DSH');
    const memory = testText.value.trim() ? null : readBookMemory(floor, context.chat[floor].mes, context.name1);
    const library = testText.value.trim() ? undefined : resolveCharAnchors(charTagsBeforeFloor(floor), lockedCharTagNames()).text;
    const messages = await buildAutoTagMessages(context, floor, options, memory, prepared, library, '', profile, chosen, true, value => { checkResult.value = value; });
    controller.signal.throwIfAborted();
    preview.value = messages;
    if (!send) return;
    let lastUpdate = 0;
    const opts = {
      signal: controller.signal, source: `预设测试：${chosen?.name ?? '内置默认'}`,
      imagePlanTool: chosen?.output === 'tool', direct,
      onDelta: (text: string) => { if (Date.now() - lastUpdate > 120) { result.value = text; lastUpdate = Date.now(); } },
      validate: (text: string) => { parseImagePlan(text, prepared.segments, options.minImages, options.maxImages); },
    };
    result.value = channel ? await requestCompletion(channel, messages, opts) : await requestViaMainApi(messages, opts);
    notice.value = '测试通过：已取得有效配图计划，未生成图片、未修改正文';
  } catch (e) {
    if (controller.signal.aborted) error.value = '测试已取消';
    else fail(e);
  } finally { busy.value = false; controller = undefined; }
}
</script>

<template>
  <section class="ip-section" aria-label="正文配图预设">
    <div class="ip-toolbar"><span>当前使用 <strong>{{ activeName }}</strong></span><span class="ip-muted">仅用于图片提示词</span></div>
    <div class="ip-toolbar">
      <select v-model="selected" class="bbi-input ip-select" aria-label="选择配图预设" :disabled="!!draft || busy">
        <option value="">内置默认</option><option v-for="item in config.presets" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
      <button class="bbi-btn bbi-btn-primary bbi-btn-sm" :disabled="!!draft || busy || selected === config.activeId" @click="config.activeId = selected; notice = '已切换，下次配图生效'"><Icon name="check" />使用此预设</button>
    </div>
    <div class="ip-toolbar ip-actions">
      <button class="bbi-btn bbi-btn-sm" :disabled="!!draft || busy" @click="edit(newImagePreset())"><Icon name="plus" />新建</button>
      <button class="bbi-btn bbi-btn-sm" :disabled="!!draft || busy" @click="picker?.click()"><Icon name="download" />导入</button>
      <input ref="picker" type="file" hidden multiple accept=".json,application/json" @change="importFiles" />
      <template v-if="preset">
        <button class="bbi-btn bbi-btn-sm" :disabled="!!draft || busy" title="编辑预设" @click="edit(preset)"><Icon name="edit" />编辑</button>
        <details class="ip-manage">
          <summary class="bbi-btn bbi-btn-sm" title="预设管理" aria-label="预设管理"><Icon name="more" /></summary>
          <div class="ip-menu">
            <button class="bbi-btn bbi-btn-sm" :disabled="!!draft || busy" title="复制为新预设" @click="duplicate"><Icon name="copy" />复制</button>
            <button class="bbi-btn bbi-btn-sm" :disabled="!!draft || busy" title="导出预设" @click="download"><Icon name="upload" />导出</button>
            <button class="bbi-btn bbi-btn-sm" :disabled="!!draft || busy" title="删除预设" @click="removeTarget = preset"><Icon name="trash" />删除</button>
          </div>
        </details>
      </template>
    </div>
    <p v-if="error" class="ip-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="ip-status" role="status">{{ notice }}</p>
    <p v-if="preset?.description && !draft" class="ip-muted">{{ preset.description }}</p>
    <details v-if="(draft ?? preset)?.warnings.length" class="ip-warning" open>
      <summary>导入兼容性提醒</summary><ul><li v-for="warning in (draft ?? preset)?.warnings" :key="warning">{{ warning }}</li></ul>
    </details>
    <fieldset v-if="draft" class="ip-editor" :disabled="busy">
      <label>预设名称<input v-model="draft.name" class="bbi-input" aria-label="预设名称" /></label>
      <label>备注<input v-model="draft.description" class="bbi-input" aria-label="预设备注" /></label>
      <div class="ip-toolbar"><strong>提示词条目 · {{ draft.entries.filter(e => e.enabled).length }} / {{ draft.entries.length }} 已开启</strong><button class="bbi-btn bbi-btn-sm" @click="addEntry"><Icon name="plus" />添加条目</button></div>
      <input v-model="search" class="bbi-input" type="search" placeholder="搜索条目" aria-label="搜索预设条目" />
      <select v-model="entryId" class="bbi-input" aria-label="选择预设条目">
        <option v-for="item in filteredEntries" :key="item.id" :value="item.id">{{ item.enabled ? '' : '[停用] ' }}{{ item.name }}</option>
      </select>
      <div v-if="entry" class="ip-entry">
        <div class="ip-toolbar">
          <label class="ip-check"><input v-model="entry.enabled" type="checkbox" />启用此条目</label>
          <div class="ip-actions">
            <button class="bbi-btn bbi-btn-sm" :disabled="draft.entries.indexOf(entry) === 0" title="向前移动" @click="move(-1)"><Icon name="navigate" class="ip-up" /></button>
            <button class="bbi-btn bbi-btn-sm" :disabled="draft.entries.indexOf(entry) === draft.entries.length - 1" title="向后移动" @click="move(1)"><Icon name="navigate" class="ip-down" /></button>
            <button class="bbi-btn bbi-btn-sm" title="删除条目（保存后生效）" @click="removeEntry"><Icon name="trash" /></button>
          </div>
        </div>
        <label>条目名称<input v-model="entry.name" class="bbi-input" aria-label="预设条目名称" /></label>
        <label>提示词<textarea v-model="entry.content" class="bbi-input ip-text" rows="8" aria-label="预设条目提示词" spellcheck="false" /></label>
        <details><summary>条目条件与消息角色</summary>
          <label>何时使用<select v-model="entry.trigger" class="bbi-input"><option value="always">始终使用</option><option value="keywords">正文或上下文出现关键词时</option></select></label>
          <template v-if="entry.trigger === 'keywords'">
            <label>任一关键词<input v-model="entry.keywords" class="bbi-input" placeholder="逗号分隔" /></label>
            <label>同时出现以下任一词 · 可留空<input v-model="entry.andKeywords" class="bbi-input" placeholder="逗号分隔" /></label>
          </template>
          <label>消息角色<select v-model="entry.role" class="bbi-input"><option value="system">规则（system）</option><option value="user">要求（user）</option><option value="assistant">示例回答（assistant）</option></select></label>
        </details>
      </div>
      <details>
        <summary>输出方式与变量</summary>
        <label>输出方式<select v-model="draft.output" class="bbi-input" aria-label="预设输出方式"><option value="text">普通文本 · JSON 计划</option><option value="tool">工具输出 · 需要支持工具的副 API</option></select></label>
        <label class="ip-check"><input v-model="draft.useBackendRules" type="checkbox" />附加当前后端的提示词规范</label>
        <div class="ip-muted">图片位置、数量和漫画格式：由插件统一校验</div>
        <div v-for="(variable, index) in variables" :key="index" class="ip-variable">
          <input v-model="variable.name" class="bbi-input" placeholder="变量名" :aria-label="`变量名 ${index + 1}`" />
          <textarea v-model="variable.value" class="bbi-input" rows="2" placeholder="变量内容" :aria-label="`变量值 ${index + 1}`" />
          <button class="bbi-btn bbi-btn-sm" :title="`删除变量 ${variable.name}`" @click="variables.splice(index, 1)"><Icon name="trash" /></button>
        </div>
        <button class="bbi-btn bbi-btn-sm" @click="variables.push({ name: '', value: '' })"><Icon name="plus" />添加变量</button>
        <details><summary>可用内容变量</summary><dl class="ip-variables"><template v-for="[key, label] in PRESET_VARIABLES" :key="key"><dt>{{ '{' + '{' + key + '}' + '}' }}</dt><dd>{{ label }}</dd></template></dl></details>
      </details>
      <div class="ip-toolbar ip-actions">
        <button class="bbi-btn bbi-btn-primary" @click="save"><Icon name="check" />保存预设</button>
        <button class="bbi-btn" @click="draft = undefined; error = ''">取消</button>
      </div>
    </fieldset>
    <details class="ip-test">
      <summary>检查与试运行</summary>
      <label>测试正文<textarea v-model="testText" class="bbi-input" rows="4" placeholder="留空则使用当前聊天的最后一条 AI 回复" :disabled="busy" aria-label="预设测试正文" /></label>
      <div class="ip-toolbar ip-actions">
        <button class="bbi-btn bbi-btn-sm" :disabled="busy" @click="inspect(false)"><Icon name="search" />本地检查 · 免费</button>
        <button class="bbi-btn bbi-btn-sm" :disabled="busy" @click="inspect(true)"><Icon name="plug" />测试副 API · 计费请求</button>
        <button v-if="busy" class="bbi-btn bbi-btn-sm" @click="controller?.abort()"><Icon name="close" />取消测试</button>
      </div>
      <template v-if="checkResult">
        <p>本次命中 {{ checkResult.activated.length }} 个条目</p>
        <ul v-if="checkResult.warnings.length" class="ip-error"><li v-for="warning in checkResult.warnings" :key="warning">{{ warning }}</li></ul>
      </template>
      <details v-if="preview.length"><summary>查看实际请求消息 · {{ preview.length }} 条</summary><div v-for="(message, index) in preview" :key="index"><strong>{{ index + 1 }} · {{ message.role }}</strong><pre>{{ message.content }}</pre></div></details>
      <details v-if="result" open><summary>{{ busy ? '正在接收' : '返回结果' }}</summary><pre>{{ result }}</pre></details>
    </details>
    <ConfirmDialog :open="!!removeTarget" title="删除配图预设" confirm-text="删除" tone="danger" confirm-icon="trash" @confirm="remove" @cancel="removeTarget = undefined">删除「{{ removeTarget?.name }}」？正在使用时将切回内置默认。</ConfirmDialog>
  </section>
</template>

<style scoped>
.ip-section { display: grid; gap: 12px; min-width: 0; font-size: 13px; letter-spacing: 0; }
.ip-toolbar, .ip-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ip-toolbar { justify-content: space-between; }
.ip-actions { justify-content: flex-start; }
.ip-select { flex: 1 1 190px; min-width: 0; }
.ip-section .bbi-btn { flex: 0 0 auto; min-height: 32px; }
.ip-section label { display: grid; gap: 6px; margin: 8px 0; min-width: 0; }
.ip-section .ip-check { display: flex; align-items: center; gap: 6px; }
.ip-section .bbi-input { width: 100%; min-width: 0; box-sizing: border-box; }
.ip-section .bbi-input:disabled { opacity: .65; }
.ip-section p { margin: 0; }
.ip-editor { min-width: 0; padding: 12px 0; margin: 0; border: 0; border-top: 1px solid var(--bbi-border); }
.ip-entry { border-block: 1px solid var(--bbi-border); padding: 8px 0; margin: 10px 0; }
.ip-section details { padding: 8px 0; min-width: 0; }
.ip-section .ip-manage { padding: 0; position: relative; }
.ip-manage > summary { list-style: none; }
.ip-manage > summary::-webkit-details-marker { display: none; }
.ip-menu { position: absolute; z-index: 2; top: 100%; right: 0; display: grid; gap: 6px; padding: 8px; min-width: 100px; border: 1px solid var(--bbi-border); border-radius: 6px; background: var(--bbi-surface, #fff); box-shadow: 0 4px 14px #0002; }
.ip-section summary { cursor: pointer; line-height: 1.6; }
.ip-section pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 320px; overflow: auto; font-size: 12px; }
.ip-section li, .ip-section strong, .ip-section p, .ip-warning { overflow-wrap: anywhere; }
.ip-error { color: var(--bbi-danger, #c64b54); }
.ip-status { color: var(--bbi-accent, #2d9180); }
.ip-muted { opacity: .72; font-size: 12px; }
.ip-text { resize: vertical; min-height: 150px; }
.ip-up { transform: rotate(-90deg); }
.ip-down { transform: rotate(90deg); }
.ip-variable { display: grid; grid-template-columns: minmax(80px, 1fr) minmax(100px, 2fr) 32px; gap: 6px; align-items: start; margin: 8px 0; }
.ip-variables { display: grid; grid-template-columns: minmax(110px, 1fr) 1fr; gap: 6px; }
.ip-variables dt { font-family: monospace; overflow-wrap: anywhere; }
.ip-variables dd { margin: 0; }
@media (max-width: 460px) {
  .ip-variable { grid-template-columns: minmax(0, 1fr) 32px; }
  .ip-variable textarea { grid-column: 1; grid-row: 2; }
  .ip-variable button { grid-column: 2; grid-row: 1 / 3; }
}
</style>
