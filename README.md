# AgentFlow

> 跨部门 AI 智能体编排平台 — 硬件/软件/采购/生产全流程协同

## 项目结构

```
agentflow/
├── config/
│   └── sop-flow.jsonl          # Agent SOP 流程定义（JSONL）
├── agents/                     # 自定义 Agent 提示词（可扩展）
├── mcp-servers/
│   └── notify/
│       ├── server.js           # 钉钉+飞书推送 MCP Server
│       └── package.json
├── schedules/
│   ├── crontab.conf            # 系统 crontab 配置
│   └── launchd-daily.plist     # macOS launchd 配置（推荐）
├── scripts/
│   ├── launch-agents.sh        # dmux 多 Agent 并发启动脚本
│   └── push-risk-summary.sh    # 风险摘要推送脚本
├── hooks/                      # Claude Code hooks（预留）
├── docs/
├── .env.example                # 环境变量模板
└── README.md
```

## 快速开始

### 1. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入钉钉/飞书的 Webhook URL 和 AppId/Secret
```

### 2. 安装推送 MCP Server

```bash
cd mcp-servers/notify
npm install
```

在 `~/.claude/settings.json` 中注册 MCP Server：

```json
{
  "mcpServers": {
    "agentflow-notify": {
      "command": "node",
      "args": ["/Users/a123/agent/agentflow/mcp-servers/notify/server.js"],
      "env": {
        "DINGTALK_WEBHOOK_URL": "${DINGTALK_WEBHOOK_URL}",
        "DINGTALK_SECRET": "${DINGTALK_SECRET}",
        "DINGTALK_APP_KEY": "${DINGTALK_APP_KEY}",
        "DINGTALK_APP_SECRET": "${DINGTALK_APP_SECRET}",
        "DINGTALK_AGENT_ID": "${DINGTALK_AGENT_ID}",
        "FEISHU_WEBHOOK_URL": "${FEISHU_WEBHOOK_URL}",
        "FEISHU_APP_ID": "${FEISHU_APP_ID}",
        "FEISHU_APP_SECRET": "${FEISHU_APP_SECRET}"
      }
    }
  }
}
```

### 3. 启动 AgentFlow

```bash
# 输入你的项目目标，脚本自动在 tmux 中启动所有 Agent
./scripts/launch-agents.sh "开发一款 IoT 温控设备，目标 Q2 量产"
```

查看进度：

```bash
tmux attach -t agentflow
# 用 Ctrl+B + 数字键切换不同 Agent 窗口
```

### 4. 配置每日 9 点推送

**方式 A：macOS launchd（推荐，持久化）**

```bash
# 复制并加载（需先在 .plist 中调整路径）
cp schedules/launchd-daily.plist ~/Library/LaunchAgents/com.agentflow.daily.plist
launchctl load ~/Library/LaunchAgents/com.agentflow.daily.plist

# 手动测试推送
./scripts/push-risk-summary.sh
```

**方式 B：系统 crontab**

```bash
crontab -e
# 粘贴 schedules/crontab.conf 中的内容
```

**方式 C：Claude Code 会话内（临时）**

在 Claude Code 中说：
> "每天早上 9:03 帮我执行风险摘要推送"

## Agent SOP 流程

```
项目目标输入
    │
    ▼
[PM-Agent] 任务拆解 + 优先级排序
    │
    ├──────────────────────────────────┐
    ▼                                  ▼
[HW-Agent] BOM + 接口约定      [SW-Agent] 等待接口 → API + 代码骨架
    │                                  │
    ▼                                  │
[采购Agent] 供应商评估 + 风险   [Prod-Agent] PRD + 验收标准
    │                                  │
    └──────────────┬───────────────────┘
                   ▼
              [QA-Agent] 交叉验收 → 综合报告
                   │
                   ▼
          推送风险摘要到钉钉/飞书
```

## 推送能力

| 场景 | 方式 | 触发 |
|------|------|------|
| 日报风险摘要 | Webhook（钉钉+飞书群） | 每日 9:03 cron |
| 催办私信 | 应用机器人（指定人员） | 里程碑延期时 Agent 触发 |
| 紧急阻断通知 | Webhook + 应用机器人 | QA 发现高风险时 |

## 后续可对接

- **金蝶 ERP**：在采购 Agent 中调用金蝶 API 获取实时库存/价格
- **Excel 监控**：将 Excel 表格上传后，Agent 提取时间节点自动监控
- **MCP 扩展**：为每个外部系统创建独立 MCP Server 并注册到 Claude
# agentflow
