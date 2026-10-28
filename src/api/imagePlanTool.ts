export const IMAGE_PLAN_TOOL_NAME = 'submit_image_plan';

export const IMAGE_PLAN_TOOLS = [{
  type: 'function',
  function: {
    name: IMAGE_PLAN_TOOL_NAME,
    description: 'Return the final story illustration plan. Follow the supplied host output contract, including valid P positions and the current backend format. This function returns data only; it does not generate images.',
    parameters: {
      type: 'object',
      properties: {
        images: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              position: { type: 'string' }, tag: { type: 'string' }, nl: { type: 'string' },
              negative: { type: 'string' }, size: { type: 'string', enum: ['portrait', 'landscape'] },
              characters: {
                type: 'array', items: {
                  type: 'object', properties: { name: { type: 'string' }, tag: { type: 'string' }, nl: { type: 'string' } },
                  required: ['name', 'tag'],
                },
              },
            },
            required: ['position', 'tag', 'size'],
          },
        },
        changes: {
          type: 'array', items: {
            type: 'object',
            properties: {
              name: { type: 'string' }, field: { type: 'string' }, value: { type: 'string' },
              fields: { type: 'object', additionalProperties: { type: 'string' } },
              position: { type: 'string' }, reason: { type: 'string' }, nl: { type: 'string' },
            },
            required: ['name', 'field'],
          },
        },
      },
      required: ['images', 'changes'],
    },
  },
}];

export const IMAGE_PLAN_TOOL_CHOICE = { type: 'function', function: { name: IMAGE_PLAN_TOOL_NAME } };

export function imagePlanArguments(calls: unknown): string {
  if (!Array.isArray(calls) || calls.length !== 1) throw new Error('工具输出必须且只能包含一个配图计划');
  const call = calls[0];
  if (call?.function?.name !== IMAGE_PLAN_TOOL_NAME || (call.type && call.type !== 'function')) throw new Error('返回了未授权的工具；仅支持 submit_image_plan');
  const args = call.function.arguments;
  if (typeof args !== 'string') throw new Error('工具参数不是 JSON 文本');
  let plan: any;
  try { plan = JSON.parse(args); } catch { throw new Error('工具参数不完整或不是有效 JSON'); }
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.images) || !Array.isArray(plan.changes)) throw new Error('工具参数缺少 images 或 changes 列表');
  return JSON.stringify(plan);
}
