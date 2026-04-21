# AgentFlow 系统架构文档

## 1. 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        AgentFlow 系统                            │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │  调度层       │    │  通知层       │    │  存储层           │   │
│  │  CronCreate  │    │  MCP Server  │    │  /tmp/agentflow/ │   │
│  │  launchd     │    │  port: 3456  │    │  events.jsonl    │   │
│  │  crontab     │    │  HTTP Server │    │  risk_register   │   │
│  └──────┬───────┘    └──────┬───────┘    └──────────────────┘   │
│         │                  │                                     │
└─────────┼──────────────────┼─────────────────────────────────────┘
          │                  │
          ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    钉钉 / 飞书 消息平台                            │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  协同群（单群模式）                                         │    │
│  │                                                          │    │
│  │  @Main Dev Bot  @ProductManager Bot  @售后Bot            │    │
│  │  @Sales Bot     @HR Bot                                  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                    Outgoing Webhook                              │
│                              │                                   │
└──────────────────────────────┼──────────────────────────────────┘
                               │ POST
                               ▼
                  http://IP:3456/webhook/dingtalk
                               │
                    AgentFlow HTTP Server
                               │
                    ┌──────────┴──────────┐
                    │  关键词检测           │
                    │  完成/DONE/✅        │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
        推送调度群          推送下游群         回复原群会话
      (PM Webhook)      (各部门 Webhook)   (sessionWebhook)
```

---

## 2. Use Case 流程图

### UC-01：部门任务完成 → 自动流转通知

```
用户（部门成员）
    │
    │ 1. 在协同群发消息
    │    "@Main Dev Bot 研发任务完成，接口文档已上传"
    ▼
钉钉群
    │
    │ 2. 机器人回复（openclaw Main Dev Bot 响应）
    │    "✅ 任务完成，已记录到项目进度"
    │
    │ 3. Outgoing Webhook 把消息 POST 给 AgentFlow
    ▼
AgentFlow HTTP Server (3456)
    │
    │ 4. 解析消息
    │    - 识别 bot_name = "Main Dev Bot"
    │    - 检测关键词 "完成" ✅
    │
    ├──────────────────────────────────────┐
    │                                      │
    ▼                                      ▼
推送调度群 (PM Webhook)              推送下游 Agent 群
"✅ Main Dev Bot 完成了研发任务       "@Tester Bot 请开始测试"
 触发人：张三                         "@ProductManager Bot 研发已完成"
 已通知下游：Tester、PM"
    │                                      │
    ▼                                      ▼
调度群所有管理者看到通知           下游 Agent 群收到任务流转消息
                                   openclaw Agent 自动执行下游任务
```

### UC-02：每日 9:03 风险摘要自动播报

```
macOS launchd / crontab
    │
    │ 每天 09:03 触发
    ▼
scripts/push-risk-summary.sh
    │
    │ 1. 读取 /tmp/agentflow/risk_register.json
    │ 2. 读取各 Agent 状态文件
    │ 3. 构建风险摘要 Markdown
    ▼
推送渠道
    ├── 钉钉 PM Webhook → 调度群日报
    └── 飞书 Webhook   → 飞书协同群日报
```

### UC-03：多 Agent 并发 SOP 执行

```
触发：./scripts/launch-agents.sh "项目目标"
    │
    ▼
tmux session "agentflow"
    │
    ├── 窗口 1: pm-agent
    │       claude 生成任务队列 → /tmp/agentflow/task_queue.json
    │       输出 DONE:PM
    │
    ├── 窗口 2: hw-agent          (并行，等待 DONE:PM)
    │       生成 BOM + 接口约定 → hw_output.json
    │       输出 DONE:HW
    │
    ├── 窗口 3: sw-agent          (并行，等待 DONE:PM + DONE:HW)
    │       生成 API + 代码骨架 → sw_output.md
    │       输出 DONE:SW
    │
    ├── 窗口 4: prod-agent        (并行，等待 DONE:PM)
    │       生成 PRD → prd_output.md
    │       输出 DONE:PROD
    │
    ├── 窗口 5: procurement-agent (等待 DONE:HW)
    │       供应商评估 → procurement_output.json
    │       风险项 → risk_register.json
    │       输出 DONE:PROCUREMENT
    │
    └── 窗口 6: qa-agent          (等待所有 DONE)
            交叉验收 → qa_report.json
            触发推送 → push-risk-summary.sh
```

### UC-04：用户手动触发（兜底方案）

```
当 Outgoing Webhook 未配置，或需要手动测试时：

curl -X POST http://localhost:3456/trigger \
  -H "Content-Type: application/json" \
  -d '{"agentId": "main", "sender": "张三", "message": "研发任务完成"}'
    │
    ▼
AgentFlow 直接触发下游推送流程（与 UC-01 步骤 4 相同）
```

---

## 3. A2A（Agent-to-Agent）通知路由图

```
                    ┌─────────────────┐
                    │   dataanalyst   │
                    │  (飞书·数据分析) │
                    └────────┬────────┘
                             │ 完成数据分析
                             ▼
         ┌───────────────────┴──────────────────┐
         │                                      │
         ▼                                      ▼
┌─────────────────┐                  ┌──────────────────┐
│  productmanager │                  │  sales (飞书)    │
│  (钉钉·产品)    │                  │                  │
└────────┬────────┘                  └──────────────────┘
         │ 需求确认
         ├─────────────────┬──────────────────┐
         ▼                 ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
│     main     │  │    sales     │  │     tester       │
│ (钉钉·研发)  │  │ (钉钉·销售)  │  │   (飞书·测试)   │
└──────┬───────┘  └──────┬───────┘  └──────────────────┘
       │                 │
       │ 研发完成         │ 销售反馈
       ▼                 ▼
┌──────────────┐  ┌──────────────┐
│    tester    │  │  aftersale   │
│ (测试验收)   │  │ (售后支持)   │
└──────┬───────┘  └──────┬───────┘
       │                 │
       └────────┬────────┘
                ▼
        ┌──────────────┐
        │  调度群       │
        │ (PM 汇总播报) │
        └──────────────┘

→ 箭头方向 = 任务完成后通知方向
```

---

## 4. 技术组件一览

| 组件 | 文件 | 职责 |
|------|------|------|
| HTTP Server | `scripts/agentflow-server.mjs` | 接收钉钉/飞书 Outgoing Webhook |
| MCP Server | `mcp-servers/notify/server.js` | 供 Claude Code 调用推送工具 |
| SOP 配置 | `config/sop-flow.jsonl` | Agent 串联步骤定义 |
| Agent 路由 | `config/agents.json` | 各 Agent 渠道、下游、关键词 |
| 日报推送 | `scripts/push-risk-summary.sh` | 每日定时播报 |
| 多 Agent 启动 | `scripts/launch-agents.sh` | tmux 并发编排 |
| 定时调度 | `schedules/launchd-daily.plist` | macOS 每日 9:03 触发 |
| 密钥管理 | `.env` | 所有 API 密钥（不提交 git）|

---

## 5. 钉钉 Outgoing Webhook 配置步骤

```
1. 打开钉钉开放平台 https://open.dingtalk.com
   → 应用开发 → 选择你的机器人应用

2. 消息接收配置
   → 消息接收模式：选"HTTP模式"
   → 消息接收地址：http://你的内网IP:3456/webhook/dingtalk

3. 网络要求
   → 钉钉服务器需要能访问到你的 IP:3456
   → 局域网：确保机器人服务器和 AgentFlow 在同一网络
   → 公网：用 ngrok / Tailscale / 内网穿透暴露端口

4. 启动 AgentFlow Server
   cd /Users/a123/agent/agentflow
   npm run server

5. 验证
   curl http://localhost:3456/health
   → {"status":"ok",...}
```

---

## 6. 扩展路线图

```
Phase 1（当前）：单群模式
  所有 Agent 在同一个群，用 @机器人名 区分

Phase 2：多群模式
  每个部门独立群，各群安装对应机器人
  在 agents.json 的 group_webhook 填对应群地址

Phase 3：金蝶 ERP 对接
  采购 Agent 直接读写金蝶 BOM/库存数据
  通过 MCP Server 扩展 kingdee-erp 工具

Phase 4：Excel 监控
  上传 Excel → AgentFlow 提取时间节点
  定时检查里程碑，临期自动催办相关 Agent
```
