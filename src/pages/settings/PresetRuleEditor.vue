<script setup lang="ts">
import { watch } from 'vue';
import { BUILTIN_RULES } from '@/presets/catalog';
import type { PromptRule, RuleKey } from '@/presets/rules';
import { ruleSummary } from './presetEditor';
const props = defineProps<{ rule: PromptRule; ruleKey: RuleKey; title: string }>();
watch(() => props.rule.mode, (value, old) => {
  if (value === 'custom' && old === 'builtin' && !props.rule.text) props.rule.text = BUILTIN_RULES[props.ruleKey];
});
</script>
<template>
  <div class="pr-rule">
    <label class="pr-row"><strong>{{ title }}</strong>
      <select v-model="rule.mode" class="bbi-input" :aria-label="`${title}来源`">
        <option value="builtin">内置参考</option><option value="custom">本预设自定义</option><option value="off">不附加</option>
      </select>
    </label>
    <p class="pr-source" role="status">{{ ruleSummary(rule, BUILTIN_RULES[ruleKey]) }}</p>
    <textarea v-if="rule.mode === 'custom'" v-model="rule.text" class="bbi-input" rows="8" :aria-label="`${title}内容`" spellcheck="false" />
    <details v-else-if="rule.mode === 'builtin'"><summary>查看内置内容</summary><pre>{{ BUILTIN_RULES[ruleKey] }}</pre></details>
    <span v-else class="pr-muted">已关闭</span>
  </div>
</template>
<style scoped>
.pr-rule { padding: 12px 0; border-bottom: 1px solid var(--bbi-line); min-width: 0; }
.pr-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; justify-content: space-between; margin-bottom: 8px; }
.pr-row select { width: auto; max-width: 100%; min-width: 150px; }
.pr-source { margin: 0 0 8px; font-size: 12px; color: var(--bbi-ink-muted); overflow-wrap: anywhere; }
textarea { width: 100%; box-sizing: border-box; resize: vertical; }
summary { cursor: pointer; font-size: 12px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 240px; overflow: auto; font-size: 12px; }
.pr-muted { font-size: 12px; opacity: .7; }
</style>
