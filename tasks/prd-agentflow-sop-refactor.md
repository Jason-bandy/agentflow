# PRD: AgentFlow SOP 重构 — 3 个月并行研发流程对齐

## 1. Introduction/Overview

当前 AgentFlow 实现的是一个简化的 6-Agent 单管道工作流，与公司研发的 3 个月并行研发 SOP 蓝图（见 `docs/flow_design.png`）存在较大差距。

本 PRD 旨在将 AgentFlow 重构为与设计图一致的完整 SOP 流程，核心改造点：

1. **从线性管道 → 分阶段并行流程**：按 Day 1/15/20/45/60/90 分 5 个阶段
2. **补齐缺失角色**：ID & ME 设计、系统架构师、FW Lead、App Lead、Production Manager、Verification Agent
3. **调整产出定义**：HW 产出 BOM + 固件版本；SW 拆分为 App 版本 + 后端版本；架构师产出架构方案 + 接口约定
4. **引入 Ralph 自主循环**：每个 Agent 内部用 Ralph 做迭代开发，外部由 AgentFlow DAG 编排
5. **建立验证反馈闭环**：QA/Verification 不通过 → 问题写回 prd.json → 触发新一轮 Ralph 循环

采用**混合模式**：AgentFlow 的 DAG 负责跨 Agent 编排和依赖管理，Ralph 负责单个 Agent 内部的用户故事迭代执行。

## 2. Goals

- 补齐设计图中的所有 Agent 角色（12+ 个），覆盖 ID/ME 设计到量产准备的完整周期
- SW 产出从「代码骨架」拆分为「App 版本 + 后端版本」
- HW 产出从「BOM + 接口」扩展为「BOM + 固件版本 + PCB」
- 新增架构师 Agent 产出「架构方案 + 接口约定」
- 引入 Ralph prd.json 驱动各 Agent 内部迭代
- 建立 QA → Ralph 反馈闭环，实现验证不通过时自动重做
- 保留现有通知系统架构（DingTalk/Feishu），预留通知渠道配置

## 3. User Stories

### US-001: 重构 sop-flow.jsonl — 新增阶段和 Agent
**Description:** 作为系统维护者，我需要重构 sop-flow.jsonl 使其与设计图一致，包含 5 个阶段和完整 Agent 列表。

**Acceptance Criteria:**
- [ ] 定义 5 个阶段：Phase 1 (Day 1-15 ID&ME) / Phase 2 (Day 15-20 HW&PCB) / Phase 3 (Day 20-45 并行开发) / Phase 4 (Day 45-60 验证) / Phase 5 (Day 60-90 量产)
- [ ] 新增 Agent：id-agent, me-manager-agent, me-lead-agent, architect-agent, hw-lead-agent, hw-board-app-agent, fw-lead-agent, app-lead-agent, verification-agent, production-manager-agent
- [ ] 保留现有 Agent：pm-agent, prod-agent, procurement-agent, qa-agent（调整职责）
- [ ] 每个 Agent 定义 trigger、depends_on、output_file、loop_mode
- [ ] 阶段间用 DONE 标记串联，阶段内 Agent 可并行
- [ ] 文件输出到 `config/sop-flow.jsonl`
- [ ] JSONL 格式验证通过（每行一个合法 JSON 对象）

### US-002: 调整 HW-Agent 产出 — BOM + 固件版本
**Description:** 作为硬件工程师，我需要 HW-Agent 产出 BOM + 固件版本（而非只有 BOM 初稿 + 接口约定）。

**Acceptance Criteria:**
- [ ] prompt_template 增加固件版本要求
- [ ] 产出文件包含 BOM 清单（料号/规格/供应商）
- [ ] 产出文件包含固件版本号
- [ ] 产出文件包含接口约定（I2C/SPI/UART 协议参数）
- [ ] 产出文件包含 PCB 需求描述
- [ ] 输出写入 `/tmp/agentflow/hw_output.json`

### US-003: 拆分 SW-Agent 为 App Lead + FW Lead + Backend
**Description:** 作为软件团队，需要将原 SW-Agent 拆分为三个方向：App 版本（App Lead Agent）、固件（FW Lead Agent）、后端版本。

**Acceptance Criteria:**
- [ ] 新增 app-lead-agent，产出 App 版本（含 UI 组件、状态管理、API 调用层）
- [ ] 新增 fw-lead-agent，产出固件代码（嵌入式端）
- [ ] 保留/调整 sw-agent 或新增 backend-agent，产出后端版本（API 服务、数据库）
- [ ] 各 Agent 有独立 prompt_template、output_file、trigger
- [ ] App Lead 和 FW Lead 依赖 architect-agent 的接口约定
- [ ] 各 Agent 输出独立文件（`app_output.json`, `fw_output.json`, `backend_output.json`）

### US-004: 新增架构师 Agent — 架构方案 + 接口约定
**Description:** 作为系统架构师，需要一个独立 Agent 产出系统架构方案和软硬件接口约定。

**Acceptance Criteria:**
- [ ] 新增 architect-agent 定义
- [ ] trigger: DONE:PM（在 PM 任务拆解后立即启动）
- [ ] 产出：系统功能架构文档（模块划分、数据流）
- [ ] 产出：软硬件接口约定（API 协议、数据格式、通信方式）
- [ ] 产出文件：`/tmp/agentflow/architect_output.json`
- [ ] 下游依赖：App Lead、FW Lead、Backend 在开始开发前需等待架构师输出

### US-005: 新增 ID & ME 设计阶段 Agent
**Description:** 作为工业设计团队，需要 ID & ME 设计阶段覆盖 Day 1-15。

**Acceptance Criteria:**
- [ ] 新增 id-agent（工业设计）：产外观方案、材料选择、色彩定义
- [ ] 新增 me-manager-agent（ME 管理）：产结构设计核心
- [ ] 新增 me-lead-agent（ME 主导）：产 3D 结构图、装配方案
- [ ] ID & ME 阶段在 Phase 1，完成后触发 Phase 2
- [ ] 输出文件：`/tmp/agentflow/id_output.json`, `/tmp/agentflow/me_output.json`
- [ ] 通知渠道：工业设计部门（占位符配置）

### US-006: 新增 Production Manager — 量产准备
**Description:** 作为生产管理，需要 Production Manager Agent 在 Day 60-90 负责量产准备。

**Acceptance Criteria:**
- [ ] 新增 production-manager-agent 定义
- [ ] 产出：生产计划排期 + 产能评估
- [ ] 产出：质量控制标准 + 检验流程
- [ ] 产出：试产计划 + 产线调试方案
- [ ] trigger: DONE:QA（质量验收通过后启动）
- [ ] 输出文件：`/tmp/agentflow/production_output.json`
- [ ] 通知渠道：生产管理部门（占位符配置）

### US-007: 新增 Verification Agent — 验证反馈闭环
**Description:** 作为质量保障，需要独立的 Verification Agent 做系统验证，验证不通过时触发 Ralph 重做循环。

**Acceptance Criteria:**
- [ ] 新增 verification-agent 定义
- [ ] trigger: DONE:SW,DONE:HW,DONE:ARCHITECT（各开发 Agent 完成后启动）
- [ ] 执行系统功能验证、接口对齐检查
- [ ] 验证通过 → 设置 DONE:VERIFICATION，触发 Phase 5
- [ ] 验证不通过 → 生成 `verification_issues.json`，标记问题 Agent 的 prd.json 条目为 `passes: false`
- [ ] 触发 Ralph 重做循环，直至验证通过

### US-008: Ralph 集成 — 每个 Agent 目录下独立 prd.json
**Description:** 作为 AgentFlow 系统，需要为每个 Agent 集成 Ralph 循环，每个 Agent 有独立的 prd.json。

**Acceptance Criteria:**
- [ ] 目录结构：`scripts/ralph/<agent-id>/prd.json`
- [ ] 每个 prd.json 包含 branchName、userStories 数组（含 id、title、passes 状态）
- [ ] launch-agents.sh 启动各 Agent 后，自动调用 `./scripts/ralph/ralph.sh --tool claude` 执行循环
- [ ] 每个 Agent 有独立的 progress.txt 记录迭代进度
- [ ] 现有 `scripts/ralph/ralph.sh` 和 `scripts/ralph/CLAUDE.md` 保持不变，复用

### US-009: 重构 agents.json — 新增 Agent 配置 + 通知占位符
**Description:** 作为运维人员，需要更新 agents.json 以包含所有新 Agent 的通知配置。

**Acceptance Criteria:**
- [ ] 为每个新 Agent 添加 agents.json 条目
- [ ] 每个条目包含：id、name、channel、group_webhook（占位符）、env、notifies、receives_from
- [ ] 通知 URL 使用 `${DINGTALK_WEBHOOK_<DEPT>}` 或 `${FEISHU_WEBHOOK_<DEPT>}` 占位符
- [ ] 保留现有 Agent 配置不变
- [ ] 添加通知规则：task_completed、risk_detected、daily_report

### US-010: 调整 Procurement Agent — 依赖架构师输出
**Description:** 作为采购团队，Procurement Agent 需同时依赖 HW BOM 和架构师接口约定。

**Acceptance Criteria:**
- [ ] trigger 改为 `DONE:HW,DONE:ARCHITECT`
- [ ] 读取 hw_output.json 获取 BOM
- [ ] 读取 architect_output.json 获取接口约定（评估技术选型对采购的影响）
- [ ] 产出不变：供应商评估、交期风险、替代料推荐
- [ ] 风险项写入 `/tmp/agentflow/risk_register.json`

### US-011: 调整 QA Agent — 增加架构对齐检查
**Description:** 作为质量验收，QA Agent 需要增加架构对齐检查维度。

**Acceptance Criteria:**
- [ ] 新增检查项：实现 vs 架构方案的对齐度
- [ ] 新增检查项：App/FW/Backend 三者接口一致性
- [ ] 原有检查项保留：HW 接口 vs SW 接口、BOM 完整性、PRD 覆盖率
- [ ] 输出文件：`/tmp/agentflow/qa_report.json`
- [ ] trigger: DONE:APP,DONE:FW,DONE:BACKEND,DONE:HW,DONE:PROCUREMENT

### US-012: 更新 launch-agents.sh — 支持新阶段和新 Agent
**Description:** 作为运维脚本，需要重构 launch-agents.sh 以支持 5 阶段流程和新 Agent。

**Acceptance Criteria:**
- [ ] 按阶段创建 tmux 窗口组
- [ ] Phase 1（ID&ME）串行启动：pm → id → me-manager → me-lead
- [ ] Phase 2（HW&PCB）并行启动：architect + hw-lead + hw-board-app
- [ ] Phase 3（并行开发）并行启动：app-lead + fw-lead + backend + procurement
- [ ] Phase 4（验证）启动：verification + qa
- [ ] Phase 5（量产）启动：production-manager
- [ ] 各阶段间用 DONE 标记等待
- [ ] 保留现有通知和推送逻辑

### US-013: 更新 CLAUDE.md 项目文档
**Description:** 作为项目文档维护者，需要更新 CLAUDE.md 以反映新架构。

**Acceptance Criteria:**
- [ ] 更新架构图，包含所有新 Agent
- [ ] 更新目录结构说明
- [ ] 更新命令说明（新增 Ralph 相关命令）
- [ ] 更新工作流执行说明（5 阶段流程）
- [ ] 更新输出文件列表

### US-014: 创建 .env.example 模板 — 新增通知渠道占位符
**Description:** 作为运维人员，需要更新 .env.example 为所有新 Agent 添加通知渠道占位符。

**Acceptance Criteria:**
- [ ] 新增 ID 设计部门通知渠道占位符
- [ ] 新增 ME 设计部门通知渠道占位符
- [ ] 新增架构部门通知渠道占位符
- [ ] 新增固件部门通知渠道占位符
- [ ] 新增 App 部门通知渠道占位符
- [ ] 新增生产管理部门通知渠道占位符
- [ ] 所有占位符以 `# TODO: 配置实际 URL` 注释标注

### US-015: 端到端测试 — 验证完整流程
**Description:** 作为质量保证，需要验证重构后的完整流程可以跑通。

**Acceptance Criteria:**
- [ ] launch-agents.sh 能成功启动所有 Agent 窗口
- [ ] 各阶段 DONE 标记正确传递
- [ ] 所有输出文件在 /tmp/agentflow/ 下正确生成
- [ ] 通知系统能正确路由消息
- [ ] Ralph 循环在单个 Agent 内能正确迭代
- [ ] 验证反馈闭环能正确触发重做
- [ ] 端到端运行时间记录（作为后续优化基准）

## 4. Functional Requirements

- FR-1: SOP 流程必须包含 5 个阶段，每个阶段有明确的输入和输出
- FR-2: 每个 Agent 必须有独立的 Ralph prd.json 和 progress.txt
- FR-3: HW 产出必须包含固件版本号
- FR-4: SW 产出必须拆分为 App 版本、FW 版本、后端版本
- FR-5: 架构师 Agent 必须在 HW/SW 开发前完成架构方案和接口约定
- FR-6: Verification Agent 验证不通过时必须能触发 Ralph 重做
- FR-7: 通知系统必须保留现有架构，新 Agent 使用占位符配置
- FR-8: 所有 Agent 产出必须写入 /tmp/agentflow/ 目录
- FR-9: launch-agents.sh 必须按阶段顺序启动，阶段内并行

## 5. Non-Goals

- 不实现实际的业务逻辑（Agent 产出的内容是 AI 生成的，不是真实产品代码）
- 不修改 MCP Notification Server 的核心逻辑
- 不修改 Ralph 的核心循环逻辑（ralph.sh / CLAUDE.md）
- 不实现实际的硬件/固件/App 开发工具链集成
- 不处理 Agent 间的数据格式转换（统一用 JSON）
- 不实现分布式部署（当前是单机 tmux 方案）

## 6. Design Considerations

### 目录结构

```
agentflow/
├── config/
│   ├── sop-flow.jsonl          # 重构：5 阶段 + 12+ Agent
│   └── agents.json             # 重构：新增 Agent 配置
├── mcp-servers/notify/
│   └── server.js               # 不变
├── scripts/
│   ├── launch-agents.sh        # 重构：5 阶段启动逻辑
│   ├── push-risk-summary.sh    # 不变
│   └── ralph/
│       ├── ralph.sh            # 不变（复用）
│       ├── CLAUDE.md           # 不变（复用）
│       ├── pm/
│       │   ├── prd.json        # PM Agent 的用户故事
│       │   └── progress.txt
│       ├── id/
│       │   ├── prd.json
│       │   └── progress.txt
│       ├── architect/
│       │   ├── prd.json
│       │   └── progress.txt
│       ├── hw/
│       │   ├── prd.json
│       │   └── progress.txt
│       ├── app/
│       │   ├── prd.json
│       │   └── progress.txt
│       └── ...                 # 每个 Agent 独立目录
├── schedules/                  # 不变
└── .env / .env.example         # 重构：新增占位符
```

### 阶段执行时序

```
Phase 1 (Day 1-15):  PM → ID → ME-Manager → ME-Lead
Phase 2 (Day 15-20): Architect + HW-Lead + HW-Board-App  [并行]
Phase 3 (Day 20-45): App-Lead + FW-Lead + Backend + Procurement  [并行，依赖 Architect + HW]
Phase 4 (Day 45-60): Verification + QA  [串行]
Phase 5 (Day 60-90): Production-Manager
```

## 7. Technical Considerations

- Ralph 的 `--dangerously-skip-permissions` 标志在自主循环中必需，需在 launch-agents.sh 中配置
- 各 Agent 的 prd.json 用户故事需足够小（每个故事一个迭代能完成）
- DONE 标记的轮询间隔保持 3-5 秒，避免频繁文件 I/O
- 通知 URL 占位符格式统一：`${DINGTALK_WEBHOOK_<DEPT>}` 和 `${FEISHU_WEBHOOK_<DEPT>}`
- 现有 agents.json 中的 agent（main, aftersale, sales, hr, productmanager, dataanalyst, tester）保留不变，新增 Agent 追加到数组末尾

## 8. Success Metrics

- 所有设计图中的 Agent 角色在代码中都有对应定义
- launch-agents.sh 能成功启动所有 Agent 窗口且无报错
- 各阶段 DONE 标记正确传递，无死锁
- Ralph 循环在单个 Agent 内能完成至少一个用户故事
- 验证反馈闭环能正确触发重做

## 9. Open Questions

- ID/ME 设计阶段的具体产出格式？（当前暂定为 JSON，包含外观方案/结构设计描述）
- Ralph 的最大迭代次数是否需要各 Agent 差异化配置？（当前默认 10）
- Verification Agent 和 QA Agent 的职责边界？（Verification = 功能验证 + 反馈闭环，QA = 交叉验收 + 报告生成）
- 是否需要为每个 Agent 配置不同的 LLM 模型？（当前统一使用默认配置）
- 阶段时间标签（Day 1-15）是否需要在代码中体现？（当前仅作为注释说明）
