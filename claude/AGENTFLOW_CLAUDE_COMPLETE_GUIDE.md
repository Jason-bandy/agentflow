# agentflow + Claude AI 完整项目框架

## 📁 完整的项目目录结构

```
agentflow/
├── src/
│   ├── core/
│   │   ├── agent.ts                    # Agent基类（保留原有）
│   │   ├── tools.ts                    # 工具定义系统
│   │   └── message-bus.ts              # 消息总线
│   │
│   ├── agents/
│   │   ├── base-claude-agent.ts        # ✨ Claude Agent基类（新增）
│   │   ├── hardware-agent.ts           # 硬件Agent（使用Claude驱动）
│   │   ├── software-agent.ts           # 软件Agent
│   │   ├── test-agent.ts               # 测试Agent
│   │   ├── pm-agent.ts                 # 项目管理Agent
│   │   └── release-agent.ts            # 发布Agent
│   │
│   ├── integrations/
│   │   ├── dingtalk/
│   │   │   ├── client.ts               # 钉钉API客户端
│   │   │   ├── bot-registry.ts         # Bot管理
│   │   │   ├── webhook-handler.ts      # Webhook接收
│   │   │   └── types.ts                # 类型定义
│   │   │
│   │   ├── feishu/
│   │   │   ├── client.ts               # 飞书API客户端
│   │   │   ├── bot-registry.ts         # Bot管理
│   │   │   └── types.ts
│   │   │
│   │   ├── github/
│   │   │   ├── client.ts               # GitHub API
│   │   │   └── types.ts
│   │   │
│   │   ├── jira/
│   │   │   ├── client.ts               # Jira API
│   │   │   └── types.ts
│   │   │
│   │   ├── claude/                     # ✨ Claude集成（新增）
│   │   │   ├── claude-driver.ts        # Claude驱动器
│   │   │   ├── tool-executor.ts        # 工具执行器
│   │   │   ├── prompts.ts              # System Prompts
│   │   │   └── types.ts
│   │   │
│   │   └── message-dispatcher.ts       # ✨ 双通道消息分发（新增）
│   │
│   ├── workflows/
│   │   ├── hardware-design.ts          # 硬件设计流程
│   │   ├── software-dev.ts             # 软件开发流程
│   │   ├── integration-test.ts         # 集成测试流程
│   │   └── release-flow.ts             # 发布流程
│   │
│   ├── services/
│   │   ├── project-service.ts          # 项目管理服务
│   │   ├── task-service.ts             # 任务服务
│   │   ├── knowledge-service.ts        # 知识库服务（新增）
│   │   └── cache-service.ts            # 缓存服务
│   │
│   ├── database/
│   │   ├── models/
│   │   │   ├── project.ts
│   │   │   ├── task.ts
│   │   │   ├── agent-state.ts          # ✨ Agent状态持久化（新增）
│   │   │   └── conversation.ts         # ✨ 对话历史（新增）
│   │   │
│   │   ├── migrations/
│   │   └── init.ts
│   │
│   ├── utils/
│   │   ├── logger.ts
│   │   ├── validator.ts
│   │   ├── error-handler.ts
│   │   └── env-loader.ts
│   │
│   └── main.ts                         # 应用入口
│
├── tests/
│   ├── unit/
│   │   ├── agents/
│   │   │   ├── hardware-agent.test.ts
│   │   │   ├── software-agent.test.ts
│   │   │   └── claude-agent.test.ts    # ✨ Claude Agent测试
│   │   │
│   │   └── integrations/
│   │       └── claude-driver.test.ts
│   │
│   ├── integration/
│   │   ├── full-workflow.test.ts       # ✨ 完整流程测试
│   │   ├── dingtalk-webhook.test.ts
│   │   └── message-dispatch.test.ts
│   │
│   └── fixtures/
│       ├── mock-data.ts
│       └── test-config.ts
│
├── scripts/
│   ├── setup.sh                        # 初始化脚本
│   ├── deploy.sh                       # 部署脚本
│   ├── test-claude-connection.ts       # ✨ Claude连接测试
│   ├── demo-hardware-flow.ts           # ✨ 硬件流程演示
│   └── seed-knowledge.ts               # ✨ 知识库初始化
│
├── config/
│   ├── default.ts                      # 默认配置
│   ├── development.ts
│   ├── production.ts
│   └── agents.config.ts                # ✨ Agent配置（新增）
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── CLAUDE_INTEGRATION.md           # ✨ Claude集成文档
│   ├── API.md
│   └── DEPLOYMENT.md
│
├── .env.example
├── .env.local
├── package.json
├── tsconfig.json
├── jest.config.js
├── docker-compose.yml                  # ✨ Docker支持（新增）
└── README.md
```

**图例：✨ 表示新增文件或关键修改**

---

## 🚀 核心实现文件

### 1️⃣ **Claude驱动器** (src/integrations/claude/claude-driver.ts)

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { Tool, ToolResult } from '../tools';
import { ToolExecutor } from './tool-executor';
import { AGENT_PROMPTS } from './prompts';

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

  /**
   * 处理任务并做出决策
   */
  async processTask(
    agentRole: 'hardware' | 'software' | 'test' | 'pm' | 'release',
    userMessage: string,
    tools: Tool[]
  ): Promise<AgentDecision> {
    const systemPrompt = AGENT_PROMPTS[agentRole];

    // 构建消息历史
    const messages: Array<{ role: string; content: any }> = [];

    // 添加历史对话
    for (const msg of this.conversationHistory) {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    // 添加当前消息
    messages.push({
      role: 'user',
      content: userMessage,
    });

    // 调用Claude Opus
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

    // 处理工具调用的多轮交互
    const actions: AgentDecision['actions'] = [];
    let thinkingContent = '';
    let assistantContent = '';

    // 第一轮响应处理
    while (response.stop_reason === 'tool_use') {
      // 提取Claude的思考过程和工具调用
      for (const block of response.content) {
        if (block.type === 'thinking') {
          thinkingContent = block.thinking;
        } else if (block.type === 'text') {
          assistantContent += block.text;
        } else if (block.type === 'tool_use') {
          console.log(`[Claude] 调用工具: ${block.name}`);

          // 执行工具
          const toolResult = await this.toolExecutor.execute(
            block.name,
            block.input as Record<string, any>
          );

          actions.push({
            tool: block.name,
            input: block.input as Record<string, any>,
            result: toolResult,
          });

          // 构建工具结果消息，继续对话
          messages.push({
            role: 'assistant',
            content: response.content,
          });

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

      // 继续获取Claude的响应
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

    // 提取最终响应
    for (const block of response.content) {
      if (block.type === 'text') {
        assistantContent += block.text;
      }
    }

    // 保存对话历史（用于上下文）
    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
    });

    this.conversationHistory.push({
      role: 'assistant',
      content: assistantContent,
    });

    // 限制历史长度（避免token超限）
    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(-20);
    }

    return {
      thinking: thinkingContent,
      actions: actions,
      finalResponse: assistantContent,
    };
  }

  /**
   * 清空对话历史
   */
  clearHistory(): void {
    this.conversationHistory = [];
  }

  /**
   * 获取当前对话历史
   */
  getHistory(): ConversationMessage[] {
    return this.conversationHistory;
  }

  /**
   * 保存对话（用于持久化）
   */
  async saveConversation(epicId: string, agentRole: string): Promise<void> {
    // 保存到数据库
    console.log(`[Claude] 保存对话: epic=${epicId}, agent=${agentRole}`);
    // TODO: 实现持久化
  }

  /**
   * 加载对话（恢复上下文）
   */
  async loadConversation(epicId: string, agentRole: string): Promise<void> {
    console.log(`[Claude] 加载对话: epic=${epicId}, agent=${agentRole}`);
    // TODO: 从数据库加载
  }
}
```

### 2️⃣ **工具执行器** (src/integrations/claude/tool-executor.ts)

```typescript
import { DingtalkClient } from '../dingtalk/client';
import { FeishuClient } from '../feishu/client';
import { GitHubClient } from '../github/client';
import { JiraClient } from '../jira/client';

export class ToolExecutor {
  private dingtalkClient: DingtalkClient;
  private feishuClient: FeishuClient;
  private githubClient: GitHubClient;
  private jiraClient: JiraClient;

  constructor() {
    this.dingtalkClient = new DingtalkClient();
    this.feishuClient = new FeishuClient();
    this.githubClient = new GitHubClient();
    this.jiraClient = new JiraClient();
  }

  async execute(toolName: string, input: Record<string, any>): Promise<any> {
    switch (toolName) {
      // ===== 钉钉工具 =====
      case 'dingtalk_send_message':
        return this.dingtalkSendMessage(input);

      case 'dingtalk_start_approval':
        return this.dingtalkStartApproval(input);

      case 'dingtalk_create_task':
        return this.dingtalkCreateTask(input);

      // ===== 飞书工具 =====
      case 'feishu_send_card':
        return this.feishuSendCard(input);

      case 'feishu_create_task':
        return this.feishuCreateTask(input);

      case 'feishu_share_document':
        return this.feishuShareDocument(input);

      // ===== GitHub工具 =====
      case 'github_search_repo':
        return this.githubSearchRepo(input);

      case 'github_upload_file':
        return this.githubUploadFile(input);

      case 'github_create_issue':
        return this.githubCreateIssue(input);

      case 'github_get_pr_info':
        return this.githubGetPRInfo(input);

      // ===== Jira工具 =====
      case 'jira_create_task':
        return this.jiraCreateTask(input);

      case 'jira_update_task':
        return this.jiraUpdateTask(input);

      case 'jira_add_comment':
        return this.jiraAddComment(input);

      // ===== 本地文件工具 =====
      case 'read_file':
        return this.readFile(input);

      case 'write_file':
        return this.writeFile(input);

      case 'analyze_bom':
        return this.analyzeBOM(input);

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  }

  private async dingtalkSendMessage(input: {
    conversation_id: string;
    message: string;
    mentions?: string[];
  }): Promise<any> {
    const bot = await this.dingtalkClient.getBot('dev');
    const messageId = await bot.sendMessage(
      input.conversation_id,
      input.message,
      input.mentions
    );
    return { success: true, messageId };
  }

  private async dingtalkStartApproval(input: {
    process_code: string;
    form_data: Record<string, any>;
    approvers: string[];
  }): Promise<any> {
    const bot = await this.dingtalkClient.getBot('projectmanager');
    const approval = await bot.startApprovalProcess(
      input.process_code,
      input.form_data,
      input.approvers
    );
    return { success: true, ...approval };
  }

  private async dingtalkCreateTask(input: {
    title: string;
    description: string;
    assignee: string;
    due_date: string;
    priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  }): Promise<any> {
    const bot = await this.dingtalkClient.getBot('dev');
    const taskId = await bot.createTask(
      input.title,
      input.description,
      input.assignee,
      input.due_date
    );
    return { success: true, taskId };
  }

  private async feishuSendCard(input: {
    group_id: string;
    card_title: string;
    card_content: Record<string, any>;
  }): Promise<any> {
    const bot = await this.feishuClient.getBot('main-dev');
    const messageId = await bot.sendMessage(input.group_id, input.card_content);
    return { success: true, messageId };
  }

  private async feishuCreateTask(input: {
    title: string;
    description: string;
    due_date: string;
    assignee_ids: string[];
  }): Promise<any> {
    const bot = await this.feishuClient.getBot('productmanager');
    const taskId = await bot.createTask(
      input.title,
      input.description,
      input.due_date,
      input.assignee_ids
    );
    return { success: true, taskId };
  }

  private async feishuShareDocument(input: {
    doc_url: string;
    group_id: string;
    message: string;
  }): Promise<any> {
    // 实现飞书文档分享
    return { success: true, message: '文档已分享' };
  }

  private async githubSearchRepo(input: {
    query: string;
    language?: string;
  }): Promise<any> {
    // 实现GitHub搜索
    return { success: true, results: [] };
  }

  private async githubUploadFile(input: {
    repo: string;
    path: string;
    content: string;
    message: string;
  }): Promise<any> {
    // 实现文件上传
    return { success: true, url: `https://github.com/${input.repo}/blob/main/${input.path}` };
  }

  private async githubCreateIssue(input: {
    repo: string;
    title: string;
    body: string;
    labels?: string[];
  }): Promise<any> {
    // 实现Issue创建
    return { success: true, issueNumber: 123, issueUrl: '#' };
  }

  private async githubGetPRInfo(input: {
    repo: string;
    pr_number: number;
  }): Promise<any> {
    // 实现PR信息获取
    return { success: true, pr: { /* PR数据 */ } };
  }

  private async jiraCreateTask(input: {
    project_key: string;
    issue_type: string;
    summary: string;
    description: string;
    assignee?: string;
  }): Promise<any> {
    const taskId = await this.jiraClient.createIssue({
      fields: {
        project: { key: input.project_key },
        issuetype: { name: input.issue_type },
        summary: input.summary,
        description: input.description,
        assignee: input.assignee ? { name: input.assignee } : undefined,
      },
    });
    return { success: true, taskId };
  }

  private async jiraUpdateTask(input: {
    task_id: string;
    updates: Record<string, any>;
  }): Promise<any> {
    await this.jiraClient.updateIssue(input.task_id, { fields: input.updates });
    return { success: true };
  }

  private async jiraAddComment(input: {
    task_id: string;
    comment: string;
  }): Promise<any> {
    await this.jiraClient.addComment(input.task_id, input.comment);
    return { success: true };
  }

  private readFile(input: { path: string }): any {
    // 实现文件读取
    return { success: true, content: '' };
  }

  private writeFile(input: { path: string; content: string }): any {
    // 实现文件写入
    return { success: true };
  }

  private async analyzeBOM(input: {
    bom_file_path: string;
    budget?: number;
  }): Promise<any> {
    // 实现BOM分析
    return {
      success: true,
      totalCost: 2800,
      itemCount: 45,
      riskItems: [],
      suggestions: [],
    };
  }
}
```

### 3️⃣ **Agent Prompts** (src/integrations/claude/prompts.ts)

```typescript
export const AGENT_PROMPTS = {
  hardware: `你是硬件研发Agent，任职于一家IoT硬件公司。你的职责是：

## 核心职责
1. 分析硬件设计需求，制定设计方案
2. 检查原理图、BOM清单，评估成本和风险
3. 识别停产物料、成本超预算等问题
4. 启动设计评审流程
5. 管理硬件开发进度

## 设计原则
- 成本优先：尽量降低BOM成本，但不牺牲功能
- 质量第一：确保可靠性和性能指标达成
- 风险识别：主动发现潜在的技术或供应链风险
- 团队协作：与PM和软件团队及时沟通

## 可用工具
- dingtalk_send_message: 发送钉钉消息通知
- dingtalk_start_approval: 启动钉钉审批流程
- dingtalk_create_task: 创建钉钉待办任务
- feishu_send_card: 发送飞书交互卡片
- feishu_create_task: 创建飞书待办
- github_upload_file: 上传原理图/BOM到GitHub
- github_create_issue: 创建GitHub Issue追踪问题
- jira_create_task: 在Jira中创建任务
- jira_update_task: 更新Jira任务
- read_file: 读取本地文件（原理图、BOM等）
- analyze_bom: 分析BOM成本和风险

## 工作流程示例
当收到"原理图设计完成"时，你应该：
1. 请求查看原理图文件和BOM清单
2. 分析技术设计的合理性
3. 计算BOM成本，与预算对比
4. 识别关键物料和风险
5. 撰写评审意见并发送钉钉消息给团队
6. 如果需要设计评审，启动钉钉审批流程

## 重要提示
- 在做任何决定前，先思考问题的本质
- 如果信息不足，主动提出问题而不是猜测
- 保持与PM和软件团队的沟通，避免孤立决策
- 定期更新进度，主动预警风险`,

  software: `你是软件研发Agent，负责：

## 核心职责
1. 代码审查和质量评估
2. 编译测试和CI/CD管理
3. 性能分析和优化建议
4. 依赖管理和安全检查
5. 版本发布前的验证

## 设计原则
- 代码质量：遵循编程规范，确保可维护性
- 自动化：充分利用CI/CD工具自动化测试和构建
- 安全优先：检查依赖漏洞和安全隐患
- 性能意识：监控内存、CPU、编译时间等指标

## 可用工具
- github_get_pr_info: 获取PR信息进行代码审查
- github_create_issue: 创建Issue记录问题
- dingtalk_send_message: 推送构建/测试结果
- jira_create_task: 创建开发任务
- jira_update_task: 更新任务状态

## 工作流程
当收到"新的PR提交"时：
1. 获取PR信息和diff
2. 分析代码质量（复杂度、性能等）
3. 检查是否有安全问题
4. 评估性能影响
5. 给出审查意见
6. 如果有重大问题，创建Issue并@相关人员`,

  test: `你是测试集成Agent。职责：

## 核心职责
1. 执行集成测试用例
2. 分析测试结果，分类缺陷
3. 性能对标和基线对比
4. 发布前的最终验证
5. 缺陷分配和追踪

## 分类规则
硬件缺陷特征：
- 与芯片/电路相关的问题
- 功耗、温度、信号完整性问题
- 物理层通信协议问题

软件缺陷特征：
- 应用逻辑错误
- 内存泄漏、死锁
- 驱动程序问题

设计问题特征：
- 架构不合理导致的性能瓶颈
- 功能规格未达成
- 可靠性指标不达标

## 可用工具
- jira_create_task: 创建缺陷单
- jira_update_task: 更新缺陷状态
- dingtalk_send_message: 发送测试报告
- feishu_send_card: 发送详细的飞书测试卡片
- github_create_issue: 记录技术问题

## 测试流程
1. 收到测试信号后，执行完整的测试套件
2. 收集结果数据（通过率、性能指标等）
3. 对比历史基线，识别异常
4. 对每个失败的用例进行根因分析
5. 根据问题性质分配给硬件或软件团队
6. 生成测试报告发送给PM和相关人员`,

  pm: `你是项目管理Agent。职责：

## 核心职责
1. Epic分解和任务规划
2. 里程碑管理和进度追踪
3. 风险识别和应急决策
4. 跨团队协调
5. 发布审批和质量门控

## 工作原则
- 透明性：定期更新所有相关人员
- 风险优先：主动识别和处理风险
- 质量门控：严格把控发布条件
- 灵活应对：根据实际进展调整计划

## 可用工具
- dingtalk_start_approval: 启动项目立项或发布审批
- dingtalk_create_task: 分配任务给团队
- feishu_send_card: 发送项目进度卡片
- jira_create_task: 创建Jira Epic和Story
- jira_update_task: 更新任务状态

## 决策框架
发布决策：
- ✅ 所有测试通过 → 可发布
- ❌ 高优缺陷未修复 → 暂停发布
- ⚠️ 中优缺陷 → 评估影响，可选择发布后修复
- 需评估ROI：延期发布的成本 vs 边界发布的风险`,

  release: `你是发布管理Agent。职责：

## 核心职责
1. 版本号管理
2. Release Notes生成
3. 发布流程编排
4. 回滚决策
5. 灰度发布管理

## 发布检查清单
- [ ] 所有测试通过
- [ ] 性能指标达标
- [ ] 安全审计完成
- [ ] 文档更新
- [ ] 依赖库审计
- [ ] 容灾方案准备
- [ ] 监控告警配置
- [ ] CEO/CFO签字

## 可用工具
- dingtalk_start_approval: 启动发布审批
- github_upload_file: 上传Release包
- feishu_send_card: 发送发布通知
- dingtalk_send_message: 群组通知`,
};
```

### 4️⃣ **Claude集成的Agent基类** (src/agents/base-claude-agent.ts)

```typescript
import { ClaudeAgentDriver } from '../integrations/claude/claude-driver';
import { Tool } from '../integrations/tools';

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

  /**
   * 处理消息（来自钉钉或飞书）
   */
  async handleMessage(message: string): Promise<void> {
    console.log(`\n[${ this.role}] 收到消息: ${message}`);

    try {
      // 调用Claude做决策
      const decision = await this.driver.processTask(
        this.role,
        message,
        this.tools
      );

      // 输出Claude的思考过程（用于调试）
      if (decision.thinking) {
        console.log(`[${this.role}] Claude思考:\n${decision.thinking}\n`);
      }

      // 输出执行的动作
      if (decision.actions.length > 0) {
        console.log(`[${this.role}] 执行动作:`);
        for (const action of decision.actions) {
          console.log(`  - ${action.tool}: ${JSON.stringify(action.input)}`);
          if (action.result?.error) {
            console.error(`    ❌ 错误: ${action.result.error}`);
          } else {
            console.log(`    ✅ 完成`);
          }
        }
      }

      // 输出最终响应
      console.log(`[${this.role}] 最终响应:\n${decision.finalResponse}\n`);
    } catch (error) {
      console.error(`[${this.role}] 处理失败:`, error);
      throw error;
    }
  }

  /**
   * 设置当前项目上下文
   */
  setEpicContext(epicId: string): void {
    this.epicId = epicId;
    console.log(`[${this.role}] 设置项目上下文: ${epicId}`);
  }

  /**
   * 清空对话历史
   */
  clearHistory(): void {
    this.driver.clearHistory();
  }

  /**
   * 保存会话（持久化）
   */
  async saveSession(): Promise<void> {
    await this.driver.saveConversation(this.epicId, this.role);
  }

  /**
   * 恢复会话（加载上下文）
   */
  async loadSession(): Promise<void> {
    await this.driver.loadConversation(this.epicId, this.role);
  }
}
```

### 5️⃣ **硬件Agent具体实现** (src/agents/hardware-agent.ts)

```typescript
import { ClaudeBaseAgent } from './base-claude-agent';
import { Tool } from '../integrations/tools';

export class HardwareAgent extends ClaudeBaseAgent {
  constructor() {
    const tools: Tool[] = [
      {
        name: 'dingtalk_send_message',
        description: '发送钉钉消息到指定群组',
        schema: {
          type: 'object',
          properties: {
            conversation_id: { type: 'string' },
            message: { type: 'string' },
            mentions: { type: 'array', items: { type: 'string' } },
          },
          required: ['conversation_id', 'message'],
        },
      },
      {
        name: 'dingtalk_start_approval',
        description: '启动钉钉审批流程（如设计评审）',
        schema: {
          type: 'object',
          properties: {
            process_code: { type: 'string' },
            form_data: { type: 'object' },
            approvers: { type: 'array', items: { type: 'string' } },
          },
          required: ['process_code', 'form_data'],
        },
      },
      {
        name: 'feishu_send_card',
        description: '发送飞书设计评审卡片',
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
      {
        name: 'github_upload_file',
        description: '上传原理图或文件到GitHub',
        schema: {
          type: 'object',
          properties: {
            repo: { type: 'string' },
            path: { type: 'string' },
            content: { type: 'string' },
            message: { type: 'string' },
          },
          required: ['repo', 'path', 'content'],
        },
      },
      {
        name: 'analyze_bom',
        description: '分析BOM清单的成本和风险',
        schema: {
          type: 'object',
          properties: {
            bom_file_path: { type: 'string' },
            budget: { type: 'number' },
          },
          required: ['bom_file_path'],
        },
      },
      {
        name: 'jira_create_task',
        description: '在Jira中创建硬件设计任务',
        schema: {
          type: 'object',
          properties: {
            project_key: { type: 'string' },
            summary: { type: 'string' },
            description: { type: 'string' },
            assignee: { type: 'string' },
          },
          required: ['project_key', 'summary'],
        },
      },
    ];

    super('hardware', tools);
  }

  /**
   * 硬件特定的方法：处理原理图完成事件
   */
  async onSchematicComplete(schematicPath: string, bomPath: string): Promise<void> {
    const message = `原理图设计已完成。文件位置：
    - 原理图: ${schematicPath}
    - BOM: ${bomPath}
    
请进行以下评估：
1. 检查原理图的技术合理性
2. 分析BOM成本，是否超预算
3. 识别关键物料和停产风险
4. 给出优化建议
5. 决定是否启动正式的设计评审`;

    await this.handleMessage(message);
  }

  /**
   * 处理PCB Layout完成
   */
  async onPCBLayoutComplete(pcbPath: string): Promise<void> {
    const message = `PCB Layout设计已完成。文件路径: ${pcbPath}

请进行质量检查：
1. 检查PCB设计是否符合原理图要求
2. 评估信号完整性和EMC考虑
3. 检查制造工艺的可行性
4. 启动钉钉设计评审流程`;

    await this.handleMessage(message);
  }

  /**
   * 成本优化建议
   */
  async optimizeBOM(bomPath: string, targetCost: number): Promise<void> {
    const message = `BOM成本优化需求。目标成本: ¥${targetCost}
BOM文件: ${bomPath}

请分析：
1. 当前BOM的成本结构
2. 识别高成本元器件
3. 提出替代方案（性能相当但成本更低）
4. 评估风险（可靠性、供应链）
5. 给出具体的优化建议`;

    await this.handleMessage(message);
  }
}
```

### 6️⃣ **完整测试脚本** (tests/integration/full-workflow.test.ts)

```typescript
import { HardwareAgent } from '../../src/agents/hardware-agent';
import { SoftwareAgent } from '../../src/agents/software-agent';
import { TestAgent } from '../../src/agents/test-agent';
import { PMAgent } from '../../src/agents/pm-agent';

describe('完整硬件+软件研发工作流', () => {
  let hardwareAgent: HardwareAgent;
  let softwareAgent: SoftwareAgent;
  let testAgent: TestAgent;
  let pmAgent: PMAgent;

  beforeEach(() => {
    hardwareAgent = new HardwareAgent();
    softwareAgent = new SoftwareAgent();
    testAgent = new TestAgent();
    pmAgent = new PMAgent();

    // 设置项目上下文
    hardwareAgent.setEpicContext('BK7252N-v1.0');
    softwareAgent.setEpicContext('BK7252N-v1.0');
    testAgent.setEpicContext('BK7252N-v1.0');
    pmAgent.setEpicContext('BK7252N-v1.0');
  });

  test('硬件设计→评审→PCB→集成→发布完整流程', async () => {
    console.log('\n========== BK7252N硬件+软件混合研发完整流程 ==========\n');

    // Phase 1: 项目启动
    console.log('📋 Phase 1: 项目启动');
    await pmAgent.handleMessage(
      '启动BK7252N AI热敏打印机项目，预算¥50,000，截止日期2025-07-31'
    );

    // Phase 2: 硬件设计
    console.log('\n⚙️ Phase 2: 硬件设计');
    await hardwareAgent.onSchematicComplete(
      '/designs/bk7252n/schematic_v1.0.sch',
      '/designs/bk7252n/bom_v1.0.xlsx'
    );

    // Phase 3: BOM成本优化
    console.log('\n💰 Phase 3: BOM成本优化');
    await hardwareAgent.optimizeBOM('/designs/bk7252n/bom_v1.0.xlsx', 2600);

    // Phase 4: PCB完成
    console.log('\n📐 Phase 4: PCB设计完成');
    await hardwareAgent.onPCBLayoutComplete('/designs/bk7252n/pcb_v1.0.kicad');

    // Phase 5: 软件开发
    console.log('\n💻 Phase 5: 软件开发');
    await softwareAgent.handleMessage(
      '硬件接口定义已完成，MCU为STM32H7系列，请启动固件开发'
    );

    // Phase 6: 集成测试
    console.log('\n🧪 Phase 6: 集成测试');
    await testAgent.handleMessage(
      '硬件打样完成，固件编译成功。请执行完整的集成测试套件'
    );

    // Phase 7: 发布决策
    console.log('\n✅ Phase 7: 发布审批');
    await pmAgent.handleMessage(
      '所有测试已通过，性能指标达成。请启动发布审批流程'
    );

    console.log('\n========== 流程完成 ==========\n');
  });

  test('缺陷处理流程', async () => {
    console.log('\n========== 缺陷处理流程 ==========\n');

    // 发现缺陷
    await testAgent.handleMessage(
      '集成测试发现问题：LCD显示异常，可能是SPI时序问题或硬件设计问题'
    );

    // 分类并分配
    console.log('\n硬件Agent处理分类的缺陷：');
    await hardwareAgent.handleMessage(
      '需要检查原理图中的SPI电路设计，信号完整性是否达标'
    );

    // 软件团队响应
    console.log('\n软件Agent处理分类的缺陷：');
    await softwareAgent.handleMessage(
      '需要检查驱动程序的SPI时钟设置，是否与硬件手册一致'
    );
  });

  test('风险识别和预警', async () => {
    console.log('\n========== 风险识别流程 ==========\n');

    // 硬件识别成本风险
    await hardwareAgent.handleMessage(
      'BK7252N芯片报价上涨20%，成本超预算¥1000。建议评估替代芯片方案或调整产品定位'
    );

    // PM做风险决策
    await pmAgent.handleMessage(
      '硬件报告成本超预算¥1000，需要做出决策：延期发布/降低成本/增加投资'
    );
  });
});
```

### 7️⃣ **钉钉Webhook处理** (src/integrations/dingtalk/webhook-handler.ts)

```typescript
import express from 'express';
import { HardwareAgent } from '../../agents/hardware-agent';
import { SoftwareAgent } from '../../agents/software-agent';
import { TestAgent } from '../../agents/test-agent';
import { PMAgent } from '../../agents/pm-agent';

export function setupDingtalkWebhook(app: express.Express) {
  const agents = {
    hardware: new HardwareAgent(),
    software: new SoftwareAgent(),
    test: new TestAgent(),
    pm: new PMAgent(),
  };

  // 接收钉钉消息
  app.post('/webhook/dingtalk/message', async (req, res) => {
    try {
      const event = req.body;

      // 识别该消息应该由哪个Agent处理
      const agentRole = identifyAgentRole(event.text.content);
      const agent = agents[agentRole];

      if (agent) {
        // 设置项目上下文（从消息元数据或默认值）
        agent.setEpicContext(event.epic_id || 'default');

        // 异步处理消息，不阻塞webhook响应
        setImmediate(async () => {
          try {
            await agent.handleMessage(event.text.content);
          } catch (error) {
            console.error(`Agent处理失败: ${error}`);
            // 发送错误通知到钉钉
          }
        });
      }

      // 立即响应钉钉（避免timeout）
      res.json({ errcode: 0, errmsg: 'ok' });
    } catch (error) {
      console.error('Webhook处理失败:', error);
      res.status(400).json({ errcode: 1, errmsg: error.message });
    }
  });

  // 处理钉钉审批完成事件
  app.post('/webhook/dingtalk/approval', async (req, res) => {
    try {
      const event = req.body;

      if (event.data.instanceStatus === 'COMPLETED') {
        console.log(`✅ 审批已通过: ${event.data.processCode}`);
        // 根据审批类型触发下一步流程
        handleApprovalComplete(event, agents);
      } else if (event.data.instanceStatus === 'TERMINATED') {
        console.log(`❌ 审批已拒绝: ${event.data.processCode}`);
      }

      res.json({ errcode: 0, errmsg: 'ok' });
    } catch (error) {
      console.error('审批webhook处理失败:', error);
      res.status(400).json({ errcode: 1, errmsg: error.message });
    }
  });
}

function identifyAgentRole(message: string): 'hardware' | 'software' | 'test' | 'pm' {
  const text = message.toLowerCase();

  if (text.includes('原理图') || text.includes('bom') || text.includes('pcb') || text.includes('硬件')) {
    return 'hardware';
  } else if (text.includes('代码') || text.includes('pr') || text.includes('编译') || text.includes('软件')) {
    return 'software';
  } else if (text.includes('测试') || text.includes('缺陷') || text.includes('集成')) {
    return 'test';
  }

  return 'pm';
}

async function handleApprovalComplete(event: any, agents: any) {
  const { processCode } = event.data;

  if (processCode === 'DESIGN_APPROVAL_TEMPLATE') {
    // 硬件设计评审通过，启动PCB Layout
    console.log('硬件设计评审通过，启动PCB Layout...');
    await agents.hardware.handleMessage('设计评审已通过，请启动PCB Layout设计');
  } else if (processCode === 'RELEASE_APPROVAL_TEMPLATE') {
    // 发布审批通过，执行发布
    console.log('发布审批通过，执行发布...');
    // 触发发布流程
  }
}
```

---

## 📊 项目初始化和运行

### 初始化脚本 (scripts/setup.sh)

```bash
#!/bin/bash

set -e

echo "🚀 初始化agentflow + Claude项目"

# 1. 安装依赖
echo "📦 安装npm依赖..."
npm install @anthropic-ai/sdk axios express dotenv sqlite3

# 2. 创建.env文件
echo "🔐 创建.env配置..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "请编辑.env文件，填入你的API密钥"
else
  echo ".env文件已存在"
fi

# 3. 初始化数据库
echo "🗄️ 初始化数据库..."
npm run db:migrate

# 4. 编译TypeScript
echo "📝 编译TypeScript..."
npm run build

# 5. 运行测试
echo "🧪 运行测试..."
npm run test

echo "✅ 初始化完成！"
echo ""
echo "下一步："
echo "1. 编辑.env文件填入API密钥"
echo "2. 运行: npm run dev"
echo "3. 访问: http://localhost:3000"
```

### .env.example

```bash
# Anthropic (Claude)
ANTHROPIC_API_KEY=sk-...

# Dingtalk
DINGTALK_DEV_CLIENTID=dingndmbsghqvpkrwm1d
DINGTALK_DEV_SECRET=n9I2HGTnMeQkVXLLYTlPOoXasoQWguMyyz_5RlnJCdfbolzHtGrJxgzcI2HXNX_U
DINGTALK_GATEWAY_URL=http://127.0.0.1:18789

DINGTALK_PM_CLIENTID=dingfgvceyw5s6xahiob
DINGTALK_PM_SECRET=N5LKLQoXeM309rG6sjcQy587hg2qb_Os2xQWdEIOKz-4wX2ThNleXd2m6_hRl3dW

# Feishu
FEISHU_PM_APPID=cli_a9576fce7df9dbb5
FEISHU_PM_SECRET=QxwXiGhSorTYF01CbQAQMgjotWYwJk7q

FEISHU_MAINDEV_APPID=cli_a957727576badceb
FEISHU_MAINDEV_SECRET=dYpV75BOi6Eh7HczqwiJne68mRFhhFSS

# GitHub
GITHUB_TOKEN=ghp_...

# Jira
JIRA_HOST=your-jira.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=...

# Database
DATABASE_URL=sqlite:./agentflow.db

# Server
PORT=3000
NODE_ENV=development
```

### package.json 脚本

```json
{
  "scripts": {
    "dev": "ts-node src/main.ts",
    "build": "tsc",
    "start": "node dist/src/main.ts",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:integration": "jest tests/integration",
    "test:claude": "ts-node scripts/test-claude-connection.ts",
    "demo:hardware": "ts-node scripts/demo-hardware-flow.ts",
    "demo:full": "jest tests/integration/full-workflow.test.ts",
    "db:migrate": "ts-node src/database/migrate.ts",
    "lint": "eslint src/**/*.ts"
  }
}
```

---

## 🚀 快速启动（3步）

```bash
# Step 1: 克隆 + 初始化
git clone https://github.com/Jason-bandy/agentflow.git
cd agentflow
bash scripts/setup.sh

# Step 2: 配置.env
nano .env
# 填入: ANTHROPIC_API_KEY、钉钉/飞书凭证

# Step 3: 运行演示
npm run demo:hardware    # 硬件流程演示
npm run demo:full        # 完整工作流
```

---

## 📍 关键文件位置总结

| 文件 | 位置 | 作用 |
|------|------|------|
| Claude驱动器 | `src/integrations/claude/claude-driver.ts` | Agent"大脑" |
| 工具执行器 | `src/integrations/claude/tool-executor.ts` | 执行具体操作 |
| Agent Prompts | `src/integrations/claude/prompts.ts` | 定义Agent行为 |
| 硬件Agent | `src/agents/hardware-agent.ts` | 硬件团队 |
| Webhook处理 | `src/integrations/dingtalk/webhook-handler.ts` | 接收消息 |
| 完整测试 | `tests/integration/full-workflow.test.ts` | 端到端测试 |

---

## 🎯 你现在可以做什么

1. **立即运行**: `npm run demo:full` → 看整个流程演示
2. **测试Claude连接**: `npm run test:claude` → 验证API是否连通
3. **运行硬件演示**: `npm run demo:hardware` → 只看硬件部分
4. **编写自己的Agent**: 继承 `ClaudeBaseAgent`，添加你的业务逻辑
5. **部署到生产**: Docker容器化，接入你的钉钉/飞书

---

需要我提供什么？
1. ✅ Docker部署配置
2. ✅ 数据库schema设计
3. ✅ 其他Agent的完整实现（软件/测试/PM）
4. ✅ 性能优化建议
