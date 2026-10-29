import type { ImagePlan } from '@/autoTag/protocol';
import type { Orientation } from '@/backends/size';
import { applyMangaFrames, resolveLayout, type MangaSettings } from '@/manga/layouts';
import { parseImageTagContent, parseImageTags } from '@/st/imageTagRegex';
import type { ImagePromptPreset } from './model';
import { MangaTextError } from './mangaText';

export class MangaCompositionError extends MangaTextError {
  override correctionKind = '构图';
  override correctionInstruction = '按剧情与文字量选用已启用、尺寸匹配的版式，只引用该格真实存在的主体与字区。保留原文叙事文字、人物连续性与阅读顺序。不强制出框，不为视觉效果新增情节、人物或槽位。';
}

export function assertMangaComposition(
  plan: ImagePlan, preset: ImagePromptPreset | null, layoutOn: boolean,
  manga: MangaSettings, lockedSize?: Orientation | null,
): void {
  if (!layoutOn || preset?.mangaComposition !== 'expressive') return;
  for (const [index, image] of plan.images.entries()) {
    try {
      const root = JSON.parse(image.tag);
      const orientation = lockedSize ?? image.size;
      const layout = resolveLayout(manga, orientation, root?.layout);
      if (!layout) throw new Error('版式不存在或已停用');
      applyMangaFrames(image.tag, { ...manga, enabled: true }, layout.canvas);
    } catch (error) {
      throw new MangaCompositionError(`第 ${index + 1} 页构图无效：${error instanceof Error ? error.message : String(error)}`);
    }
  }
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

export function buildCompositionBrief(_manga: MangaSettings, _lockedSize?: Orientation | null, recent: string[] = []): string {
  return `【整页叙事：连贯、生动、有主次】
先从正文选择一个短而完整的事件，确定情绪或动作落点，再按起因、互动与回应安排镜头。整页共同讲一件事，不把几张互不关联的插画填进格子；不强制固定格数。
突出一个主要画面，其他格补充必要动作、反应或细节。相邻格保留角色外貌、服装、场景方位和动作因果；按叙事需要变化景别、视角与人物占比，不用重复正脸或无关空景凑格。
先安排原文文字与阅读路径，再选清单中容量适合的版式和字区。文字、人物视线与动作共同引导阅读，保留舒服的格间与留白，不遮脸、缩字硬塞或编造台词。
关键画面有清晰的表情、自然的肢体与服装细节，环境保留与剧情有关的空间和光影层次；反应格可适当简化背景。丰富不等于装饰堆满，避免整页平光、同一景别或每格独立摆拍。
不强制出框。出框、嵌入与重叠仅在当前版式允许且确实服务动作或情绪时使用；不用也能形成完整漫画。使用时保持身体连接与前后遮挡，不牺牲分格、文字或人物关系。
最近实际版式（从旧到新）：${recent.length ? recent.join(' → ') : '暂无'}。这不是随机轮换，也不是禁止重复；按本次事件选择，不机械沿用。
版式、方向和可用槽位只以本次版式清单为准，不新增坐标或不存在的区域。`;
}
