import { describe, expect, it } from 'vitest';
import { applyMangaFrames, mangaDefaults, type MangaCustomLayout } from '@/manga/layouts';
import { newImagePreset } from './model';
import { assertMangaComposition, buildCompositionBrief, recentMangaLayouts } from './mangaComposition';
import { MangaTextError, MangaTextCorrectionError, withMangaTextCorrection } from './mangaText';
import type { ImagePlan } from '@/autoTag/protocol';

const custom: MangaCustomLayout = {
  id: 'cross', canvas: { width: 1088, height: 1920 },
  portrait: [
    { position: 'top', slots: { F: [-900,-500,-20,500], S: [-800,-450,-40,450] } },
    { position: 'bottom', slots: { F: [20,-500,900,500], S: [-100,-450,850,0], S_2: [-80,-450,800,0], TR:[60,40,300,450] } },
  ],
};
const manga = { ...mangaDefaults(), enabled: true, custom: [custom] };
const preset = { ...newImagePreset(), mangaComposition: 'expressive' as const };
function page(layout = 'balanced_2', panel: number | string = 2, slot = 'S', label = 'character'): ImagePlan['images'][number] {
  return { position:'P1',sourceLine:0,size:'portrait',nl:'',negative:'',characters:[],
    tag:JSON.stringify({layout,items:[{panel,slot,label,caption:'A traveler.'}]}) };
}
const plan = (...images: ImagePlan['images']): ImagePlan => ({ images, changes: [] });

describe('expressive manga acceptance', () => {
  it('compiles foreground occlusion only for an actually used crossing subject', () => {
    const compiled = (panel:number) => JSON.parse(applyMangaFrames(page('cross',panel).tag,manga,custom.canvas!));
    const crossed = compiled(2);
    expect(crossed.items[0].caption).toContain('not clipped');
    expect(crossed.items[0].caption).toContain('across the top edge');
    expect(crossed.summary.caption).toContain('occludes the frame line and white gutter');
    expect(compiled(1).items[0].caption).not.toContain('not clipped');
  });
  it('does not change legacy, non-layout, empty, single-panel or object-only plans', () => {
    expect(()=>assertMangaComposition(plan(page()),newImagePreset(),true,manga)).not.toThrow();
    expect(()=>assertMangaComposition(plan(page()),preset,false,manga)).not.toThrow();
    expect(()=>assertMangaComposition(plan(),preset,true,manga)).not.toThrow();
    expect(()=>assertMangaComposition(plan(page('balanced_1',1)),preset,true,manga)).not.toThrow();
    expect(()=>assertMangaComposition(plan(page('balanced_2',1,'F','object')),preset,true,manga)).not.toThrow();
  });
  it('rejects a fully bounded batch even when captions claim breakout', () => {
    const p=page(); p.tag=p.tag.replace('A traveler.', 'Her hair breaks across the border.');
    expect(()=>assertMangaComposition(plan(p),preset,true,manga)).toThrow(/未使用.*跨框/);
    expect(()=>assertMangaComposition(plan(page('cross',1)),preset,true,manga)).toThrow(/未使用.*跨框/);
  });
  it('accepts an actually used crossing region, including numbered slots and panel names', () => {
    for (const ref of [2,'2','bottom']) for (const slot of ['S','S_2']) {
      expect(()=>assertMangaComposition(plan(page(),page('cross',ref,slot)),preset,true,manga)).not.toThrow();
    }
  });
  it('rejects disabled or invalid geometry rather than trusting a layout name', () => {
    expect(()=>assertMangaComposition(plan(page('cross')),preset,true,{...manga,disabled:['cross']})).toThrow(/版式/);
    expect(()=>assertMangaComposition(plan(page('cross',2,'missing')),preset,true,manga)).toThrow(/槽位/);
    expect(()=>assertMangaComposition(plan(page()),preset,true,{...manga,custom:[]})).toThrow(/跨框.*版式/);
  });
  it('uses the real slanted outline and does not rewrite the plan', () => {
    const slanted = structuredClone(custom);
    slanted.portrait![1].shapes = { F:[[-500,20],[500,20],[500,900],[-500,700]] };
    slanted.portrait![1].slots.S = [650,-480,780,-300];
    const p=plan(page('cross')); const before=JSON.stringify(p);
    expect(()=>assertMangaComposition(p,preset,true,{...manga,custom:[slanted]})).not.toThrow();
    expect(JSON.stringify(p)).toBe(before);
  });
  it('does not call a detached or edge-touching subject a breakout', () => {
    for (const box of [[-800,-450,-100,0],[-800,-450,20,0]]) {
      const detached = structuredClone(custom);
      detached.portrait![1].slots.S = box;
      delete detached.portrait![1].slots.S_2;
      expect(()=>assertMangaComposition(plan(page('cross')),preset,true,{...manga,custom:[detached]})).toThrow(/跨框/);
    }
  });
  it('retains text order across separate regions without rewriting lettering', () => {
    const input={layout:'balanced_1',items:[
      {label:'text',panel:1,slot:'TL',text:'第一句',caption:'speech bubble'},
      {label:'text',panel:1,slot:'BR',text:'下一句',caption:'speech bubble'},
    ]};
    const out=JSON.parse(applyMangaFrames(JSON.stringify(input),manga,{width:1088,height:1920}));
    expect(out.items[0].caption).toContain('Lettering sequence in panel 1: 1 of 2');
    expect(out.items[1].caption).toContain('Lettering sequence in panel 1: 2 of 2');
    expect(out.items.map((item:any)=>item.text)).toEqual(['第一句','下一句']);
  });
  it('uses the same bounded correction for geometry and lettering', async () => {
    const sources:string[]=[]; let count=0;
    await expect(withMangaTextCorrection([], 'test', undefined, async (_m,s,validate)=>{
      sources.push(s); validate(String(++count)); return '';
    },raw=>{
      if(raw==='1') assertMangaComposition(plan(page()),preset,true,manga);
      throw new MangaTextError('文字缺失');
    })).rejects.toBeInstanceOf(MangaTextCorrectionError);
    expect(count).toBe(2);
    expect(sources[1]).toContain('构图补正 1/1');
  });
});

describe('composition selection brief', () => {
  it('exposes enabled capabilities and recent IDs without mandating one layout', () => {
    const brief=buildCompositionBrief({...manga,disabled:['balanced_1']},'portrait',['two_then_large','two_then_large']);
    expect(brief).toContain('跨框主体');
    expect(brief).toContain('cross');
    expect(brief).toContain('two_then_large → two_then_large');
    expect(brief).not.toContain('balanced_1');
    expect(brief).toContain('不是随机轮换');
    expect(brief).toContain('字区');
  });
  it('reads only previous AI image layouts, ignores malformed tags and bounds history', () => {
    const tag=(id:string)=>`<bbi_image>${JSON.stringify({layout:id,items:[]})}<size>portrait</size></bbi_image>`;
    const chat=[
      {mes:tag('old'),is_user:false}, {mes:tag('user'),is_user:true},
      {mes:'<bbi_image>invalid</bbi_image>',is_user:false},
      {mes:tag('a')+tag('b'),is_user:false}, {mes:tag('target'),is_user:false},
    ];
    expect(recentMangaLayouts(chat,4,2)).toEqual(['a','b']);
  });
});
