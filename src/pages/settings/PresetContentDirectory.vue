<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import type { ImagePromptPreset } from '@/presets/model';
import type { PresetRules, RuleKey } from '@/presets/rules';
import { ruleSummary } from './presetEditor';

defineProps<{
  preset: ImagePromptPreset;
  rules: PresetRules;
  builtinRules: Record<RuleKey, string>;
  target: { label: string; spec: RuleKey; check: RuleKey };
  variableCount: number;
  hasPreview: boolean;
}>();
defineEmits<{ navigate: [panel: string, entryId?: string, section?: string] }>();
</script>

<template>
  <nav class="pd-directory" aria-label="预设完整内容目录">
    <div class="pd-heading"><strong>内容目录</strong><span>草稿 · {{ target.label }}</span></div>
    <ul>
      <li v-for="item in preset.entries" :key="item.id">
        <button type="button" @click="$emit('navigate', 'content', item.id)">
          <span><Icon name="prompt" /><span>{{ item.name || '未命名条目' }}</span></span>
          <span class="pd-meta">{{ item.enabled ? '开启' : '停用' }} · {{ item.trigger === 'keywords' ? '关键词条件 · ' : '' }}{{ Array.from(item.content).length }} 字<Icon name="navigate" /></span>
        </button>
      </li>
      <li v-if="!preset.entries.length" class="pd-empty">画面要求 · 无额外条目</li>
      <li v-for="item in [{ key: target.spec, title: '书写规范', section: 'ip-current-spec' }, { key: target.check, title: '检查指导', section: 'ip-current-check' }, { key: 'jailbreak' as const, title: '通用前置规则', section: 'ip-prefix' }]" :key="item.key">
        <button type="button" @click="$emit('navigate', item.key === 'jailbreak' ? 'advanced' : 'rules', '', item.section)">
          <span><Icon name="summary" /><span>{{ item.title }}</span></span>
          <span class="pd-meta">{{ ruleSummary(rules[item.key], builtinRules[item.key]) }}<Icon name="navigate" /></span>
        </button>
      </li>
      <li><button type="button" @click="$emit('navigate', 'advanced')"><span><Icon name="settings" /><span>输出设置</span></span><span class="pd-meta">{{ preset.output === 'tool' ? '工具输出' : '普通文本' }} · {{ preset.format === 'moss_layout' ? 'MOSS Layout' : '跟随后端' }}<Icon name="navigate" /></span></button></li>
      <li><button type="button" @click="$emit('navigate', 'advanced', '', 'ip-lettering')"><span><Icon name="edit" /><span>漫画文字</span></span><span class="pd-meta">{{ preset.mangaText === 'required' ? '必须有叙事文字' : '按剧情安排' }}{{ target.spec !== 'mangaSpec' ? ' · 当前未启用漫画' : '' }}<Icon name="navigate" /></span></button></li>
      <li><button type="button" @click="$emit('navigate', 'advanced', '', 'ip-custom-variables')"><span><Icon name="vars" /><span>自定义变量</span></span><span class="pd-meta">{{ variableCount }} 个<Icon name="navigate" /></span></button></li>
      <li><button type="button" @click="$emit('navigate', 'external')"><span><Icon name="comfyui" /><span>外部附加 · 版式设置</span></span><span class="pd-meta">只读 · {{ target.spec === 'mangaSpec' ? '当前漫画版式' : '当前未启用漫画' }}<Icon name="navigate" /></span></button></li>
      <li><button type="button" @click="$emit('navigate', 'external')"><span><Icon name="summary" /><span>外部附加 · 固定协议</span></span><span class="pd-meta">只读 · 插件生成<Icon name="navigate" /></span></button></li>
      <li><button type="button" @click="$emit('navigate', 'external')"><span><Icon name="characters" /><span>外部附加 · 剧情上下文</span></span><span class="pd-meta">{{ hasPreview ? '已有本地预览' : '本地检查后可见' }}<Icon name="navigate" /></span></button></li>
    </ul>
  </nav>
</template>

<style scoped>
.pd-directory { margin: 12px 0; min-width: 0; border-block: 1px solid var(--bbi-line); }
.pd-heading { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 12px; padding: 10px 0; }
.pd-heading > span, .pd-meta, .pd-empty { color: var(--bbi-ink-muted); font-size: 12px; }
ul { list-style: none; padding: 0; margin: 0; }
li { min-width: 0; }
li + li { border-top: 1px solid var(--bbi-line); }
button { width: 100%; min-width: 0; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 12px; border: 0; background: transparent; color: inherit; font: inherit; text-align: start; padding: 9px 4px; cursor: pointer; border-radius: 4px; }
button > span { display: flex; align-items: center; gap: 6px; min-width: 0; overflow-wrap: anywhere; }
button > span:first-child { flex: 1 1 180px; }
button > span:first-child > span { min-width: 0; }
.pd-meta { flex: 0 1 auto; }
.pd-meta svg { flex-shrink: 0; }
button:hover { background: var(--bbi-surface-hover, var(--bbi-line)); }
button:focus-visible { outline: 2px solid var(--bbi-accent); outline-offset: -2px; }
button:disabled { opacity: .65; cursor: default; }
.pd-empty { padding: 9px 4px; }
@media (max-width: 460px) {
  button > span:first-child { flex-basis: 100%; }
  .pd-meta { margin-left: 24px; }
}
</style>
