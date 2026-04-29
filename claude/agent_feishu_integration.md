# 硬件+软件混合研发多Agent编排系统 - 飞书集成实现方案

## 一、Agent-飞书Bot映射关系

基于你的5个Bot账户和2个群组，设计如下映射：

| Agent角色 | 对应飞书Bot | 主要职责 | 推送群组 | 关键权限 |
|---------|-----------|--------|--------|--------|
| **项目管理Agent** | ProductManager Bot | 任务分解、里程碑、风险预警、审批流启动 | oc_548efda87581381b2241236f3d443e30 (核心群) | 创建任务卡片、@相关人员、启动审批 |
| **硬件研发Agent** | Main Dev Bot | 原理图生成、BOM清单、PCB进度、设计评审 | oc_f0d152de2fcaab4794ea2b86ed48b02c (硬件群) | 发送设计文档卡片、文件分享、进度更新 |
| **软件研发Agent** | Main Dev Bot | 代码仓库更新、编译状态、测试覆盖率、PR提醒 | oc_f0d152de2fcaab4794ea2b86ed48b02c (开发群) | 代码推送通知、构建结果、性能指标 |
| **测试集成Agent** | Tester Bot | 测试用例执行、缺陷报告、性能数据、评审结论 | oc_548efda87581381b2241236f3d443e30 (核心群) | 缺陷追踪卡片、测试报告、风险标记 |
| **发布Agent** | ProductManager Bot | 版本管理、发布流程、回滚决策 | oc_548efda87581381b2241236f3d443e30 (核心群) | Release通知、版本标签、历史追溯 |

---

## 二、飞书API调用框架

### 2.1 Bot授权与Token管理

```javascript
// feishu-client.js
const axios = require('axios');

class FeishuClient {
  constructor(appId, appSecret) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.baseUrl = 'https://open.feishu.cn/open-apis';
    this.token = null;
    this.tokenExpires = 0;
  }

  // 获取访问Token（自动续期）
  async getToken() {
    if (this.token && Date.now() < this.tokenExpires) {
      return this.token;
    }

    const response = await axios.post(`${this.baseUrl}/auth/v3/app_access_token`, {
      app_id: this.appId,
      app_secret: this.appSecret,
    });

    if (response.data.code !== 0) {
      throw new Error(`Feishu auth failed: ${response.data.msg}`);
    }

    this.token = response.data.app_access_token;
    this.tokenExpires = Date.now() + (response.data.expire - 300) * 1000; // 提前5分钟刷新
    return this.token;
  }

  // 发送消息卡片
  async sendMessage(chatId, card) {
    const token = await this.getToken();
    const response = await axios.post(
      `${this.baseUrl}/im/v1/messages?receive_id_type=chat_id`,
      {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.data.code !== 0) {
      throw new Error(`Send message failed: ${response.data.msg}`);
    }

    return response.data.data.message_id;
  }

  // 更新消息（用于实时进度更新）
  async updateMessage(messageId, card) {
    const token = await this.getToken();
    const response = await axios.patch(
      `${this.baseUrl}/im/v1/messages/${messageId}`,
      {
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  }

  // 发送文本消息+提及
  async sendTextMessage(chatId, text, mentionUserIds = []) {
    const token = await this.getToken();
    const mentions = mentionUserIds.map(uid => ({
      id: uid,
      name: '', // 飞书会自动填充
    }));

    const response = await axios.post(
      `${this.baseUrl}/im/v1/messages?receive_id_type=chat_id`,
      {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({
          text: text,
          mentions: mentions,
        }),
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data.data.message_id;
  }

  // 创建待办任务（与飞书任务系统集成）
  async createTask(title, description, dueDate, assigneeIds = []) {
    const token = await this.getToken();
    const response = await axios.post(
      `${this.baseUrl}/task/v2/tasks`,
      {
        summary: title,
        description: description,
        due: {
          time: Math.floor(new Date(dueDate).getTime() / 1000),
        },
        assignees: assigneeIds.map(id => ({ id })),
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data.data.task_id;
  }
}

module.exports = FeishuClient;
```

### 2.2 多Bot实例管理

```javascript
// agents/feishu-bot-registry.js
const FeishuClient = require('../feishu-client');

const BOT_CONFIG = {
  dataAnalyst: {
    appId: 'cli_a95719e445a15bc9',
    appSecret: process.env.FEISHU_DATAANALYST_SECRET, // 从环境变量读取！
    groupId: 'oc_548efda87581381b2241236f3d443e30',
  },
  mainDev: {
    appId: 'cli_a957727576badceb',
    appSecret: process.env.FEISHU_MAINDEV_SECRET,
    groupId: 'oc_f0d152de2fcaab4794ea2b86ed48b02c',
  },
  productManager: {
    appId: 'cli_a9576fce7df9dbb5',
    appSecret: process.env.FEISHU_PM_SECRET,
    groupId: 'oc_548efda87581381b2241236f3d443e30', // 核心群
  },
  tester: {
    appId: 'cli_a957696854b99bdf',
    appSecret: process.env.FEISHU_TESTER_SECRET,
    groupId: 'oc_548efda87581381b2241236f3d443e30',
  },
  sales: {
    appId: 'cli_a957522d0d38dcd1',
    appSecret: process.env.FEISHU_SALES_SECRET,
    groupId: 'oc_548efda87581381b2241236f3d443e30',
  },
};

class FeishuBotRegistry {
  constructor() {
    this.clients = {};
    this.initBots();
  }

  initBots() {
    for (const [name, config] of Object.entries(BOT_CONFIG)) {
      this.clients[name] = new FeishuClient(config.appId, config.appSecret);
      this.clients[name].groupId = config.groupId;
    }
  }

  async getBot(botName) {
    if (!this.clients[botName]) {
      throw new Error(`Bot '${botName}' not found`);
    }
    return this.clients[botName];
  }
}

module.exports = new FeishuBotRegistry();
```

---

## 三、Agent实现示例

### 3.1 项目管理Agent（ProductManager Bot）

```javascript
// agents/project-manager-agent.js
const FeishuBotRegistry = require('./feishu-bot-registry');
const Anthropic = require('@anthropic-ai/sdk');

class ProjectManagerAgent {
  constructor() {
    this.client = new Anthropic();
    this.pmBot = null;
  }

  async init() {
    this.pmBot = await FeishuBotRegistry.getBot('productManager');
  }

  async processEpic(epicData) {
    // epicData: { title, description, hardwareOwner, softwareOwner, deadline, budget }

    const systemPrompt = `你是一个研发项目管理Agent，负责：
1. 分解产品Epic为硬件和软件子任务
2. 创建依赖关系和关键路径
3. 评估风险和资源需求
4. 生成飞书卡片通知相关团队

输出JSON格式，包含：
{
  "tasks": [
    { "id": "HW-001", "title": "原理图设计", "owner": "硬件主管", "dueDate": "2025-05-15", "dependencies": [] },
    ...
  ],
  "milestones": [...],
  "risks": [
    { "description": "芯片BK7252N可能停产", "impact": "高", "mitigation": "提前采购3个月库存" }
  ],
  "announcement": "飞书通知内容"
}`;

    const response = await this.client.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `
产品Epic: ${epicData.title}
描述: ${epicData.description}
硬件负责人: ${epicData.hardwareOwner}
软件负责人: ${epicData.softwareOwner}
截止日期: ${epicData.deadline}
预算: ${epicData.budget}

请分解为具体任务并评估风险。
          `,
        },
      ],
    });

    const plan = JSON.parse(response.content[0].text);

    // 发送飞书卡片到核心群
    await this.pmBot.sendMessage(
      this.pmBot.groupId,
      this.buildProjectCard(epicData, plan)
    );

    // 为每个任务创建待办
    for (const task of plan.tasks) {
      await this.pmBot.createTask(
        task.title,
        `项目: ${epicData.title}\n所有者: ${task.owner}`,
        task.dueDate,
        [task.owner] // 需要获取用户ID
      );
    }

    return plan;
  }

  buildProjectCard(epicData, plan) {
    return {
      type: 'template',
      data: {
        template_id: 'AAqkKFfMhv4W2',
        template_variable: {
          project_name: epicData.title,
          deadline: epicData.deadline,
          task_count: plan.tasks.length,
          risk_count: plan.risks.length,
          hw_owner: epicData.hardwareOwner,
          sw_owner: epicData.softwareOwner,
        },
      },
    };
  }
}

module.exports = new ProjectManagerAgent();
```

### 3.2 硬件研发Agent（Main Dev Bot）

```javascript
// agents/hardware-agent.js
const FeishuBotRegistry = require('./feishu-bot-registry');
const Anthropic = require('@anthropic-ai/sdk');

class HardwareAgent {
  constructor() {
    this.client = new Anthropic();
    this.hwBot = null;
  }

  async init() {
    this.hwBot = await FeishuBotRegistry.getBot('mainDev');
  }

  // 监听硬件设计里程碑完成
  async onSchematicDesignComplete(schematicData) {
    // schematicData: { fileName, revision, pinoutSummary, bomItems, designReviewers }

    const systemPrompt = `你是硬件研发Agent，现在原理图设计已完成。任务：
1. 总结原理图要点
2. 生成BOM成本估算
3. 标记关键风险（停产物料、成本超预算等）
4. 生成飞书评审卡片
5. 创建PCB Layout任务

输出JSON格式。`;

    const response = await this.client.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `原理图版本: ${schematicData.revision}\n引脚定义: ${schematicData.pinoutSummary}\n物料清单行数: ${schematicData.bomItems.length}`,
        },
      ],
    });

    const analysis = JSON.parse(response.content[0].text);

    // 发送评审卡片到硬件群
    const messageId = await this.hwBot.sendMessage(
      this.hwBot.groupId,
      this.buildReviewCard(schematicData, analysis)
    );

    // 如果有成本风险，@PM
    if (analysis.costRisk) {
      await this.hwBot.sendTextMessage(
        this.hwBot.groupId,
        `⚠️ 原理图${schematicData.revision}成本预警：${analysis.costRisk}`,
        ['pm-user-id'] // 需要获取PM的飞书用户ID
      );
    }

    return {
      analysisId: messageId,
      risks: analysis.risks,
      nextSteps: analysis.nextSteps,
    };
  }

  buildReviewCard(schematicData, analysis) {
    return {
      type: 'template',
      data: {
        template_id: 'AAqkKFfMhv4W2', // 使用现成的评审卡片模板
        template_variable: {
          design_phase: 'Schematic Review',
          revision: schematicData.revision,
          bom_count: schematicData.bomItems.length,
          estimated_cost: analysis.bomCost,
          risk_count: analysis.risks.length,
          reviewers: schematicData.designReviewers.join(', '),
          due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        },
      },
    };
  }
}

module.exports = new HardwareAgent();
```

### 3.3 测试Agent（Tester Bot）

```javascript
// agents/test-agent.js
const FeishuBotRegistry = require('./feishu-bot-registry');
const Anthropic = require('@anthropic-ai/sdk');

class TestAgent {
  constructor() {
    this.client = new Anthropic();
    this.testerBot = null;
  }

  async init() {
    this.testerBot = await FeishuBotRegistry.getBot('tester');
  }

  // 发送测试报告卡片
  async publishTestReport(testRunData) {
    // testRunData: { testDate, totalTests, passed, failed, performanceMetrics, defectSummary }

    const systemPrompt = `你是测试Agent。基于测试结果数据，生成：
1. 测试总结（通过率、关键缺陷）
2. 性能对比（与基线比较）
3. 风险评估（是否可发布）
4. 建议的后续行动

输出JSON格式。`;

    const response = await this.client.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `
总测试数: ${testRunData.totalTests}
通过: ${testRunData.passed}
失败: ${testRunData.failed}
性能指标: ${JSON.stringify(testRunData.performanceMetrics)}
缺陷摘要: ${testRunData.defectSummary}`,
        },
      ],
    });

    const report = JSON.parse(response.content[0].text);

    // 发送报告卡片
    const cardColor = testRunData.passed === testRunData.totalTests ? 'green' : 'red';
    await this.testerBot.sendMessage(
      this.testerBot.groupId,
      this.buildTestReportCard(testRunData, report, cardColor)
    );

    // 如果有高优缺陷，触发紧急通知
    if (report.criticalDefects && report.criticalDefects.length > 0) {
      await this.testerBot.sendTextMessage(
        this.testerBot.groupId,
        `🚨 发现${report.criticalDefects.length}个高优缺陷，需要立即处理！`,
        ['dev-lead-id', 'pm-id']
      );
    }

    return report;
  }

  buildTestReportCard(testRunData, report, color) {
    const passRate = ((testRunData.passed / testRunData.totalTests) * 100).toFixed(1);
    return {
      type: 'template',
      data: {
        template_id: 'AAqkKFfMhv4W2',
        template_variable: {
          test_date: testRunData.testDate,
          total_cases: testRunData.totalTests,
          pass_rate: `${passRate}%`,
          critical_bugs: report.criticalDefects?.length || 0,
          test_status: report.releaseReady ? '✅ 可发布' : '❌ 需修复',
          card_color: color,
        },
      },
    };
  }
}

module.exports = new TestAgent();
```

---

## 四、飞书卡片消息模板

### 4.1 任务进度卡片（JSON）

```json
{
  "type": "interactive",
  "data": {
    "type": "template",
    "template_id": "AAqkKFfMhv4W2",
    "template_variable": {
      "project_phase": "硬件设计",
      "task_title": "原理图设计完成",
      "completion_rate": "85%",
      "owner": "张三",
      "due_date": "2025-05-15",
      "status": "进行中",
      "next_milestone": "PCB Layout",
      "blockers": "等待芯片供应商确认"
    }
  }
}
```

### 4.2 缺陷追踪卡片（JSON）

```json
{
  "type": "interactive",
  "data": {
    "type": "template",
    "template_id": "AAqkKFfMhv4W2",
    "template_variable": {
      "defect_id": "BUG-042",
      "title": "LCD通信协议错误",
      "severity": "🔴 高",
      "status": "分配待修复",
      "assigned_to": "李四（软件）",
      "found_in": "集成测试",
      "root_cause": "SPI时序与数据手册不符",
      "impact": "LCD显示为空白",
      "action_items": "1. 调整SPI时钟\n2. 重新测试\n3. 回归硬件设计"
    }
  }
}
```

### 4.3 性能对比卡片（JSON）

```json
{
  "type": "interactive",
  "data": {
    "type": "template",
    "template_id": "AAqkKFfMhv4W2",
    "template_variable": {
      "metric": "固件大小",
      "previous_version": "127.2 KB",
      "current_version": "135.8 KB",
      "change": "+8.6 KB (+6.8%)",
      "trend": "📈 上升",
      "baseline": "150 KB（Flash限制）",
      "status": "⚠️ 接近限制，需优化"
    }
  }
}
```

---

## 五、Webhook反向推送（飞书触发Agent）

### 5.1 飞书群消息触发（例如审批完成）

```javascript
// webhook-handler.js
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const FEISHU_VERIFY_TOKEN = process.env.FEISHU_VERIFY_TOKEN;

// 飞书webhook验证
function verifyFeishuSignature(timestamp, nonce, body) {
  const signContent = timestamp + nonce + FEISHU_VERIFY_TOKEN;
  const signature = crypto
    .createHmac('sha256', process.env.FEISHU_ENCRYPT_KEY)
    .update(signContent)
    .digest('hex');
  return signature;
}

app.post('/webhook/feishu', (req, res) => {
  const { timestamp, nonce, signature } = req.headers['x-lark-signature'];

  // 验证签名
  const expectedSig = verifyFeishuSignature(timestamp, nonce, req.body);
  if (signature !== expectedSig) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // 响应飞书challenge
  if (req.body.type === 'url_verification') {
    return res.json({ challenge: req.body.challenge });
  }

  // 处理消息事件
  if (req.body.type === 'event_callback') {
    const event = req.body.event;

    // 审批通过事件
    if (event.type === 'approval_instance' && event.status === 'APPROVED') {
      handleApprovalApproved(event);
    }

    // 群消息事件（例如@机器人）
    if (event.type === 'message' && event.message.mentions) {
      handleMentionedMessage(event);
    }
  }

  res.json({ code: 0 });
});

async function handleApprovalApproved(event) {
  console.log('审批已通过:', event.approval_id);
  // 触发后续Agent动作
  // 例如：原理图评审通过 -> 启动PCB Layout任务
}

async function handleMentionedMessage(event) {
  const text = event.message.content.text;
  console.log('被@提及:', text);
  // 例如：@ProductManager Bot "开始集成测试" -> 触发Test Agent
}

app.listen(3000, () => console.log('Webhook server running on port 3000'));
```

---

## 六、Agent协调编排引擎

### 6.1 任务状态机

```javascript
// workflow-engine.js
class WorkflowEngine {
  constructor() {
    this.tasks = new Map();
    this.agents = {};
  }

  // 定义研发流程的状态转移
  async executeWorkflow(epicId, epicData) {
    const workflow = [
      {
        stage: 'RequirementAnalysis',
        agent: 'projectManager',
        action: 'processEpic',
        nextStageOn: 'success',
      },
      {
        stage: 'HardwareDesign',
        agent: 'hardware',
        action: 'designSchematic',
        dependencies: ['RequirementAnalysis'],
        parallel: true, // 与SoftwareDesign并行
      },
      {
        stage: 'SoftwareDesign',
        agent: 'software',
        action: 'setupDevelopment',
        dependencies: ['RequirementAnalysis', 'HardwareDesign'], // 需要硬件接口定义
        parallel: true,
      },
      {
        stage: 'SchematicReview',
        agent: 'projectManager',
        action: 'reviewSchematic',
        dependencies: ['HardwareDesign'],
        blocking: true, // 需要人工审批
      },
      {
        stage: 'PCBLayout',
        agent: 'hardware',
        action: 'layoutPCB',
        dependencies: ['SchematicReview'],
      },
      {
        stage: 'Integration',
        agent: 'test',
        action: 'runIntegrationTests',
        dependencies: ['PCBLayout', 'SoftwareDesign'],
      },
      {
        stage: 'Release',
        agent: 'releaseManager',
        action: 'publishRelease',
        dependencies: ['Integration'],
        blocking: true, // CEO签字
      },
    ];

    for (const stage of workflow) {
      try {
        // 等待依赖完成
        if (stage.dependencies) {
          await this.waitForDependencies(epicId, stage.dependencies);
        }

        // 执行当前阶段
        const result = await this.executeStage(epicId, stage, epicData);

        // 如果失败且非关键，发送通知
        if (!result.success && !stage.blocking) {
          console.error(`Stage ${stage.stage} failed, notifying team...`);
          // 发送通知给项目经理
        }
      } catch (error) {
        console.error(`Workflow error in ${stage.stage}:`, error);
        if (stage.blocking) {
          throw error; // 关键阶段失败则中止
        }
      }
    }
  }

  async waitForDependencies(epicId, dependencies) {
    // 等待所有依赖的stage完成
    const maxWait = 60000; // 60秒超时
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const allDone = dependencies.every(dep =>
        this.getStageStatus(epicId, dep) === 'completed'
      );
      if (allDone) return;
      await new Promise(r => setTimeout(r, 1000));
    }

    throw new Error(`Dependencies timeout: ${dependencies.join(', ')}`);
  }

  async executeStage(epicId, stage, epicData) {
    const agent = this.agents[stage.agent];
    if (!agent) throw new Error(`Agent ${stage.agent} not found`);

    const result = await agent[stage.action](epicData);
    this.saveStageResult(epicId, stage.stage, result);
    return { success: true, ...result };
  }

  getStageStatus(epicId, stageName) {
    // 从数据库获取阶段状态
    // 返回: 'pending' | 'in_progress' | 'completed' | 'failed'
  }

  saveStageResult(epicId, stageName, result) {
    // 保存结果到数据库
  }
}

module.exports = WorkflowEngine;
```

---

## 七、安全性注意事项

### ⚠️ 不要做这些

```javascript
// ❌ 错误：appSecret硬编码在代码中
const client = new FeishuClient('cli_xxx', 'lgXqfFEl52hwN2nNcRUOmcLUJTP3hYPq');

// ✅ 正确：从环境变量读取
const client = new FeishuClient(
  process.env.FEISHU_APPID,
  process.env.FEISHU_APPSECRET
);
```

### .env 文件示例

```bash
FEISHU_DATAANALYST_SECRET=lgXqfFEl52hwN2nNcRUOmcLUJTP3hYPq
FEISHU_MAINDEV_SECRET=dYpV75BOi6Eh7HczqwiJne68mRFhhFSS
FEISHU_PM_SECRET=QxwXiGhSorTYF01CbQAQMgjotWYwJk7q
FEISHU_TESTER_SECRET=OxLwESSYbfJV5VmQMjvbqbzNTGXDBd6D
FEISHU_SALES_SECRET=sNvZmknwnyulcZ8b1PpRxC288p5hSOGR
FEISHU_VERIFY_TOKEN=your_verify_token
FEISHU_ENCRYPT_KEY=your_encrypt_key
```

### 权限最小化原则

- 每个Bot只关联一个功能（PM Bot只做任务审批，不做代码推送）
- 定期轮换appSecret
- 使用飞书的权限管理，限制Bot能访问的群组（你已经在用allowlist）
- 记录所有Bot的操作日志

---

## 八、使用案例：完整流转

### BK7252N热敏打印机研发启动

```javascript
// main.js
const ProjectManagerAgent = require('./agents/project-manager-agent');
const HardwareAgent = require('./agents/hardware-agent');
const SoftwareAgent = require('./agents/software-agent');
const TestAgent = require('./agents/test-agent');
const WorkflowEngine = require('./workflow-engine');

async function main() {
  await ProjectManagerAgent.init();
  await HardwareAgent.init();

  // Step 1: 创建产品Epic
  const epicData = {
    title: 'BK7252N AI热敏打印机（KoiNote硬件版）',
    description: '集成BK7252N芯片的便携热敏打印机，支持AI对话打印输出',
    hardwareOwner: 'zhengzhican-hw',
    softwareOwner: 'zhengzhican-sw',
    deadline: '2025-07-31',
    budget: '¥50,000',
  };

  // Step 2: 项目经理Agent分解任务并发送飞书通知
  console.log('📋 项目经理Agent启动...');
  const plan = await ProjectManagerAgent.processEpic(epicData);
  console.log(`✅ 已创建${plan.tasks.length}个任务，发送飞书通知`);

  // Step 3: 硬件Agent开始设计（模拟完成）
  console.log('\n⚙️ 硬件Agent启动...');
  const hwResult = await HardwareAgent.onSchematicDesignComplete({
    fileName: 'BK7252N_v1.0.sch',
    revision: 'v1.0',
    pinoutSummary: '26MHz晶振, SPI LCD (P10-P15), UART日志 (P18-P19)',
    bomItems: [
      { part: 'BK7252N', qty: 1, cost: 85 },
      { part: '26MHz晶振', qty: 1, cost: 12 },
      { part: 'ST7789', qty: 1, cost: 8 },
      // ... 更多物料
    ],
    designReviewers: ['pm@company.com', 'cto@company.com'],
  });
  console.log(`✅ 原理图已发送评审，${hwResult.risks.length}个风险已标记`);

  // Step 4: 监听飞书审批完成（在实际应用中由webhook触发）
  // 这里模拟审批通过
  console.log('\n✅ 飞书收到审批通过事件');

  // Step 5: PCB Layout启动（依赖审批）
  console.log('\n🔧 PCB Layout Agent启动...');
  // await HardwareAgent.startPCBLayout({ ... });

  console.log('\n📊 完整工作流已启动，所有Agent正在协调执行');
}

main().catch(console.error);
```

---

## 九、下一步

1. **环境配置**：创建 `.env` 文件，放入你的appSecret
2. **Bot连接测试**：运行 `node test-feishu-connection.js` 验证Token获取
3. **消息模板**：在飞书中创建自定义卡片模板，替换 `template_id`
4. **Webhook部署**：在飞书App管理后台配置webhook URL（需要公网服务器或内网穿透）
5. **数据库**：设计任务状态表（epic_id, stage, status, timestamp）
6. **监控告警**：添加失败重试机制和AlertManager集成

---

**关键文件结构**

```
project-root/
├── feishu-client.js              # 飞书API客户端
├── agents/
│   ├── feishu-bot-registry.js    # Bot管理
│   ├── project-manager-agent.js
│   ├── hardware-agent.js
│   ├── software-agent.js
│   └── test-agent.js
├── workflow-engine.js             # 编排引擎
├── webhook-handler.js             # 飞书webhook
├── main.js                        # 入口
├── .env                          # 环保密钥
└── package.json
```

这套框架支持你的硬件+软件混合研发全流程。建议从**项目经理Agent**开始实现，逐步集成其他Agent。
