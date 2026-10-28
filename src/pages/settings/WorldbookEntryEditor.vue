<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Icon from '@/components/Icon.vue';
import { compatibilityWarnings, generationTriggers, parseEntry, type ImageWorldEntry } from '@/worldbook/model';

const props = defineProps<{ entry: ImageWorldEntry }>();
const emit = defineEmits<{ save: [entry: ImageWorldEntry]; close: [] }>();
const draft = ref<ImageWorldEntry>(JSON.parse(JSON.stringify(props.entry)));
const keys = ref(''), secondary = ref(''), json = ref(''), error = ref('');
const tab = ref('rules');
watch(() => props.entry, value => {
  draft.value = JSON.parse(JSON.stringify(value));
  keys.value = value.key.join('\n');
  secondary.value = value.keysecondary.join('\n');
  json.value = JSON.stringify(value, null, 2);
  error.value = '';
  tab.value = 'rules';
}, { immediate: true });
const warnings = computed(() => compatibilityWarnings(draft.value));
const state = computed({
  get: () => draft.value.disable ? 'disabled' : draft.value.constant ? 'constant' : 'keyword',
  set: (v: string) => { draft.value.disable = v === 'disabled'; draft.value.constant = v === 'constant'; },
});
const numericFields = [
  ['order', '排列优先级', false, '酒馆原版的插入顺序；数值较大的条目先参与预算筛选。'],
  ['probability', '使用概率 %', false, '关键词满足后，按这个概率决定是否使用。'],
  ['scanDepth', '往前查看几条消息', true, '扫描深度；留空沿用整本书的设置。'],
  ['depth', '距副请求末尾几条消息', false, '仅“按消息位置插入”使用；不会改变主聊天。'],
  ['sticky', '命中后继续使用几条消息', true, '原版黏性（Sticky）。'],
  ['cooldown', '使用后间隔几条消息', true, '原版冷却（Cooldown）；黏性结束后开始冷却。'],
  ['delay', '聊天满几条消息后可用', true, '原版延迟（Delay）。'],
  ['groupWeight', '同组抽选权重', false, '多个同组条目同时满足时，权重越大越容易被抽中。'],
] as const;
const booleanFields = [
  ['selective', '检查附加关键词'], ['useProbability', '按概率使用'],
  ['excludeRecursion', '不被其他条目触发'], ['preventRecursion', '不触发其他条目'],
  ['ignoreBudget', '不受字数预算限制'], ['groupOverride', '同组优先使用本条'],
  ['matchPersonaDescription', '扫描用户人设'], ['matchCharacterDescription', '扫描角色描述'],
  ['matchCharacterPersonality', '扫描角色性格'], ['matchCharacterDepthPrompt', '扫描角色注释'],
  ['matchScenario', '扫描情景'], ['matchCreatorNotes', '扫描创作者注释'],
] as const;
const nullableFields = [
  ['caseSensitive', '英文区分大小写'], ['matchWholeWords', '只匹配完整词语'], ['useGroupScoring', '同组优先选匹配更多的'],
] as const;
const positions = ['角色参考之前', '角色参考之后', '任务正文之前（前）', '任务正文之前（后）', '按消息位置插入', '示例参考之前', '示例参考之后', '仅供命名占位符引用'];
function numberValue(key: string, event: Event, nullable: boolean): void {
  const value = (event.target as HTMLInputElement).value;
  draft.value[key] = value === '' && nullable ? null : Math.max(0, Number(value));
}
function flagValue(key: string, event: Event): void {
  draft.value[key] = (event.target as HTMLInputElement).checked;
}
function nullableValue(key: string, event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  draft.value[key] = value === '' ? null : value === 'true';
}
function syncKeys(): void {
  draft.value.key = keys.value.split('\n').map(k => k.trim()).filter(Boolean);
  draft.value.keysecondary = secondary.value.split('\n').map(k => k.trim()).filter(Boolean);
}
function switchTab(value: string): void {
  try {
    if (tab.value === 'json') {
      draft.value = parseEntry(JSON.parse(json.value), props.entry.uid);
      keys.value = draft.value.key.join('\n'); secondary.value = draft.value.keysecondary.join('\n');
    } else {
      syncKeys(); json.value = JSON.stringify(draft.value, null, 2);
    }
    error.value = ''; tab.value = value;
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
}
function save(): void {
  try {
    syncKeys();
    const entry = parseEntry(tab.value === 'json' ? JSON.parse(json.value) : draft.value, props.entry.uid);
    if (entry.uid !== props.entry.uid) throw new Error('不能修改现有条目的 uid');
    emit('save', entry);
    error.value = '';
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
}
</script>

<template>
  <section class="wb-editor" aria-label="世界书条目编辑">
    <header class="wb-toolbar">
      <strong>条目 {{ entry.uid }}</strong>
      <div class="wb-tabs" role="tablist">
        <button type="button" role="tab" :aria-selected="tab === 'rules'" @click="switchTab('rules')">内容与触发</button>
        <button type="button" role="tab" :aria-selected="tab === 'advanced'" @click="switchTab('advanced')">高级设置</button>
      </div>
      <button class="bbi-btn bbi-btn-sm" type="button" title="关闭编辑" @click="emit('close')"><Icon name="close" /></button>
    </header>
    <template v-if="tab !== 'json'">
      <template v-if="tab === 'rules'">
      <div class="wb-fields">
        <label>标题<input v-model="draft.comment" class="bbi-input" /></label>
        <label>什么时候使用<select v-model="state" class="bbi-input"><option value="keyword">出现关键词时</option><option value="constant">始终使用</option><option value="disabled">暂不使用</option></select></label>
      </div>
      <label v-if="state === 'keyword'" class="wb-content">触发词 · 每行一个<textarea v-model="keys" class="bbi-input" rows="3" placeholder="例如：雨天" /></label>
      <label class="wb-content">正文<textarea v-model="draft.content" class="bbi-input" rows="9" /></label>
      </template>
      <template v-else>
        <label class="wb-content">附加关键词 · 每行一个<textarea v-model="secondary" class="bbi-input" rows="3" /></label>
        <label class="wb-content">附加条件<select v-model.number="draft.selectiveLogic" class="bbi-input" title="依次对应原版 AND ANY / NOT ALL / NOT ANY / AND ALL"><option :value="0">附加词至少出现一个</option><option :value="1">附加词不能全部出现</option><option :value="2">附加词一个都不能出现</option><option :value="3">附加词必须全部出现</option></select></label>
        <div class="wb-fields">
          <label>放到副请求哪里<select v-model.number="draft.position" class="bbi-input"><option v-for="(label, i) in positions" :key="i" :value="i">{{ label }}</option></select></label>
          <label v-if="draft.position === 4">消息身份<select v-model.number="draft.role" class="bbi-input"><option :value="0">规则（System）</option><option :value="1">用户（User）</option><option :value="2">助手（Assistant）</option></select></label>
          <label v-if="draft.position === 7">占位符名称<input v-model="draft.outletName" class="bbi-input" title="Outlet 名称" /></label>
        </div>
        <details>
        <summary>次数、概率与消息范围</summary>
        <div class="wb-fields">
          <label v-for="[key, label, nullable, help] in numericFields" :key="key" :title="help">{{ label }}
            <input class="bbi-input" type="number" min="0" :max="key === 'probability' ? 100 : undefined" :placeholder="nullable ? '沿用默认' : ''" :value="draft[key] ?? ''" @input="numberValue(key, $event, nullable)" />
          </label>
        </div>
        </details>
        <details>
        <summary>匹配方式与条目联动</summary>
        <div class="wb-fields">
          <label v-for="[key, label] in nullableFields" :key="key">{{ label }}
            <select class="bbi-input" :value="draft[key] === null ? '' : String(draft[key])" @change="nullableValue(key, $event)"><option value="">沿用默认</option><option value="true">开启</option><option value="false">关闭</option></select>
          </label>
          <label title="同组条目同时满足时按酒馆原版规则抽选。">互斥分组名称<input v-model="draft.group" class="bbi-input" /></label>
          <label title="原版 delayUntilRecursion；0 表示不等待。">等待第几轮联动<input class="bbi-input" type="number" min="0" :value="Number(draft.delayUntilRecursion)" @input="numberValue('delayUntilRecursion', $event, false)" /></label>
        </div>
        <div class="wb-checks">
          <label v-for="[key, label] in booleanFields" :key="key"><input type="checkbox" :checked="Boolean(draft[key])" @change="flagValue(key, $event)" />{{ label }}</label>
        </div>
        </details>
        <details><summary>限定请求类型</summary><fieldset><legend>未选则不限</legend><div class="wb-checks"><label v-for="trigger in generationTriggers" :key="trigger"><input v-model="draft.triggers" type="checkbox" :value="trigger" />{{ ({normal:'普通生成',continue:'继续生成',impersonate:'代用户发言',swipe:'换一版',regenerate:'重新生成',quiet:'后台生成'} as Record<string,string>)[trigger] }}</label></div></fieldset></details>
        <button class="bbi-btn bbi-btn-sm" type="button" @click="switchTab('json')"><Icon name="vars" />编辑原始数据</button>
      </template>
    </template>
    <textarea v-else v-model="json" class="bbi-input wb-json" rows="18" aria-label="条目完整 JSON" spellcheck="false" />
    <ul v-if="warnings.length" class="wb-warning"><li v-for="warning in warnings" :key="warning">{{ warning }}</li></ul>
    <p v-if="error" role="alert" class="wb-error">{{ error }}</p>
    <footer class="wb-toolbar"><button type="button" class="bbi-btn bbi-btn-primary" @click="save"><Icon name="check" />保存条目</button><button type="button" class="bbi-btn" @click="emit('close')">放弃修改</button></footer>
  </section>
</template>

<style scoped>
.wb-editor { border-top: 1px solid var(--bbi-border); padding-top: 12px; display: grid; gap: 12px; min-width: 0; }
.wb-toolbar, .wb-tabs, .wb-checks { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wb-toolbar { justify-content: space-between; }
.wb-tabs button { color: inherit; background: transparent; border: 0; padding: 6px 10px; cursor: pointer; border-bottom: 2px solid transparent; }
.wb-tabs button[aria-selected="true"] { border-color: currentColor; }
.wb-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }
.wb-fields label, .wb-content { display: grid; gap: 5px; min-width: 0; font-size: 12px; }
.wb-checks { margin: 10px 0; }
.wb-checks label { display: flex; align-items: center; gap: 5px; font-size: 12px; }
.bbi-input { width: 100%; min-width: 0; box-sizing: border-box; }
textarea { resize: vertical; }
.wb-json { font-family: monospace; }
.wb-warning { font-size: 12px; color: var(--bbi-ink-soft); padding-left: 18px; overflow-wrap: anywhere; }
.wb-error { color: var(--bbi-danger, #c03949); overflow-wrap: anywhere; }
summary { cursor: pointer; padding: 6px 0; }
fieldset { border: 1px solid var(--bbi-border); min-width: 0; }
@media (max-width: 480px) { .wb-fields { grid-template-columns: minmax(0, 1fr); } }
</style>
