import { ApiError, requestCompletion, wireMessages, type ChatMsg, type DshSessionRequest, type RequestOptions } from '@/api/client';
import type { ApiChannel } from '@/state/settings';
import { getContext, type STContext } from '@/st/context';

const STORE='baibai_dsh_sessions';
interface Binding { session_id: string; initialized: boolean }
interface Pending { key: string; messages: ChatMsg[]; session: DshSessionRequest; channel: ApiChannel }
/** Kept by one runner invocation: ambiguous network retries reuse the exact request. */
export interface DshOperation { pending?: Pending; acknowledged?: boolean }
interface DshOptions extends RequestOptions {
  action?: DshSessionRequest['action'];
  target?: DshSessionRequest['target'];
  operation?: DshOperation;
  /** Capture before asynchronous prompt preparation; ST's chat getter is live. */
  expectedChatId?: string;
}

export function dshChatId(context: STContext): string {
  const id=context.getCurrentChatId();
  if (!id) throw new ApiError('请先打开一个酒馆聊天。');
  const owner=context.groupId ? ['group',context.groupId] : ['character',context.characters?.[Number(context.characterId)]?.avatar ?? context.name2];
  return JSON.stringify([...owner,id]);
}

function bindingKey(channel: ApiChannel): string {
  // Keep routing identities, never the channel's API key, in chat metadata.
  const url=new URL(channel.url);
  return JSON.stringify([channel.id,url.origin+url.pathname.replace(/\/+$/,''),channel.model]);
}

function bindings(context: STContext): Record<string, Binding> {
  const value=context.chatMetadata[STORE];
  if (value && typeof value==='object' && !Array.isArray(value)) return value as Record<string,Binding>;
  return {};
}

function saveBinding(context: STContext, chatId: string, key: string, value?: Binding): void {
  const values={...bindings(context)};
  if (value) values[key]=value; else delete values[key];
  context.chatMetadata[STORE]=values;
  const active=getContext();
  if (active?.getCurrentChatId() && dshChatId(active)===chatId) context.saveMetadataDebounced();
}

export function splitDshMessages(messages: ChatMsg[]): {fixed: ChatMsg[]; dynamic: ChatMsg[]} {
  return {fixed:messages.filter(message=>!!message.purpose),dynamic:messages.filter(message=>!message.purpose)};
}

function requestId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map(value=>value.toString(16).padStart(2,'0')).join('');
}

const queues=new Map<string,Promise<void>>();
async function waitForTurn(previous: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('请求已取消','AbortError');
  if (!signal) return previous;
  await new Promise<void>((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(new DOMException('请求已取消','AbortError'));};
    signal.addEventListener('abort',abort,{once:true});
    void previous.then(()=>{signal.removeEventListener('abort',abort);resolve();});
  });
}

/** Serialize one conversation locally; the bridge must also serialize across browser tabs. */
async function serial<T>(key: string, signal: AbortSignal | undefined, task:()=>Promise<T>): Promise<T> {
  const previous=queues.get(key) ?? Promise.resolve();
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const tail=previous.then(()=>gate);
  queues.set(key,tail);
  void tail.then(()=>{if (queues.get(key)===tail) queues.delete(key);});
  try { await waitForTurn(previous,signal);return await task(); }
  finally { release(); }
}

export async function requestDshCompletion(channel: ApiChannel, messages: ChatMsg[], context: STContext, options: DshOptions = {}): Promise<string> {
  const chatId=options.expectedChatId ?? dshChatId(context), action=options.action ?? 'generate';
  const key=JSON.stringify([chatId,bindingKey(channel)]);
  const scopeKey=key;
  const operation=options.operation ?? {};
  return serial(scopeKey,options.signal,async()=>{
    const active=getContext();
    if (!active || dshChatId(active)!==chatId) throw new DOMException('聊天已切换，未发送 DSH 请求','AbortError');
    const stored=bindings(context)[key];
    const binding=stored && typeof stored.session_id==='string' && stored.session_id.trim() ? {session_id:stored.session_id,initialized:stored.initialized===true} : undefined;
    if (!operation.pending || operation.acknowledged || operation.pending.key!==scopeKey || operation.pending.session.action!==action) {
      const parts=splitDshMessages(messages);
      const sendFixed=action==='sync_rules' || action==='generate' && !binding?.initialized;
      if (sendFixed && !parts.fixed.length) throw new ApiError('DSH 未找到固定规范分组，已取消发送。');
      const outgoing=action==='reset' ? [] : action==='sync_rules' ? parts.fixed : sendFixed ? messages : parts.dynamic;
      const fixed=sendFixed ? parts.fixed : [];
      operation.pending={key:scopeKey,channel:{...channel,excludeParams:[...(channel.excludeParams ?? [])]},messages:wireMessages(outgoing),session:{
        protocol_version:1,chat_id:chatId,request_id:requestId(),action,
        ...(binding ? {session_id:binding.session_id} : {}),
        fixed_message_count:fixed.length,fixed_message_types:fixed.map(message=>message.purpose!),
        ...(options.target ? {target:options.target} : {}),
      }};
      operation.acknowledged=false;
    }
    const pending=operation.pending;
    try {
      return await requestCompletion(pending.channel,pending.messages,{
        ...options,dshSession:pending.session,
        onDshResponse(data){
          const session=(data as {dsh_session?:{session_id?:unknown}} | null)?.dsh_session?.session_id;
          if (typeof session!=='string' || !session.trim()) throw new ApiError('DSH 响应缺少 dsh_session.session_id，未确认固定规范发送状态。');
          saveBinding(context,chatId,key,{session_id:session,initialized:action!=='reset'});
          operation.acknowledged=true;
        },
      });
    } catch(error) {
      if (error instanceof ApiError && error.status===410) {
        saveBinding(context,chatId,key);operation.pending=undefined;operation.acknowledged=false;
      }
      throw error;
    }
  });
}
