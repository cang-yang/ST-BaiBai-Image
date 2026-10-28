<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Icon from '@/components/Icon.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import WorldbookEntryEditor from './WorldbookEntryEditor.vue';
import { settings } from '@/state/settings';
import { getContext } from '@/st/context';
import { compatibilityWarnings, entryDefaults, generationTriggers, importImageWorldBook, normalizeScan, type ImageWorldBook, type ImageWorldEntry } from '@/worldbook/model';
import { readHostScanSettings, scanImageWorldbooks, type WorldbookScanResult } from '@/worldbook/engine';
import { lastWorldbookScan, previewImageWorldbooks } from '@/worldbook/runtime';

const config = computed(() => settings.imageWorldbooks);
const picker = ref<HTMLInputElement>();
const selected = ref(''), search = ref(''), filter = ref('all'), page = ref(0);
const error = ref(''), notice = ref(''), busy = ref(false);
const editing = ref<ImageWorldEntry>(), testText = ref('');
const preview = ref<WorldbookScanResult>();
const removeTarget = ref<{ book: ImageWorldBook; key?: string }>();
const book = computed(() => config.value.books.find(b => b.id === selected.value));
watch(() => config.value.books.map(b => b.id).join(), () => {
  if (!book.value) selected.value = config.value.books[0]?.id ?? '';
}, { immediate: true });
watch(selected, () => { editing.value = undefined; page.value = 0; search.value = ''; preview.value = undefined; });
watch([search, filter], () => { page.value = 0; });
const entries = computed(() => Object.entries(book.value?.document.entries ?? {}).filter(([, e]) => {
  if (filter.value === 'enabled' && e.disable) return false;
  if (filter.value === 'disabled' && !e.disable) return false;
  const term = search.value.toLowerCase();
  return !term || `${e.uid} ${e.comment} ${e.key.join(' ')} ${e.content}`.toLowerCase().includes(term);
}).sort((a, b) => Number(a[1].displayIndex ?? a[1].uid) - Number(b[1].displayIndex ?? b[1].uid)));
const pageEntries = computed(() => entries.value.slice(page.value * 40, (page.value + 1) * 40));
const total = computed(() => Object.keys(book.value?.document.entries ?? {}).length);
const enabledCount = computed(() => Object.values(book.value?.document.entries ?? {}).filter(e => !e.disable).length);
const warnings = computed(() => [...new Set(Object.values(book.value?.document.entries ?? {}).flatMap(compatibilityWarnings))]);
const diagnostics = computed(() => preview.value ?? lastWorldbookScan.value?.result);
const numericOptions = [
  ['world_info_depth', '往前查看几条消息'], ['world_info_budget', '最多占用上下文 %'], ['world_info_budget_cap', '字数预算上限 · 0 不限'],
  ['world_info_min_activations', '至少寻找几条参考'], ['world_info_min_activations_depth_max', '最多向前查找几条消息 · 0 不限'],
  ['world_info_max_recursion_steps', '最多检查几轮 · 0 不限'],
] as const;
const booleanOptions = [
  ['world_info_recursive', '允许条目触发其他条目'], ['world_info_include_names', '也匹配发言者名字'],
  ['world_info_case_sensitive', '英文区分大小写'], ['world_info_match_whole_words', '只匹配完整词语'],
  ['world_info_use_group_scoring', '同组优先选匹配更多的'],
] as const;
function fail(e: unknown): void { error.value = e instanceof Error ? e.message : String(e); }
async function importFiles(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = [...input.files ?? []];
  error.value = ''; notice.value = ''; busy.value = true;
  try {
    const incoming: ImageWorldBook[] = [];
    for (const file of files) {
      if (file.size > 2_000_000) throw new Error(`${file.name} 超过 2 MB`);
      const added = importImageWorldBook(await file.text(), file.name);
      const names = new Set([...config.value.books, ...incoming].map(b => b.name));
      const original = added.name;
      let n = 2;
      while (names.has(added.name)) added.name = `${original} (${n++})`;
      incoming.push(added);
    }
    if (new Blob([JSON.stringify([...config.value.books, ...incoming])]).size > 10_000_000) throw new Error('生图世界书库总大小不能超过 10 MB');
    config.value.books.push(...incoming);
    selected.value = incoming[0]?.id ?? selected.value;
    notice.value = `已导入 ${incoming.length} 本`;
  } catch (e) { fail(e); }
  finally { input.value = ''; busy.value = false; }
}
function exportBook(): void {
  if (!book.value) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(book.value.document, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `${book.value.name}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function saveEntry(entry: ImageWorldEntry): void {
  if (!book.value) return;
  const existingKey = Object.keys(book.value.document.entries).find(key => book.value!.document.entries[key].uid === entry.uid);
  book.value.document.entries[existingKey ?? String(entry.uid)] = entry;
  editing.value = undefined; notice.value = '条目已保存'; preview.value = undefined;
}
function newEntry(): void {
  if (!book.value) return;
  const uids = Object.values(book.value.document.entries).map(e => e.uid);
  let uid = 0; while (uids.includes(uid)) uid++;
  editing.value = entryDefaults(uid);
}
function remove(): void {
  const target = removeTarget.value;
  if (!target) return;
  if (target.key !== undefined) delete target.book.document.entries[target.key];
  else config.value.books = config.value.books.filter(b => b.id !== target.book.id);
  removeTarget.value = undefined; editing.value = undefined; preview.value = undefined; page.value = 0;
}
function toggleFiltered(disable: boolean): void {
  for (const [, entry] of entries.value) entry.disable = disable;
  notice.value = disable ? '筛选条目已停用' : '筛选条目已启用';
}
async function copyHost(): Promise<void> {
  const host = await readHostScanSettings();
  if (!host) { error.value = '未能读取酒馆设置'; return; }
  config.value.scan = host; config.value.inherit = false; notice.value = '已复制当前酒馆扫描设置';
}
async function test(): Promise<void> {
  error.value = ''; busy.value = true; preview.value = undefined;
  try {
    const context = getContext();
    if (!context) throw new Error('酒馆上下文未就绪');
    config.value.scan = normalizeScan(config.value.scan);
    if (testText.value.trim()) {
      const ctx = { ...context, chat: [{ name: context.name2, is_user: false, is_system: false, mes: testText.value }], chatMetadata: {} };
      preview.value = await scanImageWorldbooks({ context: ctx, targetFloor: 0, config: config.value });
    } else {
      if (!context.chat.length) throw new Error('当前聊天为空，请填写测试文本');
      preview.value = await previewImageWorldbooks(context, context.chat.length - 1);
    }
  } catch (e) { fail(e); }
  finally { busy.value = false; }
}
</script>

<template>
  <div class="wb-section">
    <div class="wb-toolbar">
      <label class="wb-check"><input v-model="config.enabled" type="checkbox" />启用生图世界书</label>
      <div class="wb-actions">
        <input ref="picker" hidden type="file" accept=".json,application/json" multiple @change="importFiles" />
        <button class="bbi-btn bbi-btn-primary bbi-btn-sm" type="button" :disabled="busy" title="选择酒馆导出的世界书 JSON 文件" @click="picker?.click()"><Icon name="download" />导入世界书</button>
      </div>
    </div>
    <div class="wb-scope"><span>使用范围</span><strong>图片提示词</strong><span>正文不使用</span></div>
    <p v-if="error" class="wb-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="wb-status" role="status">{{ notice }}</p>
    <div v-if="config.books.length" class="wb-book-row">
      <select v-model="selected" class="bbi-input" aria-label="选择生图世界书"><option v-for="item in config.books" :key="item.id" :value="item.id">{{ item.enabled ? '' : '[停用] ' }}{{ item.name }}</option></select>
      <template v-if="book">
        <label class="wb-check"><input v-model="book.enabled" type="checkbox" />使用这本书</label>
      </template>
    </div>
    <p v-else class="wb-empty">尚未导入世界书</p>
    <template v-if="book">
      <div class="wb-toolbar wb-subtle"><span>{{ total }} 个条目，{{ enabledCount }} 个已开启</span><button class="bbi-btn bbi-btn-sm" type="button" title="新增条目" @click="newEntry"><Icon name="plus" />新增条目</button></div>
      <div class="wb-search-row">
        <input v-model="search" class="bbi-input" type="search" placeholder="搜索条目" aria-label="搜索世界书条目" />
        <select v-model="filter" class="bbi-input wb-filter" aria-label="条目筛选"><option value="all">全部 {{ total }}</option><option value="enabled">已启用</option><option value="disabled">已停用</option></select>
      </div>
      <ul class="wb-list">
        <li v-for="[key, entry] in pageEntries" :key="key" :class="{ 'wb-disabled': entry.disable }">
          <input v-model="entry.disable" type="checkbox" :true-value="false" :false-value="true" :aria-label="`启用条目 ${entry.comment || entry.uid}`" />
          <button class="wb-entry" type="button" @click="editing = entry">
            <span class="wb-dot" :class="{ 'wb-constant': entry.constant }" :title="entry.constant ? '始终使用' : '出现关键词时使用'" />
            <span class="wb-entry-text"><strong>{{ entry.comment || `条目 ${entry.uid}` }}</strong><small>{{ entry.disable ? '已停用' : entry.constant ? '始终使用' : entry.key.length ? `遇到：${entry.key.join('、')}` : '尚未设置触发词' }}</small></span>
          </button>
          <button class="bbi-btn bbi-btn-sm" type="button" :title="`编辑 ${entry.comment || entry.uid}`" @click="editing = entry"><Icon name="edit" /></button>
        </li>
      </ul>
      <div v-if="entries.length > 40" class="wb-toolbar"><button type="button" class="bbi-btn bbi-btn-sm" :disabled="page === 0" @click="page--">上一页</button><span>{{ page + 1 }} / {{ Math.ceil(entries.length / 40) }}</span><button type="button" class="bbi-btn bbi-btn-sm" :disabled="(page + 1) * 40 >= entries.length" @click="page++">下一页</button></div>
      <WorldbookEntryEditor v-if="editing" :entry="editing" @save="saveEntry" @close="editing = undefined" />
      <button v-if="editing && Object.values(book.document.entries).some(e => e.uid === editing?.uid)" class="bbi-btn bbi-btn-sm wb-delete-entry" type="button" @click="removeTarget = { book, key: Object.keys(book.document.entries).find(k => book!.document.entries[k].uid === editing?.uid) }"><Icon name="trash" />删除此条目</button>
      <details v-if="warnings.length"><summary>兼容性提醒 · {{ warnings.length }}</summary><ul class="wb-notes"><li v-for="warning in warnings" :key="warning">{{ warning }}</li></ul></details>
    </template>
    <details v-if="book" class="wb-test">
      <summary>测试哪些条目会生效</summary>
      <textarea v-model="testText" class="bbi-input" rows="3" placeholder="输入一段场景文字；留空则使用当前聊天" aria-label="世界书测试文本" />
      <div class="wb-toolbar"><button class="bbi-btn bbi-btn-sm" type="button" :disabled="busy || !config.enabled" @click="test"><Icon name="search" />{{ busy ? '检查中' : testText.trim() ? '用这段文字测试' : '用当前聊天测试' }}</button></div>
      <template v-if="diagnostics">
        <p class="wb-result">这次会使用 {{ diagnostics.allActivatedEntries.size }} 个条目</p>
        <details v-for="entry in [...diagnostics.allActivatedEntries]" :key="`${entry.world}:${entry.uid}`"><summary>{{ entry.comment || `条目 ${entry.uid}` }} <small>· {{ entry.bookName }}</small></summary><pre>{{ entry.content }}</pre></details>
        <details class="wb-technical"><summary>查看检查详情</summary><p class="wb-status">{{ preview ? '预览 · 未更新计时状态' : `最近生成 · 楼层 ${(lastWorldbookScan?.floor ?? 0) + 1}` }} · {{ diagnostics.estimatedTokens ? '估算' : '宿主分词器' }} {{ diagnostics.tokens }} tokens · {{ diagnostics.rounds.length }} 轮{{ diagnostics.rounds.some(r => r.overflow) ? ' · 已达预算' : '' }}</p></details>
        <ul v-if="diagnostics.warnings.length" class="wb-notes"><li v-for="warning in diagnostics.warnings" :key="warning">{{ warning }}</li></ul>
      </template>
    </details>
    <details v-if="book">
      <summary>书籍管理</summary>
      <label class="wb-label">书名<input v-model="book.name" class="bbi-input" aria-label="世界书名称" /></label>
      <div class="wb-actions wb-management">
        <button class="bbi-btn bbi-btn-sm" type="button" title="导出当前世界书" @click="exportBook"><Icon name="upload" />导出</button>
        <button class="bbi-btn bbi-btn-sm" type="button" :disabled="!entries.length" @click="toggleFiltered(false)"><Icon name="check" />开启筛选条目</button>
        <button class="bbi-btn bbi-btn-sm" type="button" :disabled="!entries.length" @click="toggleFiltered(true)"><Icon name="eye-off" />关闭筛选条目</button>
        <button class="bbi-btn bbi-btn-sm" type="button" title="删除当前世界书" @click="removeTarget = { book }"><Icon name="trash" />删除此书</button>
      </div>
    </details>
    <details v-if="book">
      <summary>高级设置</summary>
      <div class="wb-toolbar"><label class="wb-check"><input v-model="config.inherit" type="checkbox" />沿用酒馆的匹配规则</label><button class="bbi-btn bbi-btn-sm" type="button" title="复制当前酒馆设置，仅在生图世界书内修改" @click="copyHost"><Icon name="copy" />单独调整</button></div>
      <div class="wb-fields">
        <label class="wb-label" title="按此值乘以预算百分比，计算世界书可用 tokens。">副 API 上下文大小<input v-model.number="config.contextSize" class="bbi-input" type="number" min="256" max="2000000" /></label>
        <label class="wb-label" title="条目的生成类型过滤将与此值比较。">这次按什么类型匹配<select v-model="config.trigger" class="bbi-input"><option v-for="trigger in generationTriggers" :key="trigger" :value="trigger">{{ ({normal:'普通生成',continue:'继续生成',impersonate:'代用户发言',swipe:'换一版',regenerate:'重新生成',quiet:'后台生成'} as Record<string,string>)[trigger] }}</option></select></label>
      </div>
      <template v-if="!config.inherit">
        <div class="wb-fields"><label v-for="[key, label] in numericOptions" :key="key" class="wb-label">{{ label }}<input v-model.number="config.scan[key]" class="bbi-input" type="number" min="0" @change="config.scan = normalizeScan(config.scan)" /></label></div>
        <div class="wb-actions"><label v-for="[key, label] in booleanOptions" :key="key" class="wb-check"><input v-model="config.scan[key]" type="checkbox" />{{ label }}</label></div>
      </template>
    </details>
    <ConfirmDialog :open="!!removeTarget" :title="removeTarget?.key === undefined ? '删除生图世界书' : '删除条目'" tone="danger" confirm-icon="trash" @cancel="removeTarget = undefined" @confirm="remove">
      {{ removeTarget?.key === undefined ? removeTarget?.book.name : removeTarget?.book.document.entries[removeTarget.key]?.comment || '此条目' }} · 此操作不可撤销
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.wb-section { display: grid; gap: 12px; min-width: 0; }
.wb-toolbar, .wb-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wb-toolbar { justify-content: space-between; }
.wb-check { display: flex; gap: 5px; align-items: center; font-size: 12px; }
.wb-label { display: grid; gap: 5px; font-size: 12px; min-width: 0; }
.bbi-input { width: 100%; min-width: 0; box-sizing: border-box; }
.wb-book-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; }
.wb-search-row { display: grid; grid-template-columns: minmax(0, 1fr) 100px; gap: 8px; }
.wb-filter { width: 100px; flex: 0 0 100px; }
.wb-scope { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 11px; color: var(--bbi-ink-soft); }
.wb-scope strong { color: var(--bbi-ink); font-weight: 500; }
.wb-subtle { font-size: 12px; color: var(--bbi-ink-soft); }
.wb-management { margin-top: 10px; }
.wb-empty { text-align: center; padding: 24px 0; color: var(--bbi-ink-soft); font-size: 13px; }
.wb-result { font-size: 13px; font-weight: 500; }
.wb-technical, summary small { font-size: 11px; color: var(--bbi-ink-soft); font-weight: normal; }
.wb-delete-entry { justify-self: start; }
.wb-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 10px 0; }
.wb-list { list-style: none; padding: 0; margin: 0; max-height: 340px; overflow-y: auto; border-block: 1px solid var(--bbi-border); }
.wb-list li { display: flex; gap: 8px; align-items: center; padding: 8px 2px; border-bottom: 1px solid var(--bbi-border); min-height: 44px; box-sizing: border-box; }
.wb-entry { display: flex; flex: 1; align-items: center; gap: 8px; min-width: 0; text-align: left; background: none; color: inherit; border: 0; cursor: pointer; }
.wb-entry-text { display: grid; gap: 4px; min-width: 0; }
.wb-entry-text strong { font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }
.wb-entry-text small { font-size: 11px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--bbi-ink-soft); }
.wb-dot { flex: 0 0 7px; height: 7px; background: #3f9873; border-radius: 50%; }
.wb-constant { background: #518fca; }
.wb-disabled .wb-entry { opacity: .5; }
.wb-status, .wb-notes { color: var(--bbi-ink-soft); font-size: 12px; overflow-wrap: anywhere; }
.wb-error { color: var(--bbi-danger, #c03949); overflow-wrap: anywhere; }
.wb-notes { padding-left: 18px; }
summary { cursor: pointer; padding: 7px 0; overflow-wrap: anywhere; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; max-height: 260px; overflow: auto; }
textarea { resize: vertical; }
@media (max-width: 480px) { .wb-fields { grid-template-columns: minmax(0, 1fr); } }
</style>
