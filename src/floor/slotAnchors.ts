import { BBI_SLOT_SELECTOR } from '@/st/imageTagRegex';

const FALLBACK_SELECTOR = '[data-bbi-fallback]';

/**
 * iframe / 代码块美化会吞掉行内占位。数量不符时整楼按 tag 顺序在正文末尾显示，
 * 不把剩余占位与 tag 按少者配对：缺失的可能是第一张，直接配对会串图。
 * 只创建空占位，不把提示词或 iframe 内容复制进 DOM。
 */
export function resolveSlotAnchors(mesText: HTMLElement, tagCount: number): HTMLElement[] {
  let fallback = mesText.querySelector<HTMLElement>(FALLBACK_SELECTOR);
  const inline = [...mesText.querySelectorAll<HTMLElement>(BBI_SLOT_SELECTOR)].filter(
    anchor => !anchor.closest(FALLBACK_SELECTOR),
  );

  if (tagCount === 0 || inline.length === tagCount) {
    fallback?.remove();
    return tagCount === 0 ? [] : inline;
  }

  if (!fallback) {
    fallback = mesText.ownerDocument.createElement('div');
    fallback.setAttribute('data-bbi-fallback', '');
    fallback.setAttribute('role', 'group');
    fallback.setAttribute('aria-label', '柏宝绘配图');
    fallback.style.setProperty('display', 'block', 'important');
    fallback.style.marginTop = '0.75em';
    mesText.appendChild(fallback);
  }

  const anchors = [...fallback.querySelectorAll<HTMLElement>(BBI_SLOT_SELECTOR)];
  while (anchors.length > tagCount) anchors.pop()!.remove();
  while (anchors.length < tagCount) {
    const anchor = mesText.ownerDocument.createElement('div');
    anchor.setAttribute('data-bbi-slot', '');
    fallback.appendChild(anchor);
    anchors.push(anchor);
  }
  return anchors;
}
