import type { ChatMsg } from '@/api/client';
import type { STContext } from '@/st/context';
import { createNativeScanner } from './vendor/scanner';
import {
  compatibilityWarnings, normalizeImageWorldbooks, normalizeScan, parseEntry, scanDefaults,
  type ImageWorldbookSettings, type ImageWorldEntry, type ScanSettings,
} from './model';

export interface ActivatedEntry extends ImageWorldEntry { world: string; bookName: string }
export interface WorldbookScanResult {
  worldInfoBefore: string;
  worldInfoAfter: string;
  EMEntries: Array<{ position: number; content: string }>;
  WIDepthEntries: Array<{ depth: number; role: number; entries: string[] }>;
  ANBeforeEntries: string[];
  ANAfterEntries: string[];
  outletEntries: Record<string, string[]>;
  allActivatedEntries: Set<ActivatedEntry>;
  warnings: string[];
  rounds: Array<{ loop: number; candidates: number; accepted: number; overflow: boolean }>;
  tokens: number;
  estimatedTokens: boolean;
  metadata: Record<string, unknown>;
}
export const emptyScan = (): WorldbookScanResult => ({
  worldInfoBefore: '', worldInfoAfter: '', EMEntries: [], WIDepthEntries: [],
  ANBeforeEntries: [], ANAfterEntries: [], outletEntries: {}, allActivatedEntries: new Set(),
  warnings: [], rounds: [], tokens: 0, estimatedTokens: true, metadata: {},
});
export async function readHostScanSettings(): Promise<ScanSettings | null> {
  try {
    const path = '/scripts/world-info.js';
    const mod = await import(/* @vite-ignore */ path);
    return typeof mod.getWorldInfoSettings === 'function' ? normalizeScan(mod.getWorldInfoSettings()) : null;
  } catch { return null; }
}

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
function plain(value: unknown): string { return typeof value === 'string' ? value : ''; }
function readVariable(source: unknown, name: string): string {
  if (!source || typeof source !== 'object' || !Object.hasOwn(source, name)) return '';
  const value = (source as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
}

export interface ScanInput {
  context: STContext;
  targetFloor: number;
  config: ImageWorldbookSettings;
  inherited?: ScanSettings | null;
  metadata?: Record<string, unknown>;
  random?: () => number;
  countTokens?: (text: string) => Promise<number>;
}

/** Each call owns its native scanner, metadata, entry clones and event sink. */
export async function scanImageWorldbooks(input: ScanInput): Promise<WorldbookScanResult> {
  const { context, targetFloor } = input;
  const config = normalizeImageWorldbooks(JSON.parse(JSON.stringify(input.config)));
  if (!config.enabled || !config.books.some(b => b.enabled)) return emptyScan();
  const inherited = config.inherit ? (input.inherited === undefined ? await readHostScanSettings() : input.inherited) : null;
  const scan = config.inherit ? inherited ?? scanDefaults() : normalizeScan(config.scan);
  const warnings: string[] = [];
  if (config.inherit && !inherited) warnings.push('无法读取酒馆扫描设置，本次使用原版默认扫描设置。');
  const metadata = JSON.parse(JSON.stringify(input.metadata ?? {}));
  const rounds: WorldbookScanResult['rounds'] = [];
  const character: Record<string, unknown> = context.characters?.[Number(context.characterId)] ?? {};
  const data = character.data as Record<string, unknown> | undefined;
  const extensions = data?.extensions as Record<string, unknown> | undefined;
  const depthPrompt = extensions?.depth_prompt as Record<string, unknown> | undefined;
  const persona = context.substituteParams?.('{{persona}}') ?? '';
  const macros: Record<string, string> = {
    char: context.name2, user: context.name1, persona: persona === '{{persona}}' ? '' : persona,
    description: plain(character.description), personality: plain(character.personality), scenario: plain(character.scenario),
  };
  // Do not run host macro evaluators on imported text: setvar/EJS would escape isolation.
  const substitute = (text: string): string => text.replace(/\{\{([^{}]+)\}\}/g, (original, raw: string) => {
    const name = raw.trim().toLowerCase();
    if (Object.hasOwn(macros, name)) return macros[name];
    if (/^getvar::/i.test(raw)) return readVariable(context.chatMetadata.variables, raw.slice(raw.indexOf('::') + 2).trim());
    if (/^getglobalvar::/i.test(raw)) {
      const variables = context.extensionSettings?.variables as { global?: unknown } | undefined;
      return readVariable(variables?.global, raw.slice(raw.indexOf('::') + 2).trim());
    }
    return original;
  });
  const entries: ActivatedEntry[] = [];
  const countTokens = input.countTokens ?? context.getTokenCountAsync ?? (async (s: string) => Math.ceil(s.length / 4));
  const quiet = () => undefined;
  const native = createNativeScanner({
    ...scan,
    world_info_overflow_alert: false,
    getContext: () => ({ extensionPrompts: {}, tagMap: (context as STContext & { tagMap?: unknown }).tagMap ?? {} }),
    substituteParams: substitute,
    chat_metadata: metadata,
    this_chid: context.characterId,
    getCharaFilename: () => plain(character.avatar).replace(/\.[^.]+$/, ''),
    getTagKeyForEntity: () => character.avatar,
    getSortedEntries: async () => entries,
    getTokenCountAsync: countTokens,
    getRegexedString: (text: string) => text,
    getExtensionPromptByName: async () => '',
    eventSource: { emit: async (_type: string, args: { state: { loopCount: number }; new: { all: unknown[] }; activated: { entries: Map<unknown, unknown> }; budget: { overflowed: boolean } }) => {
      if (args.state.loopCount > 2000) throw new Error('生图世界书扫描超过安全轮数，请检查递归与最少激活数。');
      rounds.push({ loop: args.state.loopCount, candidates: args.new.all.length, accepted: args.activated.entries.size, overflow: args.budget.overflowed });
    } },
    event_types: { WORLDINFO_SCAN_DONE: 'private-worldbook-scan' },
    extension_settings: {}, NOTE_MODULE_NAME: '', metadata_keys: {}, shouldWIAddPrompt: false,
    extension_prompt_roles: { SYSTEM: 0 }, regex_placement: { WORLD_INFO: 0 },
    toastr: { warning: quiet }, console: { debug: quiet, log: quiet, warn: quiet, error: quiet },
    Math: { ...Math, round: Math.round, max: Math.max, random: input.random ?? Math.random },
  });
  for (const book of config.books.filter(b => b.enabled)) {
    for (const [id, raw] of Object.entries(book.document.entries)) {
      const entry = parseEntry(raw, Number(id));
      if (!entry.disable) warnings.push(...compatibilityWarnings(entry).map(note => `${book.name} / ${entry.comment || entry.uid}：${note}`));
      const [decorators, content] = native.parseDecorators(entry.content);
      entries.push({ ...entry, world: book.id, bookName: book.name, hash: hash(JSON.stringify([book.id, entry])), decorators, content });
    }
  }
  entries.sort((a, b) => b.order - a.order);
  // Native scanner expects newest message first; timers count all visible messages.
  const messages = context.chat.slice(0, targetFloor + 1).filter(m => !m.is_system).reverse().map(m => {
    const content = m.mes ?? '';
    return scan.world_info_include_names ? `${m.name || (m.is_user ? context.name1 : context.name2)}: ${content}` : content;
  });
  const result = await native.checkWorldInfo(messages, config.contextSize, false, {
    trigger: config.trigger,
    personaDescription: macros.persona,
    characterDescription: macros.description,
    characterPersonality: macros.personality,
    characterDepthPrompt: plain(depthPrompt?.prompt),
    scenario: macros.scenario,
    creatorNotes: plain(data?.creator_notes ?? character.creator_notes),
  }) as WorldbookScanResult;
  const tokens = await countTokens([...result.allActivatedEntries].map(e => e.content).join('\n'));
  return { ...result, warnings: [...new Set(warnings)], rounds, tokens, estimatedTokens: !input.countTokens && !context.getTokenCountAsync, metadata };
}

/** Local equivalents of ST anchors; only the independent tag request is changed. */
export function injectImageWorldbooks(messages: ChatMsg[], result: WorldbookScanResult, characterIndex: number): ChatMsg[] {
  const out = messages.map(m => ({ ...m }));
  const system = (content: string): ChatMsg => ({ role: 'system', content });
  const before = [result.worldInfoBefore, ...result.EMEntries.filter(e => e.position === 0).map(e => e.content)].filter(Boolean);
  const after = [result.worldInfoAfter, ...result.EMEntries.filter(e => e.position === 1).map(e => e.content)].filter(Boolean);
  out.splice(characterIndex, 0, ...before.map(system));
  const userIndex = out.findLastIndex(m => m.role === 'user');
  out.splice(Math.max(0, userIndex), 0, ...after.map(system), ...result.ANBeforeEntries.filter(Boolean).map(system), ...result.ANAfterEntries.filter(Boolean).map(system));
  // Anchor all depth groups against the same request, so one group cannot shift another.
  const length = out.length;
  const depthInsertions = result.WIDepthEntries.map(group => ({
    index: Math.max(characterIndex, length - (group.depth ?? 4)),
    message: { role: (['system', 'user', 'assistant'] as const)[group.role ?? 0] ?? 'system', content: group.entries.join('\n') },
  }));
  for (const item of depthInsertions.sort((a, b) => b.index - a.index)) out.splice(item.index, 0, item.message);
  for (const message of out) {
    // DSH caches fixed rules; never cache a per-request outlet expansion there.
    if (message.purpose) continue;
    message.content = message.content.replace(/\{\{outlet::([^{}]+)\}\}/gi, (original, name: string) =>
      Object.hasOwn(result.outletEntries, name) ? result.outletEntries[name].join('\n') : original);
  }
  return out;
}
