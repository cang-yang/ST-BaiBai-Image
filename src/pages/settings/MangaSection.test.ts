import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRenderer, defineComponent, ssrContextKey } from 'vue';
import { mangaDefaults, resolveLayouts } from '@/manga/layouts';
vi.mock('@/pages/settings/MangaLayoutEditor.vue', () => ({ default: {} }));
vi.mock('@/state/settings', async () => {
  const { reactive } = await import('vue');
  const { mangaDefaults } = await import('@/manga/layouts');
  return { settings: reactive({ manga: mangaDefaults() }) };
});
import { settings } from '@/state/settings';
import Section from './MangaSection.vue';

function section() {
  let state: any;
  const renderer = createRenderer<any, any>({
    createElement:()=>({}), createText:()=>({}), createComment:()=>({}),
    setText:()=>{}, setElementText:()=>{}, patchProp:()=>{}, insert:()=>{}, remove:()=>{},
    parentNode:()=>null, nextSibling:()=>null,
  });
  const app = renderer.createApp(defineComponent({ setup() {
    state = (Section as any).setup({}, { expose:()=>{} });
    return ()=>null;
  } }));
  app.provide(ssrContextKey, {}); app.mount({});
  return { state, close:()=>app.unmount() };
}

describe('可视化编辑保存',()=>{
  beforeEach(()=>{ settings.manga=mangaDefaults(); });
  it('更新同 ID 自定义版式并保留另一个方向，不新增副本',()=>{
    const portrait=[{position:'old',slots:{F:[-900,-500,900,500]}}];
    const landscape=[{position:'wide',slots:{F:[-500,-900,500,900]}}];
    settings.manga.custom=[{id:'mine',portrait,landscape}];
    const {state,close}=section();
    state.openQuick('mine');
    state.saveQuick({id:'mine',label:'修改后',canvas:{width:1088,height:1920},portrait:[{position:'new',slots:{F:[-800,-400,800,400],R:[-700,0,700,350]}}]});
    expect(settings.manga.custom).toHaveLength(1);
    expect(settings.manga.custom[0].portrait?.[0].position).toBe('new');
    expect(settings.manga.custom[0].landscape).toEqual(landscape);
    expect(settings.manga.custom[0].canvas).toBeUndefined();
    expect(state.quickOpen.value).toBe(false);
    close();
  });
  it('编辑默认版式时创建同 ID 覆盖，保留其横版',()=>{
    const {state,close}=section();
    state.openQuick('balanced_1');
    state.saveQuick({id:'balanced_1',canvas:{width:1088,height:1920},portrait:[{position:'edited',slots:{F:[-800,-400,800,400]}}]});
    expect(settings.manga.custom[0].id).toBe('balanced_1');
    expect(resolveLayouts(settings.manga,'landscape').find(item=>item.id==='balanced_1')?.panels).toHaveLength(1);
    close();
  });
});
