import type { ImagePlan } from '@/autoTag/protocol';
import type { Orientation } from '@/backends/size';
import { applyMangaFrames, crossingSubjects, panelRefIndex, resolveLayout, resolveLayouts, slotType, type MangaSettings } from '@/manga/layouts';
import { parseImageTagContent, parseImageTags } from '@/st/imageTagRegex';
import type { ImagePromptPreset } from './model';
import { MangaTextError } from './mangaText';

export class MangaCompositionError extends MangaTextError {
  override correctionKind = '构图';
  override correctionInstruction = '按剧情与文字量选用已启用的版式。含多格人物页的一组配图至少使用一处清单中真实跨框的主体槽位，人物必须占用该槽位，不能只在 caption 中宣称出框。用连续人物的头发、饰物或动作局部遮住框线与格间，不新增漂浮部件，不遮挡相邻人物与文字。单幅或纯物件页无需出框。保留原文叙事文字及阅读顺序；不要把所有页面改成同一种版式。';
}

export function assertMangaComposition(
  plan: ImagePlan, preset: ImagePromptPreset | null, layoutOn: boolean,
  manga: MangaSettings, lockedSize?: Orientation | null,
): void {
  if (!layoutOn || preset?.mangaComposition !== 'expressive') return;
  let eligible = false, usedCrossing = false, available = false;
  for (const [index, image] of plan.images.entries()) {
    try {
      const root = JSON.parse(image.tag);
      const orientation = lockedSize ?? image.size;
      const layout = resolveLayout(manga, orientation, root?.layout);
      if (!layout) throw new Error('版式不存在或已停用');
      applyMangaFrames(image.tag, { ...manga, enabled: true }, layout.canvas);
      if (layout.panels.length < 2) continue;
      for (const item of root.items) {
        if (item.label !== 'character') continue;
        eligible = true;
        const panel = panelRefIndex(layout, item.panel);
        const slot = typeof item.slot === 'string' ? item.slot.trim().toUpperCase() : '';
        if (panel && crossingSubjects(panel).includes(slot)) usedCrossing = true;
      }
      available ||= resolveLayouts(manga, orientation).some(candidate =>
        candidate.panels.length > 1 && candidate.panels.some(panel => crossingSubjects(panel).length));
    } catch (error) {
      throw new MangaCompositionError(`第 ${index + 1} 页构图无效：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!eligible || usedCrossing) return;
  if (!available) throw new MangaCompositionError('当前方向没有可用的跨框人物版式；请导入并启用跨框版式，或将漫画构图改为「按剧情安排」。');
  throw new MangaCompositionError('本组多格人物页未使用实际跨框主体区域；普通格内人物加上出框形容词仍不算跨框。');
}

export function recentMangaLayouts(
  chat: { mes: string; is_user?: boolean; is_system?: boolean }[], targetFloor: number, limit = 4,
): string[] {
  if (limit <= 0) return [];
  const ids: string[] = [];
  for (let i = Math.min(targetFloor, chat.length) - 1; i >= 0 && ids.length < limit; i--) {
    const message = chat[i];
    if (message.is_user || message.is_system) continue;
    for (const tag of parseImageTags(message.mes).reverse()) {
      try {
        const root = JSON.parse(parseImageTagContent(tag).tag);
        if (typeof root.layout === 'string' && root.layout.trim()) ids.push(root.layout.trim());
      } catch { /* Historical non-layout tags are not composition history. */ }
      if (ids.length === limit) break;
    }
  }
  return ids.reverse();
}

export function buildCompositionBrief(manga: MangaSettings, lockedSize?: Orientation | null, recent: string[] = []): string {
  const orientations: Orientation[] = lockedSize ? [lockedSize] : ['portrait', 'landscape'];
  const capabilities = orientations.flatMap(orientation => resolveLayouts(manga, orientation).map(layout => {
    const panels = layout.panels.map((panel, i) => {
      const crossing = crossingSubjects(panel);
      const text = Object.keys(panel.slots).filter(slot => ['T','TL','TR','B','BL','BR','ML','MR'].includes(slotType(slot)));
      return `${i + 1}:跨框主体=${crossing.join('/') || '无'},字区=${text.join('/') || '无'}`;
    });
    return `${orientation}/${layout.id} (${layout.panels.length}格)：${panels.join('；')}`;
  }));
  return `【叙事构图：按剧情选择，不固定格数】
先选一个短而完整的事件，再按起因、回应、情绪或动作落点安排镜头。景别与节拍要有区别，不用空景和重复正面头像凑格数。
文字先分配：按原文顺序选择连续短句，给每段文字留出独立字区，再放人物。长消息用能容纳消息的版式，不把全文硬塞进两三个气泡。不能为塞字而遮脸、缩到不可读或改变原意。
${new MangaCompositionError().correctionInstruction}
最近实际版式（从旧到新）：${recent.length ? recent.join(' → ') : '暂无'}。这不是随机轮换，也不是禁止重复；相同节拍可复用，但不要因为上页用了某版式就机械沿用。
局部出框只服务于关键动作或情绪。跨框部位与身体必须连续，遮住边框和一小段白色格间；场景背景仍在各自格内。避免整个人物像剪贴纸覆盖整页。普通面板仍保留清晰留白与阅读路径。
根据版式越线方向安排景别与姿态：向上出框可用头顶、发饰或举起的手；侧向出框优先使用原文动作中的手臂、袖口、围巾等自然伸出的轮廓，不机械地要求居中的短发去碰很远的侧边。跨框主体要实际占据边缘，不留一圈空白把它缩回格内。选择符合原文的姿态，不为了出框新增情节或道具。
以下能力由当前启用版式的实际坐标生成；选择前同时参考完整清单中的用途与槽位说明：
${capabilities.join('\n')}`;
}
