import { ClaudeAgentDriver } from '../integrations/claude/claude-driver';
import { Tool } from '../integrations/claude/claude-driver';

export abstract class ClaudeBaseAgent {
  protected driver: ClaudeAgentDriver;
  protected role: 'hardware' | 'software' | 'test' | 'pm' | 'release';
  protected tools: Tool[];
  protected epicId: string = '';

  constructor(role: typeof this.role, tools: Tool[] = []) {
    this.role = role;
    this.driver = new ClaudeAgentDriver();
    this.tools = tools;
  }

  async handleMessage(message: string): Promise<void> {
    console.log(`\n[${this.role}] 收到消息: ${message}`);

    try {
      const decision = await this.driver.processTask(this.role, message, this.tools);

      if (decision.thinking) {
        console.log(`[${this.role}] 思考:\n${decision.thinking}\n`);
      }

      if (decision.actions.length > 0) {
        console.log(`[${this.role}] 执行动作:`);
        for (const action of decision.actions) {
          console.log(`  - ${action.tool}: ${JSON.stringify(action.input)}`);
        }
      }

      console.log(`[${this.role}] 响应:\n${decision.finalResponse}\n`);
    } catch (error) {
      console.error(`[${this.role}] 处理失败:`, error);
      throw error;
    }
  }

  setEpicContext(epicId: string): void {
    this.epicId = epicId;
    console.log(`[${this.role}] 设置项目: ${epicId}`);
  }

  clearHistory(): void {
    this.driver.clearHistory();
  }
}
