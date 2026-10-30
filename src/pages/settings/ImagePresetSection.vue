<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Icon from '@/components/Icon.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import BbiSelect from '@/components/BbiSelect.vue';
import PresetRuleEditor from './PresetRuleEditor.vue';
import { previewPurpose } from './presetEditor';
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
import { builtinImagePreset, RULE_TARGETS } from '@/presets/catalog';
import { legacyRules } from '@/presets/rules';
import { assertMangaText, withMangaTextCorrection } from '@/presets/mangaText';
import { assertMangaComposition } from '@/presets/mangaComposition';
import { buildMangaSpec } from '@/manga/layouts';

const config = computed(() => settings.imagePresets);
const picker = ref<HTMLInputElement>();
const manageMenu = ref<HTMLDetailsElement>();
function closeManageMenu(): void {
  if (manageMenu.value) manageMenu.value.open = false;
}
function dismissManageMenu(event: PointerEvent): void {
  if (manageMenu.value?.open && !event.composedPath().includes(manageMenu.value)) closeManageMenu();
}
function manageMenuKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !manageMenu.value?.open) return;
  event.preventDefault();
  event.stopPropagation();
  closeManageMenu();
  manageMenu.value?.querySelector('summary')?.focus();
}
onMounted(() => {
  document.addEventListener('pointerdown', dismissManageMenu, true);
  document.addEventListener('keydown', manageMenuKey, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', dismissManageMenu, true);
  document.removeEventListener('keydown', manageMenuKey, true);
});
const selected = ref(config.value.activeId);
const preset = computed(() => config.value.presets.find(p => p.id === selected.value));
const displayed = computed(() => draft.value ?? preset.value ?? builtinImagePreset());
const ruleTarget = ref<string>('comfy');
const target = computed(() => RULE_TARGETS.find(t => t.value === ruleTarget.value) ?? RULE_TARGETS[0]);
const effectiveTarget = computed(() => {
  const profile = autoTagProfile(displayed.value);
  return profile.layout ? RULE_TARGETS[1] : settings.defaultBackend === 'nai' ? RULE_TARGETS[profile.naiCharPrompts ? 2 : 3] : RULE_TARGETS[0];
});
const ruleModes = { builtin: '内置参考', custom: '本预设自定义', off: '不附加' };
const viewRules = computed(() => displayed.value.rules ?? legacyRules({}, {}, displayed.value.useBackendRules !== false));
const editorTab = ref('content');
const editorRoot = ref<HTMLFieldSetElement>();
const editorTabs = [{ id: 'content', label: '画面要求' }, { id: 'rules', label: '规范与检查' }, { id: 'advanced', label: '输出与变量' }, { id: 'external', label: '外部附加' }];
function tabKey(event: KeyboardEvent, index: number): void {
  const count = editorTabs.length;
  const next = event.key === 'ArrowRight' ? (index + 1) % count : event.key === 'ArrowLeft' ? (index + count - 1) % count : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : -1;
  if (next < 0) return;
  event.preventDefault();
  event.stopPropagation();
  editorTab.value = editorTabs[next].id;
  (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
}
const activeName = computed(() => config.value.presets.find(p => p.id === config.value.activeId)?.name ?? '内置默认');
const draft = ref<ImagePromptPreset>();
watch(effectiveTarget, currentTarget => {
  if (ruleTarget.value === currentTarget.value) ruleTarget.value = RULE_TARGETS.find(item => item.value !== currentTarget.value)!.value;
});
const variables = ref<{ name: string; value: string }[]>([]);
const entryId = ref('');
const entry = computed(() => draft.value?.entries.find(e => e.id === entryId.value));
const search = ref('');
const filteredEntries = computed(() => draft.value?.entries.filter(e => `${e.name} ${e.content}`.toLowerCase().includes(search.value.toLowerCase())) ?? []);
const entryOptions = computed(() => filteredEntries.value.map(item => ({
  value: item.id, label: `${item.enabled ? '' : '[停用] '}${item.name}${item.placement === 'after_data' ? ' · 资料后' : ''}`,
})));
watch(filteredEntries, items => {
  if (!items.some(item => item.id === entryId.value)) entryId.value = items[0]?.id ?? '';
});
const removeTarget = ref<ImagePromptPreset>();
const error = ref(''), notice = ref(''), testText = ref('');
const busy = ref(false), result = ref(''), preview = ref<ChatMsg[]>([]);
const checkResult = ref<RenderedPreset>();
const inputCheck = ref<{ originalChars: number; paragraphs: number; cleanedText: string; presetName: string; active: boolean }>();
let controller: AbortController | undefined;
onBeforeUnmount(() => controller?.abort());
watch(selected, () => { preview.value = []; checkResult.value = undefined; inputCheck.value = undefined; result.value = ''; error.value = ''; });
watch([draft, variables, testText], () => {
  if (!busy.value) { preview.value = []; checkResult.value = undefined; inputCheck.value = undefined; result.value = ''; }
}, { deep: true });

function fail(e: unknown): void { error.value = e instanceof Error ? e.message : String(e); }
function edit(value: ImagePromptPreset): void {
  draft.value = JSON.parse(JSON.stringify(value));
  draft.value!.rules ??= legacyRules({}, {}, value.useBackendRules !== false);
  draft.value!.mangaText ??= 'auto';
  draft.value!.mangaComposition ??= 'auto';
  variables.value = Object.entries(value.variables).map(([name, value]) => ({ name, value }));
  entryId.value = value.entries[0]?.id ?? '';
  search.value = ''; error.value = ''; notice.value = ''; preview.value = []; checkResult.value = undefined; result.value = '';
  ruleTarget.value = RULE_TARGETS.find(item => item.value !== effectiveTarget.value.value)!.value;
  editorTab.value = value.entries.length ? 'content' : 'rules';
}
function current(): ImagePromptPreset | null {
  if (!draft.value) return validatePreset(JSON.parse(JSON.stringify(displayed.value)));
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
  const copy = importPresets(exportPreset(preset.value ?? builtinImagePreset()))[0];
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
  const exported = preset.value ?? builtinImagePreset();
  try {
    const url = URL.createObjectURL(new Blob([exportPreset(exported)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `${exported.name.replace(/[<>:"/\\|?*]/g, '_')}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { fail(e); }
}
function remove(): void {
  const id = removeTarget.value?.id;
  config.value.presets = config.value.presets.filter(p => p.id !== id);
  if (config.value.activeId === id) config.value.activeId = '';
  selected.value = config.value.activeId; removeTarget.value = undefined;
}
async function addEntry(): Promise<void> {
  const added = newPromptEntry(); draft.value?.entries.push(added); entryId.value = added.id; search.value = '';
  editorTab.value = 'content';
  await nextTick();
  editorRoot.value?.querySelector<HTMLInputElement>('.ip-entry input[type="text"]')?.focus();
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
  busy.value = true; error.value = ''; notice.value = ''; result.value = ''; preview.value = []; checkResult.value = undefined; inputCheck.value = undefined;
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
    inputCheck.value = {
      originalChars: context.chat[floor].mes.length, paragraphs: prepared.segments.length,
      cleanedText: prepared.segments.map(segment => segment.text).join('\n\n'),
      presetName: chosen?.name ?? '内置默认',
      active: (chosen?.id ?? '') === config.value.activeId || (!config.value.activeId && !draft.value),
    };
    if (!prepared.segments.length) throw new Error('清洗后没有可用正文，本次未发送请求。请检查“参考与过滤 → 自定义清洗标签”及正文中的思考、注释或正文边界标签。');
    const options = JSON.parse(JSON.stringify(settings.autoTag));
    const profile = autoTagProfile(chosen ?? builtinImagePreset());
    const mangaSnapshot = JSON.parse(JSON.stringify(settings.manga));
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
      validate: (text: string) => {
        const plan = parseImagePlan(text, prepared.segments, options.minImages, options.maxImages);
        assertMangaText(plan, chosen, !!profile.layout, mangaSnapshot, profile.lockedSize);
        assertMangaComposition(plan, chosen, !!profile.layout, mangaSnapshot, profile.lockedSize);
      },
    };
    result.value = await withMangaTextCorrection(messages, opts.source, controller.signal, (requestMessages, source, validate) => {
      preview.value = requestMessages;
      result.value = '';
      const requestOptions = { ...opts, source, validate };
      return channel ? requestCompletion(channel, requestMessages, requestOptions) : requestViaMainApi(requestMessages, requestOptions);
    }, opts.validate);
    notice.value = '计划校验通过；尚未生成图片，不代表实图质量已验证';
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
      <template v-if="displayed">
        <button class="bbi-btn bbi-btn-sm" :disabled="!!draft || busy" :title="preset ? '编辑预设' : '复制内置默认后编辑'" @click="preset ? edit(preset) : duplicate()"><Icon name="edit" />{{ preset ? '编辑' : '复制并编辑' }}</button>
        <details ref="manageMenu" class="ip-manage">
          <summary class="bbi-btn bbi-btn-sm" title="预设管理" aria-label="预设管理"><Icon name="more" /></summary>
          <div class="ip-menu" @click="closeManageMenu">
            <button class="bbi-btn bbi-btn-sm" :disabled="!!draft || busy" title="复制为新预设" @click="duplicate"><Icon name="copy" />复制</button>
            <button class="bbi-btn bbi-btn-sm" :disabled="!!draft || busy" title="导出预设" @click="download"><Icon name="upload" />导出</button>
            <button v-if="preset" class="bbi-btn bbi-btn-sm" :disabled="!!draft || busy" title="删除预设" @click="removeTarget = preset"><Icon name="trash" />删除</button>
          </div>
        </details>
      </template>
    </div>
    <p v-if="error" class="ip-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="ip-status" role="status">{{ notice }}</p>
    <p v-if="preset?.description && !draft" class="ip-muted">{{ preset.description }}</p>
    <details class="ip-effective" aria-label="本次生效配置">
      <summary>{{ draft ? '草稿配置' : selected === config.activeId ? '当前生效配置' : '所选预设 · 尚未启用' }} · {{ effectiveTarget.label }}</summary>
      <dl>
        <dt>画面要求</dt><dd>{{ displayed.entries.filter(e => e.enabled).length }} 个开启条目</dd>
        <dt>书写规范</dt><dd>{{ ruleModes[viewRules[effectiveTarget.spec].mode] }}</dd>
        <dt>检查指导</dt><dd>{{ ruleModes[viewRules[effectiveTarget.check].mode] }}</dd>
        <dt>前置规则</dt><dd>{{ ruleModes[viewRules.jailbreak.mode] }}</dd>
        <dt>插件固定要求</dt><dd>图片位置、数量、输出结构{{ effectiveTarget.value === 'manga' ? '、版式约束' : '' }}</dd>
        <template v-if="effectiveTarget.value === 'manga'">
          <dt>漫画文字</dt><dd>{{ displayed.mangaText === 'required' ? '必须有叙事文字' : '按剧情安排' }}</dd>
          <dt>漫画表现</dt><dd>{{ displayed.mangaComposition === 'expressive' ? '生动叙事 · 不强制出框' : '按预设安排' }}</dd>
        </template>
      </dl>
    </details>
    <details v-if="(draft ?? preset)?.warnings.length" class="ip-warning" open>
      <summary>导入兼容性提醒</summary><ul><li v-for="warning in (draft ?? preset)?.warnings" :key="warning">{{ warning }}</li></ul>
    </details>
    <fieldset v-if="draft" ref="editorRoot" class="ip-editor" :disabled="busy">
      <label>预设名称<input v-model="draft.name" class="bbi-input" aria-label="预设名称" /></label>
      <label>备注<input v-model="draft.description" class="bbi-input" aria-label="预设备注" /></label>
      <div class="ip-tabs" role="tablist" aria-label="预设编辑分类">
        <button v-for="(tab, index) in editorTabs" :id="`ip-tab-${tab.id}`" :key="tab.id" type="button" role="tab" :aria-selected="editorTab === tab.id" :aria-controls="`ip-panel-${tab.id}`" :tabindex="editorTab === tab.id ? 0 : -1" @click="editorTab = tab.id" @keydown="tabKey($event, index)">{{ tab.label }}</button>
      </div>
      <div v-show="editorTab === 'content'" id="ip-panel-content" role="tabpanel" aria-labelledby="ip-tab-content">
      <h3 tabindex="-1">画面要求</h3>
      <div v-if="effectiveTarget.value === 'manga'" class="ip-creative">
        <label id="ip-lettering" tabindex="-1">漫画文字<select v-model="draft.mangaText" class="bbi-input" aria-label="漫画文字策略"><option value="auto">按剧情安排</option><option value="required">必须有叙事文字</option></select></label>
        <label>漫画表现<select v-model="draft.mangaComposition" class="bbi-input" aria-label="漫画构图策略"><option value="auto">按预设安排</option><option value="expressive">生动叙事 · 不强制出框</option></select></label>
      </div>
      <div class="ip-toolbar"><strong>提示词条目 · {{ draft.entries.filter(e => e.enabled).length }} / {{ draft.entries.length }} 已开启</strong><button class="bbi-btn bbi-btn-sm" @click="addEntry"><Icon name="plus" />添加条目</button></div>
      <p v-if="!draft.entries.length" class="ip-muted">暂无额外画面要求</p>
      <input v-if="draft.entries.length" v-model="search" class="bbi-input" type="search" placeholder="搜索条目" aria-label="搜索预设条目" />
      <BbiSelect v-if="filteredEntries.length" v-model="entryId" class="ip-entry-picker" :options="entryOptions" wrap-labels aria-label="选择预设条目" />
      <p v-if="search && !filteredEntries.length" class="ip-muted" role="status">没有匹配的条目</p>
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
        <details><summary>插入位置、条件与角色</summary>
          <label>插入位置<select :value="entry.placement ?? 'before_data'" class="bbi-input" aria-label="条目插入位置" @change="entry.placement = ($event.target as HTMLSelectElement).value as 'before_data' | 'after_data'"><option value="before_data">资料前 · 任务约定</option><option value="after_data">资料后 · 执行与核对</option></select></label>
          <label>何时使用<select v-model="entry.trigger" class="bbi-input"><option value="always">始终使用</option><option value="keywords">正文或上下文出现关键词时</option></select></label>
          <template v-if="entry.trigger === 'keywords'">
            <label>任一关键词<input v-model="entry.keywords" class="bbi-input" placeholder="逗号分隔" /></label>
            <label>同时出现以下任一词 · 可留空<input v-model="entry.andKeywords" class="bbi-input" placeholder="逗号分隔" /></label>
          </template>
          <label>消息角色<select v-model="entry.role" class="bbi-input"><option value="system">规则（system）</option><option value="user">要求（user）</option><option value="assistant">示例回答（assistant）</option></select></label>
        </details>
      </div>
      </div>
      <div v-show="editorTab === 'rules'" id="ip-panel-rules" role="tabpanel" aria-labelledby="ip-tab-rules">
        <h3 tabindex="-1">当前规范 · {{ effectiveTarget.label }}</h3>
        <template v-if="draft.rules">
          <PresetRuleEditor id="ip-current-spec" :key="effectiveTarget.spec" tabindex="-1" :rule="draft.rules[effectiveTarget.spec]" :rule-key="effectiveTarget.spec" title="书写规范" />
          <PresetRuleEditor id="ip-current-check" :key="effectiveTarget.check" tabindex="-1" :rule="draft.rules[effectiveTarget.check]" :rule-key="effectiveTarget.check" title="检查指导" />
          <details class="ip-alternatives">
            <summary>其他后端与场景的规范 · {{ RULE_TARGETS.length - 1 }} 组</summary>
            <label>适用场景<select v-model="ruleTarget" class="bbi-input" aria-label="规范适用场景"><option v-for="item in RULE_TARGETS.filter(item => item.value !== effectiveTarget.value)" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
            <PresetRuleEditor :key="target.spec" :rule="draft.rules[target.spec]" :rule-key="target.spec" title="备用书写规范" />
            <PresetRuleEditor :key="target.check" :rule="draft.rules[target.check]" :rule-key="target.check" title="备用检查指导" />
          </details>
        </template>
      </div>
      <div v-show="editorTab === 'advanced'" id="ip-panel-advanced" role="tabpanel" aria-labelledby="ip-tab-advanced">
        <h3 tabindex="-1">输出与变量</h3>
        <label>输出方式<select v-model="draft.output" class="bbi-input" aria-label="预设输出方式"><option value="text">普通文本 · JSON 计划</option><option value="tool">工具输出 · 需要支持工具的副 API</option></select></label>
        <label>工作流提示词格式<select :value="draft.format ?? 'auto'" class="bbi-input" aria-label="工作流提示词格式" @change="draft.format = ($event.target as HTMLSelectElement).value as 'auto' | 'moss_layout'"><option value="auto">跟随后端与漫画开关</option><option value="moss_layout">MOSS 原生 Layout</option></select></label>
        <PresetRuleEditor v-if="draft.rules" id="ip-prefix" tabindex="-1" :rule="draft.rules.jailbreak" rule-key="jailbreak" title="通用前置规则" />
        <h3 id="ip-custom-variables" tabindex="-1">自定义变量 · {{ variables.length }} 个</h3>
        <div v-for="(variable, index) in variables" :key="index" class="ip-variable">
          <input v-model="variable.name" class="bbi-input" placeholder="变量名" :aria-label="`变量名 ${index + 1}`" />
          <textarea v-model="variable.value" class="bbi-input" rows="2" placeholder="变量内容" :aria-label="`变量值 ${index + 1}`" />
          <button class="bbi-btn bbi-btn-sm" :title="`删除变量 ${variable.name}`" @click="variables.splice(index, 1)"><Icon name="trash" /></button>
        </div>
        <button class="bbi-btn bbi-btn-sm" @click="variables.push({ name: '', value: '' })"><Icon name="plus" />添加变量</button>
        <details><summary>可用内容变量</summary><dl class="ip-variables"><template v-for="[key, label] in PRESET_VARIABLES" :key="key"><dt>{{ '{' + '{' + key + '}' + '}' }}</dt><dd>{{ label }}</dd></template></dl></details>
      </div>
      <div v-show="editorTab === 'external'" id="ip-panel-external" role="tabpanel" aria-labelledby="ip-tab-external">
        <h3 tabindex="-1">外部附加内容</h3>
        <dl class="ip-external">
          <dt>版式设置 · 只读</dt><dd>{{ effectiveTarget.value === 'manga' ? '使用当前漫画设置中的版式、分格与坐标约束' : '当前未启用漫画版式' }}</dd>
          <dt>插件固定协议 · 只读</dt><dd>图片位置、数量与输出结构，由插件按当前后端生成</dd>
          <dt>剧情上下文 · 只读</dt><dd>{{ preview.length ? '已有请求预览，完整内容见下方“查看实际请求消息”' : '本地检查后可见：正文、角色资料、世界书与记忆等当前请求内容' }}</dd>
        </dl>
        <details v-if="effectiveTarget.value === 'manga' && settings.manga.enabled"><summary>当前版式与选择要求</summary><pre>{{ buildMangaSpec(settings.manga) }}</pre></details>
        <details v-for="message in preview.filter(item => item.purpose === 'contract')" :key="message.purpose"><summary>本次插件固定协议</summary><pre>{{ message.content }}</pre></details>
      </div>
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
      <div v-if="inputCheck" class="ip-input-check" aria-label="本次实际输入">
        <p><strong>{{ inputCheck.presetName }}</strong> · {{ draft ? '未保存草稿' : inputCheck.active ? '当前启用' : '仅测试，尚未启用' }}</p>
        <p>原文 {{ inputCheck.originalChars.toLocaleString() }} 字符 · 清洗后 {{ inputCheck.cleanedText.length.toLocaleString() }} 字符 · {{ inputCheck.paragraphs }} 段</p>
        <details open><summary>清洗后实际使用的正文</summary><pre>{{ inputCheck.cleanedText || '（没有剩余正文，本次未发送请求）' }}</pre></details>
      </div>
      <template v-if="checkResult">
        <p>本次命中 {{ checkResult.activated.length }} 个条目</p>
        <ul v-if="checkResult.warnings.length" class="ip-error"><li v-for="warning in checkResult.warnings" :key="warning">{{ warning }}</li></ul>
      </template>
      <details v-if="preview.length"><summary>查看实际请求消息 · {{ preview.length }} 条</summary><div v-for="(message, index) in preview" :key="index"><strong>{{ index + 1 }} · {{ message.source || previewPurpose(message.purpose) }} · {{ message.role }}</strong><pre>{{ message.content }}</pre></div></details>
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
.ip-editor h3 { margin: 12px 0; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.ip-editor :focus-visible { outline: 2px solid var(--bbi-accent); outline-offset: 2px; }
.ip-entry { border-block: 1px solid var(--bbi-border); padding: 8px 0; margin: 10px 0; }
.ip-entry-picker { width: 100%; min-width: 0; margin-top: 8px; }
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
.ip-input-check { display: grid; gap: 6px; padding: 10px 0; border-block: 1px solid var(--bbi-line); }
.ip-muted { opacity: .72; font-size: 12px; }
.ip-text { resize: vertical; min-height: 150px; }
.ip-creative { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.ip-effective { border-block: 1px solid var(--bbi-line); padding: 10px 0; font-size: 12px; }
.ip-effective dl { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 6px; margin: 10px 0 0; }
.ip-effective dt { color: var(--bbi-ink-muted); }
.ip-effective dd { margin: 0; overflow-wrap: anywhere; }
.ip-external { margin: 0; display: grid; gap: 8px; }
.ip-external dt { font-weight: 600; }
.ip-external dd { margin: 0 0 8px; color: var(--bbi-ink-muted); overflow-wrap: anywhere; line-height: 1.6; }
.ip-tabs { display: flex; border-bottom: 1px solid var(--bbi-line); margin: 12px 0; }
.ip-tabs button { flex: 1; min-width: 0; overflow-wrap: anywhere; border: 0; background: transparent; color: var(--bbi-ink-muted); padding: 10px 4px; cursor: pointer; font: inherit; border-bottom: 2px solid transparent; }
.ip-tabs button[aria-selected=true] { color: var(--bbi-accent); border-bottom-color: var(--bbi-accent); font-weight: 600; }
.ip-up { transform: rotate(-90deg); }
.ip-down { transform: rotate(90deg); }
.ip-variable { display: grid; grid-template-columns: minmax(80px, 1fr) minmax(100px, 2fr) 32px; gap: 6px; align-items: start; margin: 8px 0; }
.ip-variables { display: grid; grid-template-columns: minmax(110px, 1fr) 1fr; gap: 6px; }
.ip-variables dt { font-family: monospace; overflow-wrap: anywhere; }
.ip-variables dd { margin: 0; }
@media (max-width: 460px) {
  .ip-creative { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .ip-variable { grid-template-columns: minmax(0, 1fr) 32px; }
  .ip-variable textarea { grid-column: 1; grid-row: 2; }
  .ip-variable button { grid-column: 2; grid-row: 1 / 3; }
}
</style>
