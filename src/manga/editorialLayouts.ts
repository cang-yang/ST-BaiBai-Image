import { parseCustomLayout, resizeMangaPanels } from './layouts';
import type { MangaCustomLayout } from './layouts';

/** Optional editorial artifacts; callers explicitly install them in custom layouts. */
export function editorialLayouts(width = 1664, height = 2496): MangaCustomLayout[] {
  const source = { width: 1664, height: 2496 };
  const layouts: MangaCustomLayout[] = [
    {
      id: 'editorial_dialogue_3',
      label: '对谈与落点',
      usage: '先对谈、再反应，下方大格承接情绪或动作落点。',
      readingOrder: '左上 → 右上 → 下方大格；下格右侧 TR → BR。',
      portrait: [
        {
          position: 'dialogue',
          slots: {
            F: [-1192, -776, -328, 116], C: [-1168, -752, -352, 92],
            L: [-1040, -730, -438, -360], R: [-1040, -320, -438, 70],
            TL: [-1144, -728, -1060, -50],
          },
          slotNotes: { F: '双人对谈建立关系。', L: '左侧人物。', R: '右侧人物。', TL: '对谈首句，按实际说话人使用。' },
        },
        {
          position: 'reply',
          slots: {
            F: [-1192, 158, -328, 776], C: [-1168, 182, -352, 752],
            S: [-900, 206, -438, 728], TR: [-1144, 206, -950, 728],
          },
          slotNotes: { F: '承接对谈的近景反应。', S: '人物反应，保留下沿留白。', TR: '短回应。' },
        },
        {
          position: 'hero',
          slots: {
            F: [-286, -776, 1192, 776], C: [-262, -752, 1168, 752],
            S: [-406, -720, 1152, 18],
            TR: [-218, 108, 242, 720], BR: [592, 108, 1082, 720],
          },
          slotNotes: {
            F: '大格落点，人物在左、独立对白在右。',
            S: '同一连续人物向上越过本格边框 120px，跨过 42px 格间距；前景遮住上格下缘，不新增人物。',
            TR: '右侧第一段对白。', BR: '右侧第二段对白，与上方字区独立。',
          },
        },
      ],
    },
    {
      id: 'editorial_reaction_4',
      label: '场景与双重反应',
      usage: '宽景开场、两格短反应、宽幅结果，适合节拍递进。',
      readingOrder: '上方宽景 → 中左反应 → 中右反应 → 下方结果。',
      portrait: [
        {
          position: 'establishing',
          slots: {
            F: [-1192, -776, -498, 776], C: [-1168, -752, -522, 752],
            S: [-1110, -680, -550, 100], TR: [-1120, 184, -730, 720],
          },
          slotNotes: { F: '宽景建立地点与事件。', S: '开场主体与场景关系。', TR: '开场对白或旁白。' },
        },
        {
          position: 'reaction_left',
          slots: {
            F: [-456, -776, 122, -21], C: [-432, -752, 98, -45],
            S: [-290, -720, 2, -90], TL: [-420, -720, -320, -80],
          },
          slotNotes: { F: '第一拍短反应，下缘让出结果格人物越线。', S: '第一反应近景。', TL: '短句或停顿。' },
        },
        {
          position: 'reaction_right',
          slots: {
            F: [-456, 21, 122, 776], C: [-432, 45, 98, 752],
            S: [-290, 90, 60, 700], TR: [-420, 100, -320, 720],
          },
          slotNotes: { F: '第二拍短反应，推进到结果。', S: '不同景别的第二反应。', TR: '简短承接。' },
        },
        {
          position: 'payoff',
          slots: {
            F: [164, -776, 1192, 776], C: [188, -752, 1168, 752],
            S: [44, -712, 1152, 48],
            TR: [224, 126, 574, 720], BR: [754, 126, 1114, 720],
          },
          slotNotes: {
            F: '宽幅结果，右侧保留独立对白。',
            S: '同一连续人物仅向上越过本格边框 120px，跨过格间距并遮住中左格下缘。',
            TR: '结果第一句。', BR: '结果补句或收束。',
          },
        },
      ],
    },
    {
      id: 'editorial_message_3',
      label: '人物与消息连拍（实验）',
      usage: '实验版式：模型可能合并右侧分界线，需验图。左侧人物贯穿，右侧消息推动后续动作；右下动作人物向上局部越线。',
      readingOrder: '左侧主格 → 右上消息 → 右下后续动作与底部消息。',
      portrait: [
        {
          position: 'main',
          slots: {
            F: [-1192, -776, 1192, 118], C: [-1168, -752, 1168, 94],
            S: [-728, -732, 1132, 70], TL: [-1138, -720, -798, 8],
          },
          slotNotes: {
            F: '纵向主格，呈现人物与当下环境。',
            S: '左侧人物与环境关系，保留完整侧边框，不在这里强行出框。',
            TL: '人物首句，位于主体上方。',
          },
        },
        {
          position: 'message',
          slots: {
            F: [-1192, 160, -38, 776], C: [-1168, 184, -62, 752],
            TR: [-1138, 268, -818, 736], O: [-728, 288, -128, 698],
          },
          slotNotes: {
            F: '独立消息特写，下缘给后续动作格的连续人物越线留出背景。',
            TR: '消息正文，可容纳约 45～65 个汉字。',
            O: '消息载体或手机特写，与正文分离。',
          },
        },
        {
          position: 'action',
          slots: {
            F: [4, 160, 1192, 776], C: [28, 184, 1168, 752],
            S: [-116, 204, 650, 736],
            BR: [720, 220, 1120, 736], O: [500, 288, 650, 698],
          },
          slotNotes: {
            F: '消息之后的人物动作近景，不作为同时发生的嵌入格。',
            S: '同一连续人物的头顶或原文动作局部向上越过本格边框 120px，跨过 42px 格间并遮住消息格下缘背景；不要裁切头顶。',
            BR: '动作下方的后续对白或消息，可容纳约 45～65 个汉字。',
            O: '人物手部或道具局部，必须归属同一个动作人物，不重复完整人物。',
          },
        },
      ],
    },
  ];
  const canvas = { width, height };
  return layouts.map(layout => parseCustomLayout(JSON.stringify({
    ...layout,
    canvas,
    portrait: width === source.width && height === source.height
      ? layout.portrait
      : resizeMangaPanels(layout.portrait!, source, canvas),
  })));
}
