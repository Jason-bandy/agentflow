# AgentFlow 系统架构文档

## 1. 整体架构

AgentFlow 是双通道架构：OpenClaw 负责 LLM 对话，MCP Server 负责进度通知流转。

```
                        钉钉协同群（单群模式）
                    @SOP Agent / @Legacy Agent
                              │
                    ┌─────────┴──────────┐
                    │                    │
              Stream WebSocket      Stream WebSocket
                    │                    │
         ┌──────────▼──────┐  ┌─────────▼────────┐
         │   OpenClaw      │  │  AgentFlow MCP   │
         │   Gateway       │  │  Server          │
         │  (127.0.0.1)   │  │  (stdio MCP)     │
         └────────┬────────┘  └────────┬────────┘
                  │                    │
     ┌────────────┼────────────┐       │
     ▼            ▼            ▼       ▼
  main        product      aftersale  关键词检测
  (LLM对话)   manager(LLM)  (LLM对话)  下游推送
                                       进度播报
```

### 1.1 双通道职责分离

| 通道 | 运行时 | 用途 | 消息来源 |
|------|--------|------|----------|
| **OpenClaw** | Gateway + dingtalk-connector | LLM 对话（@机器人 or 私聊） | Stream WebSocket |
| **MCP Server** | Claude Code MCP 工具 | 完成通知流转、风险播报、下游推送 | Claude Code 调用 / Stream 监听 |

- OpenClaw 处理所有 **用户对话**（提问、指令、文件分析）
- MCP Server 处理所有 **系统通知**（任务完成、进度变化、风险告警）
- 两者互不干扰，各司其职

---

## 2. 接入 Agent 总览

### 2.1 Legacy Agent（已有 OpenClaw 接入）

| Agent ID | 角色 | 模型 | 渠道 | OpenClaw | MCP |
|----------|------|------|------|----------|-----|
| main | 主开发助手 | claude-sonnet-4-6 | 钉钉+飞书 | ✅ | ✅ |
| aftersale | 售后技术支持 | gemini-3.1-pro-preview | 钉钉 | ✅ | ✅ |
| sales | 销售 | gemini-3.1-pro-preview | 钉钉+飞书 | ✅ | ✅ |
| hr | 人力资源 | gemini-3.1-pro-preview | 钉钉 | ✅ | ✅ |
| productmanager | 产品经理 | qwen3-coder-plus | 钉钉+飞书 | ✅ | ✅ |
| dataanalyst | 数据分析 | qwen3.5-plus | 飞书 | ✅ | ✅ |
| tester | 测试 | claude-sonnet-4-6 | 飞书 | ✅ | ✅ |

### 2.2 SOP Agent（新增 14 个）

| Agent ID | 角色 | 阶段 | 上游 | 下游 |
|----------|------|------|------|------|
| pm-agent | 项目经理 | P1 | — | id-agent |
| id-agent | 工业设计师 | P1 | pm-agent | me-manager-agent |
| me-manager-agent | 结构工程经理 | P1 | id-agent | me-lead-agent |
| me-lead-agent | 结构工程主管 | P1 | me-manager-agent | architect-agent |
| architect-agent | 系统架构师 | P2 | me-lead-agent | hw-lead, hw-board, fw, app, backend |
| hw-lead-agent | 硬件工程师 | P2 | architect | fw-lead, procurement |
| hw-board-app-agent | PCB 应用工程师 | P2 | hw-lead | — |
| fw-lead-agent | 固件工程师 | P3 | hw-lead, architect | verification, qa |
| app-lead-agent | App 开发 | P3 | architect | verification, qa |
| backend-agent | 后端工程师 | P3 | architect | verification, qa |
| procurement-agent | 采购 | P3 | hw-lead, architect | qa |
| verification-agent | 验证工程师 | P4 | fw, app, backend, hw, architect | production |
| qa-agent | 质量验收 | P4 | fw, app, backend, hw, procurement | production |
| production-manager-agent | 生产经理 | P5 | verification, qa | — |

---

## 3. SOP 工作流（5 阶段 DAG）

```
Phase 1 (ID & ME, Day 1-15)        串行链
──────────────────────────────────────────────
  PM → ID → ME_MANAGER → ME_LEAD

Phase 2 (HW & PCB, Day 15-20)      串行链
──────────────────────────────────────────────
  ARCHITECT → HW_LEAD → HW_BOARD_APP

Phase 3 (Parallel Dev, Day 20-45)  并行
──────────────────────────────────────────────
  FW_LEAD ─────────────────────────────┐
  APP_LEAD ────────────────────────────┤→ Phase 4
  BACKEND ─────────────────────────────┤
  PROCUREMENT ─────────────────────────┤

Phase 4 (Verification, Day 45-60)    并行
──────────────────────────────────────────────
  VERIFICATION ────────┐
  QA ──────────────────┤→ Phase 5

Phase 5 (Production, Day 60-90)    串行
──────────────────────────────────────────────
  PRODUCTION_MANAGER
```

### 3.1 依赖详情

```
pm-agent              ──无依赖─────────────→ id-agent
id-agent              ──DONE:pm-agent──────→ me-manager-agent
me-manager-agent      ──DONE:id-agent──────→ me-lead-agent
me-lead-agent         ──DONE:me-manager───→ architect-agent
architect-agent       ──DONE:me-lead───────→ hw-lead + hw-board + fw + app + backend
hw-lead-agent         ──DONE:architect─────→ fw-lead + procurement
hw-board-app-agent    ──DONE:hw-lead───────→ (无下游)
fw-lead-agent         ──DONE:hw+architect─→ verification + qa
app-lead-agent        ──DONE:architect─────→ verification + qa
backend-agent         ──DONE:architect─────→ verification + qa
procurement-agent     ──DONE:hw+architect─→ qa
verification-agent    ──DONE:all-dev───────→ production-manager
qa-agent              ──DONE:all-dev+proc─→ production-manager
production-manager    ──DONE:ver+qa───────→ (最终交付)
```

---

## 4. 通知架构

### 4.1 双群同步模式

所有通知同时推送到两个渠道：

```
MCP Server notify_agent()
    │
    ├── 第一层：群 Webhook（全员可见）
    │   ├── 钉钉 PM Webhook → 协同群
    │   └── 飞书 Webhook   → 飞书协同群
    │
    ├── 第二层：应用机器人（@指定人员）
    │   ├── 钉钉 App 通知 → 指定 userid
    │   └── 飞书 App 消息 → 指定 open_id
    │
    └── 自动 @mention
        └── 从 agent.owner 提取 dingtalk_userid / feishu_id
```

### 4.2 渠道配置

- **钉钉**：所有 Agent 使用同一个 PM 群 Webhook（单群模式）
- **飞书**：所有 Agent 使用同一个 Webhook URL
- **@mention**：从 `agents.json` 的 `owner.dingtalk_userid` / `owner.feishu_id` 自动提取

### 4.3 Webhook 映射

14 个 SOP Agent 的 `DINGTALK_WEBHOOK_*` 全部映射到 PM 群：

```
DINGTALK_WEBHOOK_ID              ─┐
DINGTALK_WEBHOOK_ME_MANAGER      │
DINGTALK_WEBHOOK_ME_LEAD         │
DINGTALK_WEBHOOK_ARCHITECT       │  → 同一个 PM 群 Webhook
DINGTALK_WEBHOOK_HW_LEAD         │
DINGTALK_WEBHOOK_HW_BOARD_APP    │
DINGTALK_WEBHOOK_FW_LEAD         │
DINGTALK_WEBHOOK_APP_LEAD        │
DINGTALK_WEBHOOK_BACKEND         │
DINGTALK_WEBHOOK_PROCUREMENT     │
DINGTALK_WEBHOOK_VERIFICATION    │
DINGTALK_WEBHOOK_QA              │
DINGTALK_WEBHOOK_PRODUCTION     ─┘
```

---

## 5. 消息流

### 5.1 完成关键词触发（已有）

```
用户/Agent 在群里发消息
    │
    ▼ (包含 "完成" / "DONE" / "✅" / "已完成")
MCP Server (Claude Code 调用 notify_agent)
    │
    ├── 识别 Agent ID
    ├── 推送钉钉群 @负责人
    ├── 推送飞书群 @负责人
    └── 自动通知下游 Agent
```

### 5.2 LLM 对话（OpenClaw 处理）

```
用户 @Agent 或私聊
    │
    ▼ Stream WebSocket
OpenClaw Gateway (127.0.0.1)
    │ bindings 路由
    ├── main        → /Users/a123/.openclaw/workspace
    ├── productmanager → /Users/a123/.openclaw/workspace-productmanager
    ├── aftersale   → /Users/a123/.openclaw/workspace-aftersale
    ├── sales       → /Users/a123/.openclaw/workspace-sales
    ├── hr          → /Users/a123/.openclaw/workspace-hr
    └── ... (SOP Agent 同理)
```

---

## 6. 技术组件

| 组件 | 文件 | 职责 |
|------|------|------|
| MCP Server | `mcp-servers/notify/server.js` | 通知推送、LLM 路由、A2A 广播 |
| MCP 启动 | `mcp-servers/notify/start.sh` | 加载 .env + 启动 node |
| HTTP Server | `scripts/agentflow-server.mjs` | Outgoing Webhook 接收（HTTP 模式备用） |
| SOP 配置 | `config/sop-flow.jsonl` | 14 步骤 DAG 定义 |
| Agent 路由 | `config/agents.json` | Agent 渠道、下游关系、@mention 信息 |
| 环境变量 | `.env` | 所有密钥（不提交 git） |
| 多 Agent 启动 | `scripts/launch-agents.sh` | tmux 5 阶段编排 |
| Ralph | `scripts/ralph/` | 每 Agent 独立 prd.json + progress.txt |
| 定时调度 | `schedules/` | launchd + crontab |

---

## 7. LLM 路由

```
callOpenClaw(agent.config.model)
    │
    ├── 非 gemini + ANTHROPIC_BASE_URL 已设
    │   → DashScope Anthropic 兼容接口（主后端）
    │   → ANTHROPIC_AUTH_TOKEN 鉴权
    │
    ├── gemini-* 模型
    │   → OpenClaw 网关（OPENCLAW_BASE_URL）
    │
    └── 其他兜底
        → OpenClaw 网关
```

### 7.1 模型分配

| Agent | 模型 | 路由 |
|-------|------|------|
| main | claude-sonnet-4-6 | DashScope |
| aftersale | gemini-3.1-pro-preview | OpenClaw |
| sales | gemini-3.1-pro-preview | OpenClaw |
| hr | gemini-3.1-pro-preview | OpenClaw |
| productmanager | qwen3-coder-plus | DashScope |
| dataanalyst | qwen3.5-plus | DashScope |
| tester | claude-sonnet-4-6 | DashScope |
| SOP Agents | 各自配置 | 自动路由 |

---

## 8. 输出文件

所有 Agent 输出写入 `/tmp/agentflow/`：

| 文件 | 来源 |
|------|------|
| `task_queue.json` | PM 任务拆解 |
| `id_output.json` | 工业设计（外观/CMF/色彩） |
| `me_manager_output.json` | 结构设计（主体/堆叠/工程） |
| `me_lead_output.json` | 3D 结构图/装配/模具 |
| `architect_output.json` | 系统架构/接口/协议 |
| `hw_output.json` | BOM/固件版本/PCB 需求 |
| `hw_board_output.json` | PCB 布局/信号完整性/EMC |
| `fw_output.json` | 固件架构/驱动/协议栈/OTA |
| `app_output.json` | App 设计/UI/设备连接 |
| `backend_output.json` | 后端 API/数据库/部署 |
| `procurement_output.json` | 供应商评估/成本/交期 |
| `verification_output.json` | 系统验证结果 |
| `verification_issues.json` | 验证失败项 |
| `qa_report.json` | 交叉验证报告 |
| `production_output.json` | 生产计划/产能/质量标准 |
| `risk_register.json` | 高风险项（交期 >14 天） |
| `events.jsonl` | 事件日志 |

---

## 9. 扩展路线图

```
Phase 1（已完成）：单群模式 + 通知流转
  所有 Agent 同群，Webhook 通知，@mention 自动提取

Phase 2（当前）：Stream 模式双向对话
  SOP Agent 加入 OpenClaw dingtalk-connector
  支持 @SOP Agent 群内对话 + LLM 回复
  群内 @+附件 自动读取并分析

Phase 3：金蝶 ERP 对接
  采购 Agent 读写金蝶 BOM/库存数据
  MCP Server 扩展 kingdee-erp 工具

Phase 4：Excel 监控
  上传 Excel → 提取时间节点
  定时检查里程碑，临期自动催办
```
