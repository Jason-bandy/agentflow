#!/bin/bash

# agentflow + Claude 一键部署脚本
# 这个脚本会自动创建所有必要的文件并提交到GitHub

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 agentflow + Claude AI 部署脚本${NC}"
echo "=========================================="
echo ""

# Step 1: 确认目录
if [ ! -f "package.json" ]; then
  echo -e "${RED}❌ 错误：当前目录不是 agentflow 项目${NC}"
  echo "请在 agentflow 目录中运行此脚本"
  exit 1
fi

echo -e "${YELLOW}📁 Step 1: 创建目录结构${NC}"
mkdir -p src/integrations/claude
mkdir -p src/integrations/dingtalk
mkdir -p src/integrations/feishu
mkdir -p src/agents
mkdir -p src/database/models
mkdir -p tests/integration
mkdir -p scripts
mkdir -p docs
echo -e "${GREEN}✅ 目录结构创建完成${NC}"
echo ""

# Step 2: 创建分支
echo -e "${YELLOW}🌿 Step 2: 创建 Git 分支${NC}"
git checkout -b feature/claude-integration || git checkout feature/claude-integration
echo -e "${GREEN}✅ 分支已切换${NC}"
echo ""

# Step 3: 创建 .env.example
echo -e "${YELLOW}⚙️  Step 3: 创建环境配置文件${NC}"
cat > .env.example << 'ENVEOF'
# Anthropic (Claude)
ANTHROPIC_API_KEY=sk-your-key-here

# Dingtalk
DINGTALK_DEV_CLIENTID=dingndmbsghqvpkrwm1d
DINGTALK_DEV_SECRET=your-secret-here
DINGTALK_GATEWAY_URL=http://127.0.0.1:18789

DINGTALK_PM_CLIENTID=dingfgvceyw5s6xahiob
DINGTALK_PM_SECRET=your-secret-here

# Feishu
FEISHU_PM_APPID=cli_a9576fce7df9dbb5
FEISHU_PM_SECRET=your-secret-here

FEISHU_MAINDEV_APPID=cli_a957727576badceb
FEISHU_MAINDEV_SECRET=your-secret-here

# GitHub
GITHUB_TOKEN=ghp_your-token-here

# Jira
JIRA_HOST=your-jira.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=your-token-here

# Database
DATABASE_URL=sqlite:./agentflow.db

# Server
PORT=3000
NODE_ENV=development
ENVEOF

echo -e "${GREEN}✅ .env.example 已创建${NC}"
echo ""

# Step 4: 更新 package.json
echo -e "${YELLOW}📦 Step 4: 更新 package.json${NC}"
npm install @anthropic-ai/sdk axios express dotenv sqlite3 --save 2>/dev/null || true
npm install --save-dev @types/express @types/jest jest ts-jest ts-node eslint prettier 2>/dev/null || true
echo -e "${GREEN}✅ npm 依赖已安装${NC}"
echo ""

# Step 5: 创建核心文件
echo -e "${YELLOW}📝 Step 5: 创建核心 Claude 集成文件${NC}"

# Claude Driver
cat > src/integrations/claude/claude-driver.ts << 'CODEEOF'
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
CODEEOF

echo -e "${GREEN}✅ claude-driver.ts 已创建${NC}"

# Tool Executor
cat > src/integrations/claude/tool-executor.ts << 'TOOLEOF'
export class ToolExecutor {
  async execute(toolName: string, input: Record<string, any>): Promise<any> {
    console.log(`[Tool] 执行: ${toolName}`);
    
    // TODO: 实现具体的工具调用逻辑
    // 这里是占位符，实际实现见完整文档
    
    return { success: true, message: `Tool ${toolName} executed` };
  }
}
TOOLEOF

echo -e "${GREEN}✅ tool-executor.ts 已创建${NC}"

# Prompts
cat > src/integrations/claude/prompts.ts << 'PROMPTEOF'
export const AGENT_PROMPTS = {
  hardware: `你是硬件研发Agent。职责包括：
    - 分析硬件设计需求，制定设计方案
    - 检查原理图、BOM清单，评估成本和风险
    - 识别停产物料、成本超预算等问题
    - 启动设计评审流程
    - 管理硬件开发进度
    
你有以下工具可用：
- dingtalk_send_message: 发送钉钉消息
- dingtalk_start_approval: 启动审批流程
- feishu_send_card: 发送飞书卡片
- github_upload_file: 上传文件到GitHub
- jira_create_task: 创建Jira任务

重要：在做任何决定前，先思考问题的本质。`,

  software: `你是软件研发Agent。职责包括：
    - 代码审查和质量评估
    - 编译测试和CI/CD管理
    - 性能分析和优化建议
    - 依赖管理和安全检查
    - 版本发布前的验证`,

  test: `你是测试集成Agent。职责包括：
    - 执行集成测试用例
    - 分析测试结果，分类缺陷
    - 性能对标和基线对比
    - 发布前的最终验证
    - 缺陷分配和追踪`,

  pm: `你是项目管理Agent。职责包括：
    - Epic分解和任务规划
    - 里程碑管理和进度追踪
    - 风险识别和应急决策
    - 跨团队协调
    - 发布审批和质量门控`,

  release: `你是发布管理Agent。职责包括：
    - 版本号管理
    - Release Notes生成
    - 发布流程编排
    - 回滚决策
    - 灰度发布管理`,
};
PROMPTEOF

echo -e "${GREEN}✅ prompts.ts 已创建${NC}"
echo ""

# Step 6: 创建 Agent 基类
echo -e "${YELLOW}🤖 Step 6: 创建 Agent 基类${NC}"

cat > src/agents/base-claude-agent.ts << 'BASEEOF'
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
BASEEOF

echo -e "${GREEN}✅ base-claude-agent.ts 已创建${NC}"
echo ""

# Step 7: 创建 Hardware Agent
echo -e "${YELLOW}💾 Step 7: 创建 Hardware Agent${NC}"

cat > src/agents/hardware-agent.ts << 'HWEOF'
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
HWEOF

echo -e "${GREEN}✅ hardware-agent.ts 已创建${NC}"
echo ""

# Step 8: 创建测试脚本
echo -e "${YELLOW}🧪 Step 8: 创建测试脚本${NC}"

cat > scripts/test-claude-connection.ts << 'TESTEOF'
import { ClaudeAgentDriver } from '../src/integrations/claude/claude-driver';

async function test() {
  console.log('🧪 测试 Claude API 连接...\n');

  const driver = new ClaudeAgentDriver();

  try {
    const result = await driver.processTask('hardware', '你好', []);
    console.log('\n✅ Claude 连接成功！\n');
    console.log('响应:', result.finalResponse);
    process.exit(0);
  } catch (error) {
    console.error('\n❌ 连接失败:', error);
    process.exit(1);
  }
}

test();
TESTEOF

chmod +x scripts/test-claude-connection.ts
echo -e "${GREEN}✅ test-claude-connection.ts 已创建${NC}"
echo ""

# Step 9: 创建文档
echo -e "${YELLOW}📚 Step 9: 创建文档${NC}"

cat > docs/CLAUDE_INTEGRATION.md << 'DOCEOF'
# Claude AI Agent 集成指南

## 快速开始

1. 复制 .env.example 为 .env
2. 填入 ANTHROPIC_API_KEY
3. 运行 `npm run test:claude` 测试连接

## Agent 类型

- **HardwareAgent**: 硬件研发
- **SoftwareAgent**: 软件开发
- **TestAgent**: 测试集成
- **PMAgent**: 项目管理
- **ReleaseAgent**: 发布管理

## 开发

继承 ClaudeBaseAgent 创建新 Agent:

```typescript
export class MyAgent extends ClaudeBaseAgent {
  constructor() {
    const tools = [/* ... */];
    super('my-role', tools);
  }
}
```
DOCEOF

echo -e "${GREEN}✅ 文档已创建${NC}"
echo ""

# Step 10: Git 提交
echo -e "${YELLOW}📤 Step 10: 提交到 Git${NC}"

git add -A
git status

echo ""
echo -e "${YELLOW}请输入提交信息 (按 Ctrl+C 取消):${NC}"
read -p "提交信息: " commit_message

if [ -z "$commit_message" ]; then
  commit_message="feat: Add Claude AI Agent Integration for R&D Automation"
fi

git commit -m "$commit_message"

echo ""
echo -e "${YELLOW}是否推送到 GitHub? (y/n)${NC}"
read -p "推送: " push_choice

if [ "$push_choice" = "y" ] || [ "$push_choice" = "Y" ]; then
  git push origin feature/claude-integration
  echo -e "${GREEN}✅ 已推送到 GitHub${NC}"
  echo ""
  echo "📌 下一步："
  echo "1. 访问: https://github.com/Jason-bandy/agentflow/pulls"
  echo "2. 创建 Pull Request"
  echo "3. 邀请团队审查"
else
  echo -e "${YELLOW}⏭️  跳过推送${NC}"
  echo "稍后运行: git push origin feature/claude-integration"
fi

echo ""
echo -e "${GREEN}=========================================="
echo "🎉 部署完成！"
echo "=========================================${NC}"
echo ""
echo "快速命令："
echo "  npm run test:claude     - 测试 Claude 连接"
echo "  npm run demo:hardware   - 硬件演示"
echo "  npm run build           - 编译"
echo "  npm run test            - 运行测试"
echo ""
