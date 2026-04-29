import Anthropic from '@anthropic-ai/sdk';
import { ToolExecutor } from './tool-executor';
import { AGENT_PROMPTS } from './prompts';

export interface Tool {
  name: string;
  description: string;
  schema: Record<string, any>;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentDecision {
  thinking: string;
  actions: Array<{
    tool: string;
    input: Record<string, any>;
    result?: any;
  }>;
  finalResponse: string;
}

export class ClaudeAgentDriver {
  private client: Anthropic;
  private toolExecutor: ToolExecutor;
  private conversationHistory: ConversationMessage[] = [];

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.toolExecutor = new ToolExecutor();
  }

  async processTask(
    agentRole: 'hardware' | 'software' | 'test' | 'pm' | 'release',
    userMessage: string,
    tools: Tool[]
  ): Promise<AgentDecision> {
    const systemPrompt = AGENT_PROMPTS[agentRole];
    const messages: Array<{ role: string; content: any }> = [];

    for (const msg of this.conversationHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }
    messages.push({ role: 'user', content: userMessage });

    console.log(`[Claude] 处理${agentRole}任务: ${userMessage.substring(0, 50)}...`);

    let response = await this.client.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      tools: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.schema,
      })),
      messages: messages as any,
    });

    const actions: AgentDecision['actions'] = [];
    let thinkingContent = '';
    let assistantContent = '';

    while (response.stop_reason === 'tool_use') {
      for (const block of response.content) {
        if (block.type === 'thinking') {
          thinkingContent = block.thinking;
        } else if (block.type === 'text') {
          assistantContent += block.text;
        } else if (block.type === 'tool_use') {
          console.log(`[Claude] 调用工具: ${block.name}`);
          const toolResult = await this.toolExecutor.execute(
            block.name,
            block.input as Record<string, any>
          );
          actions.push({
            tool: block.name,
            input: block.input as Record<string, any>,
            result: toolResult,
          });

          messages.push({ role: 'assistant', content: response.content });
          messages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify(toolResult),
              },
            ],
          });
        }
      }

      response = await this.client.messages.create({
        model: 'claude-opus-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        tools: tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.schema,
        })),
        messages: messages as any,
      });
    }

    for (const block of response.content) {
      if (block.type === 'text') {
        assistantContent += block.text;
      }
    }

    this.conversationHistory.push({ role: 'user', content: userMessage });
    this.conversationHistory.push({ role: 'assistant', content: assistantContent });

    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(-20);
    }

    return {
      thinking: thinkingContent,
      actions: actions,
      finalResponse: assistantContent,
    };
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  getHistory(): ConversationMessage[] {
    return this.conversationHistory;
  }
}
