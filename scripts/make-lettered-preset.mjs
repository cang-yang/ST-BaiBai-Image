import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/make-lettered-preset.mjs input.json output.json');
const file = JSON.parse(await readFile(input, 'utf8'));
const preset = file.preset;
if (file.format !== 'baibai_image_prompt_preset' || preset?.entries?.length !== 1 ||
    preset.entries[0].name !== '原生 ToolCall 提交') throw new Error('Expected the original combined cute manga preset');
const parts = preset.entries[0].content.split('\n\n');
if (parts.length !== 3 || !parts[1].startsWith('画风偏好：')) throw new Error('Unexpected source entry; preserve it and review manually');
const entry = (name, content) => ({
  id: randomUUID(), name, content, enabled: true, role: 'system', trigger: 'always', keywords: '', andKeywords: '',
});
preset.name = 'MOSS 漫画 · 可爱叙事有字版';
preset.description = '可爱二次元画风；先选原文叙事文字再编排分镜，使用实际出框区域。原版规范保留，新增取材与文字检查说明。';
preset.mangaText = 'required';
preset.entries = [
  entry('可爱二次元画风', parts[1]),
  entry('漫画叙事与原文文字', `创作目标是能阅读的叙事漫画，不是把人物插画放进格框。先选择目标正文中一个完整、长度合适的信息或情绪变化，确定要呈现的原文对白、心理、消息或叙事句，再安排镜头。
在不改变剧情的前提下，让各格承担不同任务：交代情境、呈现行动或信息、表现反应与落点。避免连续两页都采用“环境空镜、手机局部、静态人物大像”的重复组织。
每页保留有原文依据的叙事文字。说出的话、心里想的话、收到的消息与旁白保持各自性质，不混为现场对白。聊天可用独立的消息展示框，不必挤进手机屏幕；没有对白时可用原文完整叙事句作旁白。不要凭空添加台词，也不要为了规避文字而选取整页静默场景。`),
  entry('分镜与真实出框', `根据事件与文字容量选择版式，不固定每页三格。适合单主角叙事时优先使用当前清单中的 baibai_breakout_3；它不适合时选择其他容量足够的版式。
只有当前清单明确标记为跨格的实际主体区域，才要求人物跨框。caption 无法扩大坐标，不能在普通格内的 S 槽位声称头发会越过上框。若没有合适跨格区域，优先保证叙事与文字，不虚写出框。
出框人物保持连续形体，只让头发、头饰或肩部等局部越界，在主体与相邻背景中分别交代遮挡边框和白色格间的关系，不遮挡面孔、对白和关键动作。画面用具体的线条、发束高光、衣料褶皱、局部受光和前中后景表达精致感，不靠堆叠质量词。`),
];
const clarification = `\n\n## 本预设补充：有字叙事的取材顺序

“静默格允许无文字”不等于允许整页逃避叙事文字。先确定本页原文事件与要展示的文字，再确定版式。原文没有现场对白时，明确的心理、手机消息和原文叙事句仍可作为各自类型的 text。
连续对白保真规则针对本页选择的完整发言；旁白可选原文中语义完整、自足且与画面一致的连续句子，不要求复制整段长篇心理。不得抽取缺少上下文的半句，不跳句拼接改变含义，也不把心理或消息冒充说出口的话。
重要聊天内容不使用不可读、空白或故意背向镜头的处理来规避文字；可放入独立消息展示框并标明来源。每页先安排足够的合法文字区域，再取景，材料不足时不要编造台词。`;
if (preset.rules?.mangaSpec?.mode !== 'custom' || preset.rules?.mangaThinking?.mode !== 'custom') {
  throw new Error('Expected independently owned author rules');
}
preset.rules.mangaSpec.text += clarification;
preset.rules.mangaThinking.text += '\n\n本预设追加检查：每页是否有非空叙事文字，而非仅拟声或标牌；是否忠于原文并区分对白、心理、旁白与消息；是否为省事把关键屏幕内容改成不可读；文字是否进入本格合法字区；出框描述是否有实际跨格区域支持。仅在内部检查，不输出草稿与逐格推理。';
await writeFile(output, JSON.stringify(file, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ name: preset.name, entries: preset.entries.map(e => e.name), mangaText: preset.mangaText, output }));
