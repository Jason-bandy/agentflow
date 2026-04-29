import { ClaudeBaseAgent } from './base-claude-agent';
import { Tool } from '../integrations/claude/claude-driver';

export class HardwareAgent extends ClaudeBaseAgent {
  constructor() {
    const tools: Tool[] = [
      {
        name: 'dingtalk_send_message',
        description: '发送钉钉消息',
        schema: {
          type: 'object',
          properties: {
            conversation_id: { type: 'string' },
            message: { type: 'string' },
          },
          required: ['conversation_id', 'message'],
        },
      },
      {
        name: 'feishu_send_card',
        description: '发送飞书卡片',
        schema: {
          type: 'object',
          properties: {
            group_id: { type: 'string' },
            card_title: { type: 'string' },
            card_content: { type: 'object' },
          },
          required: ['group_id', 'card_title'],
        },
      },
    ];

    super('hardware', tools);
  }

  async onSchematicComplete(schematicPath: string, bomPath: string): Promise<void> {
    const message = `原理图设计已完成。
    - 原理图: ${schematicPath}
    - BOM: ${bomPath}
    
请进行以下评估：
1. 检查原理图的技术合理性
2. 分析BOM成本
3. 识别关键物料和风险
4. 给出优化建议`;

    await this.handleMessage(message);
  }
}
