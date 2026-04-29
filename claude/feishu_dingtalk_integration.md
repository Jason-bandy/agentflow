# 硬件+软件研发多Agent系统 - 飞书+钉钉双通道架构

## 一、平台角色划分

### 飞书 vs 钉钉：谁做什么？

| 功能模块 | 飞书（被动通知） | 钉钉（主动交互） |
|---------|-----------------|-----------------|
| **任务创建** | ✅ Epic分解、任务列表 | ❌ |
| **实时消息通知** | ✅ 设计评审卡片、测试报告 | ❌ |
| **文档协作** | ✅ 原理图共享、BOM编辑 | ❌ |
| **流程审批** | ❌ | ✅ 设计评审、发布审批、重大决策 |
| **实时聊天交互** | ❌ | ✅ Agent与人员对话、即时反馈 |
| **Bot自动处理** | ❌ | ✅ 接收命令、执行任务、异步回复 |
| **群组管理** | ✅ 大会议室（多人参与） | ✅ 工作群（工作流专属） |

---

## 二、钉钉Gateway本地部署架构

你使用的是**钉钉本地网关模式**，架构如下：

```
┌─────────────────────────────────────────────────────────┐
│             钉钉云（钉钉服务器）                          │
└────────────────────┬────────────────────────────────────┘
                     │ (websocket/http)
                     ↓
        ┌────────────────────────────┐
        │  本地Gateway              │
        │  :18789                   │
        │  (可视为本地消息路由器)    │
        └────────┬─────────┬────────┘
                 │         │
        ┌────────↓─┐   ┌──↓──────────┐
        │  dev Bot  │   │aftersale Bot│
        │           │   │             │
        │ asyncMode │   │ asyncMode   │
        │  = true   │   │  = true     │
        └───────────┘   └─────────────┘
```

**关键特性**：
- asyncMode=true: Bot收到消息后立即返回ack，后续异步处理
- sharedMemoryAcrossConversations: 跨conversation保持state（Agent可记住context）
- Gateway Local Token保证安全性

---

## 三、Agent-Bot平台映射关系（完整版）

```javascript
// agent-bot-mapping.js
const AGENT_BOT_MAPPING = {
  // ===== 硬件研发流程 =====
  'HardwareAgent': {
    // 硬件设计完成后，发送飞书评审通知 + 钉钉审批流
    notificationChannel: 'feishu',  // 飞书通知原理图完成
    feishuBot: 'main-dev',           // 使用Main Dev Bot
    feishuGroup: 'oc_f0d152de2fcaab4794ea2b86ed48b02c', // 硬件群

    approvalChannel: 'dingtalk',     // 钉钉启动审批流
    dingtalkBot: 'dev',              // 开发Bot（与HW对应）
    
    tasks: {
      'SchematicDesignReview': {
        reviewers: ['hw-lead@company.com'],
        dingtalkApprovalType: 'SCHEMATIC_REVIEW', // 自定义审批模板
        timeoutHours: 48,
      },
      'PCBLayoutReview': {
        reviewers: ['hw-lead@company.com', 'cto@company.com'],
        dingtalkApprovalType: 'PCB_REVIEW',
        timeoutHours: 72,
      },
    },
  },

  // ===== 软件研发流程 =====
  'SoftwareAgent': {
    notificationChannel: 'feishu',
    feishuBot: 'main-dev',
    feishuGroup: 'oc_f0d152de2fcaab4794ea2b86ed48b02c', // 开发群

    // 代码PR需要在钉钉中自动创建任务 + 提醒
    approvalChannel: 'dingtalk',
    dingtalkBot: 'dev',
    
    tasks: {
      'CodeReview': {
        reviewers: ['sw-lead@company.com'],
        dingtalkApprovalType: 'CODE_REVIEW',
        autoCreateTaskOnGitHubPR: true, // 自动在GitHub PR时创建钉钉任务
      },
    },
  },

  // ===== 项目管理流程 =====
  'ProjectManagerAgent': {
    notificationChannel: 'both', // 既发飞书又发钉钉
    feishuBot: 'productmanager',
    dingtalkBot: 'projectmanager',
    
    tasks: {
      'ProjectKickoff': {
        notifyChannels: ['feishu', 'dingtalk'],
        dingtalkApprovalType: 'PROJECT_APPROVAL', // CEO签字
        stakeholders: ['cto@company.com', 'pm@company.com'],
      },
      'ReleaseApproval': {
        reviewers: ['cto@company.com', 'cfo@company.com'],
        dingtalkApprovalType: 'RELEASE_APPROVAL',
        timeoutHours: 24,
      },
    },
  },

  // ===== 测试验证流程 =====
  'TestAgent': {
    notificationChannel: 'feishu',
    feishuBot: 'tester',
    feishuGroup: 'oc_548efda87581381b2241236f3d443e30', // 核心群

    // 高优缺陷需要钉钉实时任务分配
    dingtalkBot: 'dev',
    criticalDefectEscalation: {
      severity: 'CRITICAL',
      escalateTo: 'dingtalk', // 立即创建钉钉任务
      notifyUsers: ['dev-lead', 'sw-lead', 'hw-lead'],
    },
  },

  // ===== 其他支持部门 =====
  'SalesAgent': {
    dingtalkBot: 'sales',
    tasks: {
      'ProductReleaseAnnouncement': {},
    },
  },

  'HRAgent': {
    dingtalkBot: 'hr',
    tasks: {
      'TeamCapacityPlanning': {},
    },
  },
};

module.exports = AGENT_BOT_MAPPING;
```

---

## 四、钉钉Gateway API集成

### 4.1 钉钉客户端（通过本地Gateway）

```javascript
// dingtalk-client.js
const axios = require('axios');

class DingtalkClient {
  constructor(clientId, clientSecret, gatewayBaseUrl = 'http://127.0.0.1:18789') {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.gatewayBaseUrl = gatewayBaseUrl;
    this.token = null;
    this.tokenExpires = 0;
  }

  // 通过Gateway获取访问Token
  async getToken() {
    if (this.token && Date.now() < this.tokenExpires) {
      return this.token;
    }

    try {
      const response = await axios.post(
        `${this.gatewayBaseUrl}/oauth2/token`,
        {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'client_credentials',
        }
      );

      if (response.data.errcode !== 0) {
        throw new Error(`Dingtalk auth failed: ${response.data.errmsg}`);
      }

      this.token = response.data.access_token;
      this.tokenExpires = Date.now() + (response.data.expires_in - 300) * 1000;
      return this.token;
    } catch (error) {
      console.error('Failed to get Dingtalk token:', error.message);
      throw error;
    }
  }

  // 发送文本消息到群组
  async sendMessage(conversationId, text, mentions = []) {
    const token = await this.getToken();

    const at = mentions.length > 0
      ? {
          atUserIds: mentions,
          isAtAll: false,
        }
      : null;

    const response = await axios.post(
      `${this.gatewayBaseUrl}/v1.0/message/send`,
      {
        conversationId, // 群组ID或用户ID
        msgtype: 'text',
        text: {
          content: text,
        },
        at: at,
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.data.errcode !== 0) {
      throw new Error(`Send message failed: ${response.data.errmsg}`);
    }

    return response.data.messageId;
  }

  // 发送卡片消息（Markdown格式）
  async sendCard(conversationId, cardContent) {
    const token = await this.getToken();

    const response = await axios.post(
      `${this.gatewayBaseUrl}/v1.0/message/send`,
      {
        conversationId,
        msgtype: 'action_card', // 钉钉的交互卡片
        actionCard: cardContent,
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data.messageId;
  }

  // 创建审批流程实例
  async startApprovalProcess(processCode, formData, approvers) {
    const token = await this.getToken();

    const response = await axios.post(
      `${this.gatewayBaseUrl}/v1.0/workflow/processinstances`,
      {
        processCode, // 审批流程模板ID（在钉钉后台配置）
        originatorUserId: formData.initiator,
        approvers: approvers.map(user => ({
          userId: user.id,
          actionType: user.actionType || 'NONE', // CC, APPROVE等
        })),
        formComponentValues: [
          {
            name: 'text_field',
            value: formData.title,
          },
          {
            name: 'textarea_field',
            value: formData.description,
          },
          // 更多表单字段...
        ],
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.data.errcode !== 0) {
      throw new Error(`Start approval failed: ${response.data.errmsg}`);
    }

    return {
      instanceId: response.data.result.instanceId,
      approvalUrl: response.data.result.url,
    };
  }

  // 创建任务（待办）
  async createTask(title, description, assignee, dueDate) {
    const token = await this.getToken();

    const response = await axios.post(
      `${this.gatewayBaseUrl}/v1.0/task/create`,
      {
        subject: title,
        description: description,
        assignee: assignee, // 用户ID
        dueTime: new Date(dueDate).getTime(),
        priority: 'NORMAL',
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data.taskId;
  }

  // 获取用户信息（用于获取钉钉用户ID）
  async getUserByEmail(email) {
    const token = await this.getToken();

    const response = await axios.get(
      `${this.gatewayBaseUrl}/v1.0/user/get`,
      {
        params: {
          email: email,
        },
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    return response.data.result;
  }
}

module.exports = DingtalkClient;
```

### 4.2 钉钉Bot注册表

```javascript
// agents/dingtalk-bot-registry.js
const DingtalkClient = require('../dingtalk-client');

const DINGTALK_CONFIG = {
  dev: {
    clientId: 'dingndmbsghqvpkrwm1d',
    clientSecret: process.env.DINGTALK_DEV_SECRET,
    gatewayBaseUrl: process.env.DINGTALK_GATEWAY_URL || 'http://127.0.0.1:18789',
    groupId: process.env.DINGTALK_DEV_GROUP_ID, // 开发群ID
  },
  aftersale: {
    clientId: 'dingopxjerykkiycoytz',
    clientSecret: process.env.DINGTALK_AFTERSALE_SECRET,
    gatewayBaseUrl: process.env.DINGTALK_GATEWAY_URL || 'http://127.0.0.1:18789',
  },
  sales: {
    clientId: 'dingkte9zrzbodqruy1o',
    clientSecret: process.env.DINGTALK_SALES_SECRET,
    gatewayBaseUrl: process.env.DINGTALK_GATEWAY_URL || 'http://127.0.0.1:18789',
  },
  hr: {
    clientId: 'ding53lutkwkwz3ay2y3',
    clientSecret: process.env.DINGTALK_HR_SECRET,
    gatewayBaseUrl: process.env.DINGTALK_GATEWAY_URL || 'http://127.0.0.1:18789',
  },
  productmanager: {
    clientId: 'dingjvsty58hr0kog0sx',
    clientSecret: process.env.DINGTALK_PM_SECRET,
    gatewayBaseUrl: process.env.DINGTALK_GATEWAY_URL || 'http://127.0.0.1:18789',
  },
  projectmanager: {
    clientId: 'dingfgvceyw5s6xahiob',
    clientSecret: process.env.DINGTALK_PROJECTMANAGER_SECRET,
    gatewayBaseUrl: process.env.DINGTALK_GATEWAY_URL || 'http://127.0.0.1:18789',
  },
};

class DingtalkBotRegistry {
  constructor() {
    this.clients = {};
    this.initBots();
  }

  initBots() {
    for (const [name, config] of Object.entries(DINGTALK_CONFIG)) {
      this.clients[name] = new DingtalkClient(
        config.clientId,
        config.clientSecret,
        config.gatewayBaseUrl
      );
      this.clients[name].groupId = config.groupId;
    }
  }

  async getBot(botName) {
    if (!this.clients[botName]) {
      throw new Error(`Dingtalk bot '${botName}' not found`);
    }
    return this.clients[botName];
  }
}

module.exports = new DingtalkBotRegistry();
```

---

## 五、双通道消息分发

### 5.1 统一消息分发器

```javascript
// message-dispatcher.js
const FeishuBotRegistry = require('./agents/feishu-bot-registry');
const DingtalkBotRegistry = require('./agents/dingtalk-bot-registry');

class MessageDispatcher {
  // 发送通知消息（飞书为主）
  static async notifyTeam(channel, options) {
    // channel: 'hardware' | 'software' | 'testing' | 'core'
    // options: { title, message, mentions, severity }

    const mapping = {
      hardware: {
        feishu: { bot: 'main-dev', group: 'oc_f0d152de2fcaab4794ea2b86ed48b02c' },
      },
      software: {
        feishu: { bot: 'main-dev', group: 'oc_f0d152de2fcaab4794ea2b86ed48b02c' },
      },
      testing: {
        feishu: { bot: 'tester', group: 'oc_548efda87581381b2241236f3d443e30' },
      },
      core: {
        feishu: { bot: 'productmanager', group: 'oc_548efda87581381b2241236f3d443e30' },
        dingtalk: { bot: 'projectmanager' }, // 重大决策同步到钉钉
      },
    };

    const config = mapping[channel];
    if (!config) throw new Error(`Unknown channel: ${channel}`);

    // 发送飞书通知
    if (config.feishu) {
      const feishuBot = await FeishuBotRegistry.getBot(config.feishu.bot);
      await feishuBot.sendMessage(
        config.feishu.group,
        this.buildNotificationCard(options)
      );
    }

    // 发送钉钉同步（如果重要级别高）
    if (config.dingtalk && options.severity === 'CRITICAL') {
      const dingtalkBot = await DingtalkBotRegistry.getBot(config.dingtalk.bot);
      await dingtalkBot.sendMessage(
        config.dingtalk.groupId,
        `🚨 ${options.title}\n${options.message}`
      );
    }
  }

  // 启动审批流程（钉钉专属）
  static async startApprovalFlow(processType, options) {
    // processType: 'DESIGN_REVIEW' | 'CODE_REVIEW' | 'RELEASE' | 'PROJECT'
    // options: { title, description, initiator, approvers, formData }

    const processMapping = {
      'DESIGN_REVIEW': {
        bot: 'dev',
        processCode: 'DESIGN_APPROVAL_TEMPLATE',
        approvers: options.approvers || ['hw-lead@company.com'],
      },
      'CODE_REVIEW': {
        bot: 'dev',
        processCode: 'CODE_REVIEW_TEMPLATE',
        approvers: options.approvers || ['sw-lead@company.com'],
      },
      'RELEASE': {
        bot: 'projectmanager',
        processCode: 'RELEASE_APPROVAL_TEMPLATE',
        approvers: ['cto@company.com', 'cfo@company.com'],
      },
      'PROJECT': {
        bot: 'projectmanager',
        processCode: 'PROJECT_APPROVAL_TEMPLATE',
        approvers: ['cto@company.com'],
      },
    };

    const config = processMapping[processType];
    if (!config) throw new Error(`Unknown approval type: ${processType}`);

    const dingtalkBot = await DingtalkBotRegistry.getBot(config.bot);
    const approval = await dingtalkBot.startApprovalProcess(
      config.processCode,
      {
        initiator: options.initiator,
        title: options.title,
        description: options.description,
      },
      config.approvers
    );

    return approval;
  }

  // 创建待办任务（钉钉实时分配）
  static async assignTask(assignee, taskData) {
    // taskData: { title, description, dueDate, priority, linkedResource }

    const dingtalkBot = await DingtalkBotRegistry.getBot('dev');
    const taskId = await dingtalkBot.createTask(
      taskData.title,
      taskData.description,
      assignee,
      taskData.dueDate
    );

    // 同时在飞书创建待办（备份）
    const feishuBot = await FeishuBotRegistry.getBot('productmanager');
    await feishuBot.createTask(
      taskData.title,
      taskData.description,
      taskData.dueDate,
      [assignee]
    );

    return taskId;
  }

  buildNotificationCard(options) {
    const severityColor = {
      'INFO': 'blue',
      'WARNING': 'orange',
      'CRITICAL': 'red',
    };

    return {
      type: 'template',
      data: {
        template_id: 'AAqkKFfMhv4W2',
        template_variable: {
          notification_title: options.title,
          notification_message: options.message,
          severity_level: options.severity || 'INFO',
          severity_color: severityColor[options.severity] || 'gray',
          mentions: options.mentions?.join(', ') || 'N/A',
        },
      },
    };
  }
}

module.exports = MessageDispatcher;
```

### 5.2 Agent使用示例

```javascript
// agents/hardware-agent-v2.js
const MessageDispatcher = require('../message-dispatcher');
const Anthropic = require('@anthropic-ai/sdk');

class HardwareAgent {
  constructor() {
    this.client = new Anthropic();
  }

  async onSchematicReviewComplete(schematicData, reviewStatus) {
    // reviewStatus: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED'

    if (reviewStatus === 'APPROVED') {
      // 发送飞书通知（所有人可见）
      await MessageDispatcher.notifyTeam('hardware', {
        title: '✅ 原理图设计评审通过',
        message: `版本 ${schematicData.revision} 已获批准，可进行PCB Layout。`,
        severity: 'INFO',
      });

      // 自动创建PCB Layout任务（分配给硬件工程师）
      await MessageDispatcher.assignTask('hw-engineer@company.com', {
        title: `PCB Layout - ${schematicData.revision}`,
        description: `基于${schematicData.revision}原理图进行PCB设计`,
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        priority: 'HIGH',
      });
    } else if (reviewStatus === 'CHANGES_REQUESTED') {
      // 发送飞书通知 + 钉钉紧急任务
      await MessageDispatcher.notifyTeam('hardware', {
        title: '⚠️ 原理图需要修改',
        message: `评审意见：${schematicData.comments}`,
        mentions: ['hw-lead@company.com'],
        severity: 'WARNING',
      });

      // 创建钉钉任务，立即分配给硬件主管
      await MessageDispatcher.assignTask('hw-lead@company.com', {
        title: `修改原理图 - ${schematicData.revision}`,
        description: schematicData.comments,
        dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        priority: 'URGENT',
      });
    }
  }

  async onPCBLayoutComplete(pcbData) {
    // PCB Layout完成后，启动钉钉审批流程
    const approval = await MessageDispatcher.startApprovalFlow('DESIGN_REVIEW', {
      title: `PCB设计评审 - ${pcbData.revision}`,
      description: `${pcbData.description}\n\nGerber文件：${pcbData.gerberUrl}`,
      initiator: 'zhengzhican@company.com',
      approvers: ['hw-lead@company.com', 'cto@company.com'],
    });

    // 发送飞书通知，包含钉钉审批链接
    await MessageDispatcher.notifyTeam('hardware', {
      title: '🔔 PCB设计评审已启动',
      message: `请在钉钉中完成审批：${approval.approvalUrl}\n\nGerber文件已上传，评审期限：48小时`,
      mentions: ['hw-lead@company.com'],
      severity: 'INFO',
    });
  }
}

module.exports = new HardwareAgent();
```

---

## 六、钉钉审批流程配置

在钉钉管理后台配置以下审批流程模板：

### 6.1 硬件设计评审流程

```
模板名称: DESIGN_APPROVAL_TEMPLATE
步骤1: 提交审批
  - 发起人：硬件工程师
  - 表单字段：
    * 原理图版本
    * Gerber文件链接
    * BOM清单
    * 技术总结

步骤2: 审批
  - 审批人：硬件主管 + CTO
  - 审批方式：逐级审批（硬件主管先，CTO后）
  - 超时处理：48小时超时自动催办

步骤3: 完成
  - 条件：所有审批人都同意
  - 回调：调用Agent webhook（见下一节）
```

### 6.2 发布审批流程

```
模板名称: RELEASE_APPROVAL_TEMPLATE
步骤1: 提交发布申请
  - 发起人：PM
  - 表单字段：
    * 版本号
    * 发版说明
    * 风险评估
    * 性能指标

步骤2: 技术评审
  - 审批人：CTO

步骤3: 财务审批
  - 审批人：CFO（可选，根据产品类型）

步骤4: 最终批准
  - 审批人：CEO
  - 备注：CEO签字后自动触发Release Agent
```

---

## 七、钉钉Webhook回调处理

```javascript
// webhook-dingtalk-handler.js
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// 钉钉webhook验证
function verifyDingtalkSignature(timestamp, sign, body, signSecret) {
  const signContent = timestamp + '\n' + signSecret;
  const computedSign = crypto
    .createHmac('sha256', signSecret)
    .update(signContent)
    .digest('base64');
  return sign === computedSign;
}

// 处理钉钉审批完成事件
app.post('/webhook/dingtalk/approval', (req, res) => {
  const { timestamp, sign } = req.headers;
  const signSecret = process.env.DINGTALK_SIGN_SECRET;

  // 验证签名
  if (!verifyDingtalkSignature(timestamp, sign, req.body, signSecret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body;

  if (event.type === 'WORKFLOW_INSTANCE_EVENT') {
    const instance = event.data;

    switch (instance.processCode) {
      case 'DESIGN_APPROVAL_TEMPLATE':
        handleDesignApprovalComplete(instance);
        break;

      case 'CODE_REVIEW_TEMPLATE':
        handleCodeReviewComplete(instance);
        break;

      case 'RELEASE_APPROVAL_TEMPLATE':
        handleReleaseApprovalComplete(instance);
        break;
    }
  }

  res.json({ errcode: 0, errmsg: 'ok' });
});

async function handleDesignApprovalComplete(instance) {
  console.log('设计评审完成:', instance.instanceId);

  if (instance.status === 'COMPLETED') {
    console.log('✅ 硬件设计评审已通过');
    // 触发下一步：启动PCB Layout任务
    // 或：通知HardwareAgent进行下一步操作
  } else if (instance.status === 'TERMINATED') {
    console.log('❌ 硬件设计评审被拒绝');
    // 通知硬件工程师修改
  }
}

async function handleCodeReviewComplete(instance) {
  console.log('代码评审完成:', instance.instanceId);
  // 触发测试Agent进行代码集成测试
}

async function handleReleaseApprovalComplete(instance) {
  console.log('发布审批完成:', instance.instanceId);

  if (instance.status === 'COMPLETED') {
    console.log('✅ 发布已获批准');
    // 触发Release Agent执行发布
    // 发送飞书通知所有相关人员
  }
}

app.listen(3001, () => console.log('Dingtalk webhook server running on port 3001'));
```

---

## 八、.env配置文件

```bash
# Feishu Configuration
FEISHU_DATAANALYST_SECRET=lgXqfFEl52hwN2nNcRUOmcLUJTP3hYPq
FEISHU_MAINDEV_SECRET=dYpV75BOi6Eh7HczqwiJne68mRFhhFSS
FEISHU_PM_SECRET=QxwXiGhSorTYF01CbQAQMgjotWYwJk7q
FEISHU_TESTER_SECRET=OxLwESSYbfJV5VmQMjvbqbzNTGXDBd6D
FEISHU_SALES_SECRET=sNvZmknwnyulcZ8b1PpRxC288p5hSOGR

# Dingtalk Configuration
DINGTALK_DEV_SECRET=n9I2HGTnMeQkVXLLYTlPOoXasoQWguMyyz_5RlnJCdfbolzHtGrJxgzcI2HXNX_U
DINGTALK_AFTERSALE_SECRET=K87aDAJuVuY0lM-Cgw_cPcMr5ELzGR7dTkh0FcplRnp74o1VZawN8jnGppFHoFzv
DINGTALK_SALES_SECRET=RH0w4jdXKHqhEJMMS3gfkDVLzWQuU2uoSLBoHNbHvmR0VsOG62SxfFZFokgaMCN3
DINGTALK_HR_SECRET=IjlL-h5jSqDmVqCzX6j-jMKKf_8H8JW1Qlf5_FwVOUh8kWrVdOXHsVjco7GgCOxm
DINGTALK_PM_SECRET=4qUWCDtk7Az5FZe7BC8pZyswfoEotyRDtLyRDA8CUyLKjWnLlA8IZssCRQOPX7jD
DINGTALK_PROJECTMANAGER_SECRET=N5LKLQoXeM309rG6sjcQy587hg2qb_Os2xQWdEIOKz-4wX2ThNleXd2m6_hRl3dW
DINGTALK_GATEWAY_URL=http://127.0.0.1:18789
DINGTALK_SIGN_SECRET=your_webhook_sign_secret

# Approval Process Templates (在钉钉后台配置后，填写这些ID)
DINGTALK_DESIGN_APPROVAL_CODE=DESIGN_APPROVAL_TEMPLATE
DINGTALK_CODE_REVIEW_CODE=CODE_REVIEW_TEMPLATE
DINGTALK_RELEASE_APPROVAL_CODE=RELEASE_APPROVAL_TEMPLATE
DINGTALK_PROJECT_APPROVAL_CODE=PROJECT_APPROVAL_TEMPLATE

# User Mappings
DINGTALK_HW_LEAD_ID=ou_xxx_hw_lead
DINGTALK_SW_LEAD_ID=ou_xxx_sw_lead
DINGTALK_PM_ID=ou_xxx_pm
DINGTALK_CTO_ID=ou_xxx_cto
```

---

## 九、完整流转示例

### BK7252N项目启动 → 完成发布

```javascript
// integration-example.js
const ProjectManagerAgent = require('./agents/project-manager-agent');
const HardwareAgent = require('./agents/hardware-agent-v2');
const SoftwareAgent = require('./agents/software-agent');
const TestAgent = require('./agents/test-agent');
const ReleaseAgent = require('./agents/release-agent');
const MessageDispatcher = require('./message-dispatcher');

async function executeFullWorkflow() {
  console.log('🚀 启动BK7252N硬件+软件混合研发工作流');

  // ===== Phase 1: 项目启动 =====
  console.log('\n📋 Phase 1: 项目启动');

  // PM发起项目审批（钉钉）
  const projectApproval = await MessageDispatcher.startApprovalFlow('PROJECT', {
    title: 'BK7252N AI热敏打印机产品立项',
    description: '集成BK7252N芯片的便携热敏打印机原型开发',
    initiator: 'pm@company.com',
  });

  console.log('📧 钉钉发布审批流，等待CEO签字...');
  console.log('🔗 审批链接:', projectApproval.approvalUrl);

  // 等待审批完成（通过webhook回调）
  // ... (webhook会触发后续流程)

  // ===== Phase 2: 硬件设计 =====
  console.log('\n⚙️ Phase 2: 硬件设计（并行进行）');

  // 飞书通知硬件团队
  await MessageDispatcher.notifyTeam('hardware', {
    title: '🎯 原理图设计任务启动',
    message: '基于BK7252N进行原理图设计，需要在2周内完成初稿',
    mentions: ['hw-lead@company.com'],
    severity: 'INFO',
  });

  // 钉钉创建原理图设计任务
  await MessageDispatcher.assignTask('hw-engineer@company.com', {
    title: 'BK7252N原理图设计',
    description: '设计BK7252N热敏打印机原理图，包括电源、MCU外设、LCD接口',
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    priority: 'HIGH',
  });

  // ===== Phase 3: 原理图评审 =====
  console.log('\n🔍 Phase 3: 原理图设计评审');

  await HardwareAgent.onSchematicReviewComplete(
    {
      revision: 'v1.0',
      comments: '原理图设计完成，等待评审',
    },
    'APPROVED' // 假设评审通过
  );

  // ===== Phase 4: 软件开发 =====
  console.log('\n💻 Phase 4: 软件开发（并行进行）');

  await MessageDispatcher.notifyTeam('software', {
    title: '🎯 固件开发任务启动',
    message: '基于BK7252N芯片进行驱动和应用开发',
    mentions: ['sw-lead@company.com'],
    severity: 'INFO',
  });

  // ===== Phase 5: PCB Layout完成 =====
  console.log('\n📐 Phase 5: PCB设计完成');

  await HardwareAgent.onPCBLayoutComplete({
    revision: 'v1.0',
    description: 'PCB 4层板，集成RF匹配、电源管理、信号完整性设计',
    gerberUrl: 'https://github.com/koifarm/bk7252n-pcb/releases/v1.0',
  });

  // ===== Phase 6: 集成测试 =====
  console.log('\n🧪 Phase 6: 硬件+软件集成测试');

  const testResults = {
    totalTests: 120,
    passed: 115,
    failed: 5,
    criticalDefects: 1,
    performanceMetrics: {
      printSpeed: '100mm/s',
      accuracy: '99.2%',
    },
  };

  // TestAgent发布测试报告
  await TestAgent.publishTestReport(testResults);

  if (testResults.failed === 0) {
    // ===== Phase 7: 发布审批 =====
    console.log('\n✅ Phase 7: 发布审批');

    const releaseApproval = await MessageDispatcher.startApprovalFlow('RELEASE', {
      title: 'BK7252N v1.0 发布申请',
      description: 'PCB样机通过所有测试，可进行小批量生产',
      initiator: 'pm@company.com',
    });

    console.log('📧 发布审批已提交，等待CEO签字...');
    console.log('🔗 审批链接:', releaseApproval.approvalUrl);
  } else {
    console.log('⚠️ 存在未解决的缺陷，需要进行第二轮测试');
  }
}

// 运行流程
executeFullWorkflow().catch(console.error);
```

---

## 十、安全性检查清单

### ⚠️ 必须做

- [ ] clientSecret和gatewayToken**永不**硬编码，只从.env读取
- [ ] .env文件添加到.gitignore，不要提交到Git
- [ ] 生产环境使用密钥管理系统（如HashiCorp Vault）
- [ ] 定期轮换clientSecret（每90天）
- [ ] 启用钉钉Gateway的SSL/TLS（生产环境）
- [ ] 记录所有Bot的操作日志（审计追踪）
- [ ] 限制Bot在钉钉中的权限（只能访问必要的群组）

### 不要做

```javascript
// ❌ 错误
const config = JSON.parse(fs.readFileSync('config.json'));
const client = new DingtalkClient(
  'dingndmbsghqvpkrwm1d',
  'n9I2HGTnMeQkVXLLYTlPOoXasoQWguMyyz_5RlnJCdfbolzHtGrJxgzcI2HXNX_U' // 这是secret！
);

// ✅ 正确
require('dotenv').config();
const client = new DingtalkClient(
  process.env.DINGTALK_DEV_CLIENTID,
  process.env.DINGTALK_DEV_SECRET
);
```

---

## 十一、本地测试快速启动

```bash
# Step 1: 安装依赖
npm install

# Step 2: 配置.env（填入你的appSecret）
cp .env.example .env
nano .env

# Step 3: 测试飞书连接
node test-feishu-connection.js

# Step 4: 测试钉钉连接（确保Gateway运行在18789）
node test-dingtalk-connection.js

# Step 5: 运行集成示例
node integration-example.js

# Step 6: 启动webhook服务（另开终端）
node webhook-dingtalk-handler.js
```

---

## 十二、关键文件结构

```
hardware-sw-agent-system/
├── feishu-client.js              # 飞书API客户端
├── dingtalk-client.js            # 钉钉API客户端
├── message-dispatcher.js          # 双通道消息分发
├── agents/
│   ├── feishu-bot-registry.js    # 飞书Bot管理
│   ├── dingtalk-bot-registry.js  # 钉钉Bot管理
│   ├── agent-bot-mapping.js      # Agent-Bot映射配置
│   ├── project-manager-agent.js  # 项目管理
│   ├── hardware-agent-v2.js      # 硬件研发
│   ├── software-agent.js         # 软件研发
│   ├── test-agent.js             # 测试集成
│   └── release-agent.js          # 发布管理
├── webhook-dingtalk-handler.js   # 钉钉webhook处理
├── workflow-engine.js             # 编排引擎
├── integration-example.js         # 完整示例
├── .env                          # 密钥配置
├── .env.example                  # 配置模板
├── .gitignore                    # Git忽略
└── package.json
```

---

## 十三、后续优化方向

1. **智能优先级调度**：如果硬件和软件都完成，自动启动集成测试，无需人工干预
2. **缺陷自动分类**：测试Agent自动识别是硬件问题还是软件问题，自动分配给相应Agent
3. **性能基线对比**：每次测试自动与上个版本对比，如果性能下降超过5%，自动告警
4. **自动回滚决策**：如果发布后出现高优缺陷，自动评估回滚成本和继续修复的成本，给出建议
5. **多项目并行管理**：支持同时运行多个产品（BK7252N、KoiNote等）的研发流程

---

这套架构现在**完全支持你的实际环保设置**。建议下周开始实施：

1. **第一步**：验证飞书和钉钉的连接（30分钟）
2. **第二步**：实现ProjectManagerAgent（2小时）
3. **第三步**：集成Jira和GitHub（这周）
4. **第四步**：部署webhook和审批流程（下周）

需要我先给你哪个部分的详细代码？
