# Agent 人员映射表

> 最后更新：2026-04-21

## SOP 14 Agent — 钉钉 @mention 映射

每个 SOP Agent 对应一个真人负责人，用于在钉钉群中 @mention 通知。

| Agent ID | 角色名称 | 钉钉 userid |
|----------|---------|-------------|
| pm-agent | 项目经理 | `0563050239941573` |
| id-agent | 工业设计师 | `082344465026385880` |
| me-manager-agent | 结构工程经理 | `013267560335298652` |
| me-lead-agent | 结构工程主管 | — |
| architect-agent | 系统架构师 | `01202140220785295` |
| hw-lead-agent | 硬件工程师 | `296243493337448471` |
| hw-board-app-agent | PCB 应用工程师 | `296243493337448471` |
| fw-lead-agent | 固件工程师 | `296243493337448471` |
| app-lead-agent | App 开发工程师 | `076401572239907674` |
| backend-agent | 后端工程师 | `01335416404937770293` |
| procurement-agent | 采购专员 | `050761426033492929` |
| verification-agent | 验证工程师 | `034417110427811155` |
| qa-agent | 质量验收专员 | `02255443646630342188` |
| production-manager-agent | 生产经理 | `01375327230326290495` |

## Legacy Agent — 钉钉应用 ClientId

| Agent ID | 角色名称 | clientId |
|----------|---------|----------|
| main | 首席开发工程师 | `dingndmbsghqvpkrwm1d` |
| aftersale | 龙虾客服售后助理 | `dingopxjerykkiycoytz` |
| sales | 首席市场官 | `dingkte9zrzbodqruy1o` |
| hr | 龙虾人事助理 | `ding53lutkwkwz3ay2y3` |
| productmanager | 首席产品经理 | `dingwtnjpe3vkgltia6e` |

## 通知架构

```
notifyAgent(agentId)
├── 第一层：群 Webhook（双群同步）
│   ├── 钉钉群 (DINGTALK_WEBHOOK_PM) → @mention dingtalk_userid
│   └── 飞书群 (FEISHU_WEBHOOK_URL)  → @mention feishu_id (如有)
└── 第二层：应用机器人（如有配置 + 指定人员）
    └── 钉钉应用 / 飞书应用

notifyDownstream(sourceAgentId)
└── 遍历 agent.notifies[]，对每个下游调用 notifyAgent()
    ├── 自动提取下游 agent.owner.dingtalk_userid → @mention
    ├── 自动提取下游 agent.owner.feishu_id → @mention
    └── 在消息末尾追加 > 📌 负责人：{name}
```
