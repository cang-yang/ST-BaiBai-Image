import type { ChatMsg } from '@/api/client';
import type { ImagePlan } from '@/autoTag/protocol';
import { applyMangaFrames, resolveLayout, slotType, type MangaSettings } from '@/manga/layouts';
import type { Orientation } from '@/backends/size';
import type { ImagePromptPreset } from './model';

export const MANGA_TEXT_REQUIREMENT = `【漫画文字要求：必须有叙事文字】
每一页至少包含一个非空的叙事 text 项，不能用拟声、招牌、姓名牌代替。先从目标正文选择长度合适的连续短事件与原文文字，再安排镜头、人物和合法字区。
现场对白使用 speech bubble / spoken by，心理使用 thought bubble，旁白使用 narration box，聊天消息使用 chat message box / text message box；在 text.caption 中明确对应类型。text 保存实际中文，caption 标明 Chinese lettering, reproduce the supplied text verbatim。
保留文字的来源、归属、顺序与含义。消息不是现场口述，心理不是对白；不得编造台词。没有现场对白时，可选择原文明示的心理、消息或原文叙事句作为旁白，不能将动作描述冒充角色发言。
不得为减少排版工作而选择整页静默、隐藏关键消息、把重要屏幕文字改为 unreadable / illegible / blank。消息可放在独立的清晰展示框中，并明确来自手机消息，不强塞进倾斜的小屏幕。
文字过长时，先选择更短但完整的事件，或调整合法版式与字区；同一发言内不要跳句拼接，不删关键回应，不以几句无关文字凑数。每页完成后检查文字项与可读性；只提交最终完整配图计划。`;

export class MangaTextError extends Error {}
/** Terminal for the operation, even when the caller has general retries enabled. */
export class MangaTextCorrectionError extends Error {}

const narrative = /\b(?:spoken\s+by|speech\s+bubble|thought\s+bubble|narration(?:\s+box)?|(?:chat|text)\s+message(?:\s+(?:box|bubble))?|message\s+(?:box|bubble))\b|对白|心理|旁白|聊天消息/i;
const textSlots = new Set(['T', 'TL', 'TR', 'B', 'BL', 'BR', 'ML', 'MR']);

export function assertMangaText(
  plan: ImagePlan,
  preset: ImagePromptPreset | null,
  layoutOn: boolean,
  manga: MangaSettings,
  lockedSize?: Orientation | null,
): void {
  if (!layoutOn || preset?.mangaText !== 'required') return;
  for (const [index, image] of plan.images.entries()) {
    const prefix = `第 ${index + 1} 页`;
    let root: any;
    try { root = JSON.parse(image.tag); } catch { throw new MangaTextError(`${prefix}漫画 Layout 无效，无法检查文字`); }
    if (!root || !Array.isArray(root.items)) throw new MangaTextError(`${prefix}漫画 Layout 缺少 items`);
    const layout = resolveLayout(manga, lockedSize ?? image.size, root.layout);
    if (!layout) throw new MangaTextError(`${prefix}版式不存在或已停用`);
    try { applyMangaFrames(image.tag, { ...manga, enabled: true }, layout.canvas); }
    catch (error) { throw new MangaTextError(`${prefix}版式校验失败：${error instanceof Error ? error.message : String(error)}`); }
    const lettering = root.items.filter((item: any) => item?.label === 'text' && typeof item.text === 'string' && item.text.trim());
    for (const item of lettering) {
      if (typeof item.slot !== 'string' || !textSlots.has(slotType(item.slot.trim().toUpperCase()))) {
        throw new MangaTextError(`${prefix}文字未放在合法字区`);
      }
    }
    if (!lettering.some((item: any) => typeof item.caption === 'string' && narrative.test(item.caption))) {
      throw new MangaTextError(`${prefix}缺少叙事文字：需要原文对白、心理、旁白或聊天消息，不能仅有拟声或标牌`);
    }
  }
}

type Send = (messages: ChatMsg[], source: string, validate: (raw: string) => void) => Promise<string>;

export async function withMangaTextCorrection(
  messages: ChatMsg[], source: string, signal: AbortSignal | undefined,
  send: Send, validate: (raw: string) => void,
): Promise<string> {
  signal?.throwIfAborted();
  try { return await send(messages, source, validate); }
  catch (error) {
    signal?.throwIfAborted();
    if (!(error instanceof MangaTextError)) throw error;
    const correction: ChatMsg = { role: 'user', content:
      `漫画文字检查未通过：${error.message}\n这是唯一一次文字补正。依据上面的目标正文重新提交完整配图计划，每页至少一个有原文依据的叙事 text，分配合法字区并明确文字类型。不要编造台词，不输出解释或推理，不把关键文字改成不可读。` };
    try {
      return await send([...messages, correction], `${source} · 文字补正 1/1`, validate);
    } catch (lastError) {
      signal?.throwIfAborted();
      throw new MangaTextCorrectionError(`文字补正未通过，已停止生图：${lastError instanceof Error ? lastError.message : String(lastError)}`);
    }
  }
}
