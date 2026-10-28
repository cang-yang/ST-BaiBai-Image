import { shallowRef } from 'vue';
import { settings } from '@/state/settings';
import type { STContext } from '@/st/context';
import { emptyScan, scanImageWorldbooks, type WorldbookScanResult } from './engine';

const META_KEY = 'baibai_image_worldbook';
const queues = new WeakMap<object, Promise<unknown>>();
export const lastWorldbookScan = shallowRef<{ chatId?: string; floor: number; result: WorldbookScanResult }>();

/** Serialize only private timer updates; never lock or change the host's scanner. */
export async function fetchImageWorldbooks(context: STContext, floor: number): Promise<WorldbookScanResult> {
  if (!settings.imageWorldbooks.enabled || !settings.imageWorldbooks.books.some(b => b.enabled)) return emptyScan();
  const config = JSON.parse(JSON.stringify(settings.imageWorldbooks));
  const chatId = context.getCurrentChatId();
  const chatMetadata = context.chatMetadata;
  const capturedContext = { ...context, chat: context.chat.map(m => ({ ...m })), chatMetadata };
  const previous = queues.get(chatMetadata) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(async () => {
    const state = chatMetadata[META_KEY] as { floor?: number; effects?: Record<string, unknown> } | undefined;
    const result = await scanImageWorldbooks({ context: capturedContext, targetFloor: floor, config, metadata: state?.effects });
    // An older floor can be regenerated without rewinding newer private timer state.
    if ((floor >= (state?.floor ?? -1) || floor === capturedContext.chat.length - 1) && context.getCurrentChatId() === chatId) {
      chatMetadata[META_KEY] = { floor, effects: result.metadata };
      context.saveMetadataDebounced();
    }
    lastWorldbookScan.value = { chatId, floor, result };
    return result;
  });
  queues.set(chatMetadata, run);
  try { return await run; }
  finally { if (queues.get(chatMetadata) === run) queues.delete(chatMetadata); }
}

export function previewImageWorldbooks(context: STContext, floor: number): Promise<WorldbookScanResult> {
  const state = context.chatMetadata[META_KEY] as { effects?: Record<string, unknown> } | undefined;
  return scanImageWorldbooks({ context, targetFloor: floor, config: settings.imageWorldbooks, metadata: state?.effects });
}
