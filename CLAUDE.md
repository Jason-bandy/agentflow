# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AgentFlow is an AI agent orchestration platform for cross-department collaboration (hardware, software, procurement, production). It coordinates 14 specialized agents through a 5-phase directed acyclic graph (DAG) workflow, with automatic notification routing via DingTalk and Feishu.

## Architecture

```
agentflow/
├── config/
│   ├── sop-flow.jsonl          # 14-step SOP workflow (5 phases, JSONL)
│   └── agents.json             # Agent configs with notification routing (14 SOP + legacy)
├── mcp-servers/notify/
│   ├── server.js               # DingTalk+Feishu notification MCP Server
│   └── package.json
├── scripts/
│   ├── launch-agents.sh        # tmux-based 5-phase 14-Agent launcher
│   └── push-risk-summary.sh    # Risk summary push script
├── scripts/ralph/              # Ralph per-Agent directories
│   ├── CLAUDE.md               # Ralph agent instructions
│   ├── prd.json                # Ralph PRD (this project)
│   ├── progress.txt            # Ralph progress log
│   └── {pm,id,me-manager,me-lead,architect,hw,hw-board,fw,app,backend,procurement,verification,qa,production}/
│       ├── prd.json            # Per-Agent user stories
│       └── progress.txt        # Per-Agent progress
├── schedules/
│   ├── crontab.conf            # System crontab configuration
│   └── launchd-daily.plist     # macOS launchd configuration
└── .env                        # Environment variables (secrets)
```

## Core Components

### MCP Notification Server (`mcp-servers/notify/server.js`)

Express-based MCP server providing:
- `notify_agent` - Send messages to specific agents (auto-selects DingTalk/Feishu)
- `notify_downstream` - A2A (Agent-to-Agent) broadcast to downstream agents
- `generate_and_push_report` - LLM-generated reports with push notification
- `call_openclaw` - Direct LLM API access (Claude/Gemini/Qwen via OpenClaw gateway)
- `list_agents` - List configured agents

**LLM Routing Logic:**
1. `ANTHROPIC_BASE_URL` set → DashScope Anthropic-compatible endpoint (primary)
2. `gemini-*` models → OpenClaw gateway
3. Others → OpenClaw gateway (fallback)

### Agent Launcher (`scripts/launch-agents.sh`)

tmux-based orchestration script with 5-phase flow:
1. Creates 14 tmux windows (one per agent)
2. Implements dependency-based startup via file polling (`DONE:*` markers)
3. Phase 1 (serial): PM → ID → ME_MANAGER → ME_LEAD
4. Phase 2: ARCHITECT → HW_LEAD → HW_BOARD_APP
5. Phase 3 (parallel): FW_LEAD + APP_LEAD + BACKEND + PROCUREMENT
6. Phase 4 (parallel): VERIFICATION + QA
7. Phase 5: PRODUCTION_MANAGER
8. Writes outputs to `/tmp/agentflow/` directory
9. Triggers risk summary push on completion

### SOP Workflow (`config/sop-flow.jsonl`)

JSONL-based workflow with 14 steps across 5 phases:
- Each line is a valid JSON object with: step, phase, agent, role, trigger, prompt_template, output_file, next_trigger, next_agents, loop_mode
- Trigger conditions: `manual` or `DONE:<agent>` chains
- Loop mode enabled for design/dev agents that need to iterate

### Ralph Integration (`scripts/ralph/`)

Each SOP agent has an independent directory with:
- `prd.json` — User stories derived from their prompt_template in sop-flow.jsonl
- `progress.txt` — Progress log tracking implementation
- Ralph runs each agent independently with its own completion tracking

## Commands

### Install MCP Server
```bash
cd mcp-servers/notify
npm install
```

Register in `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "agentflow-notify": {
      "command": "node",
      "args": ["/Users/a123/agent/agentflow/mcp-servers/notify/server.js"],
      "env": { /* see .env.example */ }
    }
  }
}
```

### Launch Agents (5-Phase Flow)
```bash
./scripts/launch-agents.sh "项目目标描述"
tmux attach -t agentflow
```

### Ralph Agent Execution
```bash
# Run Ralph for a specific agent
cd scripts/ralph/<agent-dir>
bash ralph.sh
```

### Test MCP Server
```bash
npm run test  # Runs from mcp-servers/notify/
```

### Schedule Daily Push
```bash
# macOS launchd (persistent)
cp schedules/launchd-daily.plist ~/Library/LaunchAgents/com.agentflow.daily.plist
launchctl load ~/Library/LaunchAgents/com.agentflow.daily.plist

# Test manually
./scripts/push-risk-summary.sh
```

## Environment Variables

Required in `.env` (copy from `.env.example`):
- `OPENCLAW_BASE_URL`, `OPENCLAW_API_KEY` - LLM gateway
- `DINGTALK_WEBHOOK_PM`, `DINGTALK_SECRET` - PM group webhook
- `DINGTALK_*_CLIENT_ID/SECRET` - Department-specific DingTalk apps (14 SOP agents + legacy)
- `FEISHU_*_APP_ID/SECRET` - Department-specific Feishu apps
- `FEISHU_WEBHOOK_URL` - Feishu custom robot

## Agent Configuration

Agents are defined in `config/agents.json` with:
- `channel`: "dingtalk" or "feishu"
- `notifies`: downstream agent IDs to notify on completion
- `receives_from`: upstream agents this agent depends on
- `env`: environment variable mappings for credentials

SOP agents: pm-agent, id-agent, me-manager-agent, me-lead-agent, architect-agent, hw-lead-agent, hw-board-app-agent, fw-lead-agent, app-lead-agent, backend-agent, procurement-agent, verification-agent, qa-agent, production-manager-agent

Legacy agents: main, aftersale, sales, hr, productmanager, dataanalyst, tester, *-feishu (aliases)

## Workflow Execution (5-Phase Flow)

1. User provides project goal → `launch-agents.sh`
2. **Phase 1 (ID & ME, Day 1-15):** PM → ID → ME_MANAGER → ME_LEAD (serial chain)
3. **Phase 2 (HW & PCB, Day 15-20):** ARCHITECT → HW_LEAD → HW_BOARD_APP
4. **Phase 3 (Parallel Dev, Day 20-45):** FW_LEAD + APP_LEAD + BACKEND + PROCUREMENT (parallel)
   - FW depends on HW_LEAD + ARCHITECT; App/Backend depend on ARCHITECT; Procurement depends on HW_LEAD + ARCHITECT
5. **Phase 4 (Verification, Day 45-60):** VERIFICATION + QA (parallel)
   - Verification: checks implementation vs architecture, interface consistency, HW-SW alignment
   - QA: cross-validation including BOM completeness, PRD coverage, architecture alignment
6. **Phase 5 (Production, Day 60-90):** PRODUCTION_MANAGER (waits for both VERIFICATION and QA)
7. Risk summary pushed to DingTalk/Feishu

## Output Files

All agent outputs written to `/tmp/agentflow/`:
- `task_queue.json` - PM task breakdown
- `id_output.json` - Industrial design (appearance, CMF, color scheme)
- `me_manager_output.json` - Structural engineering (body design, stacking, engineering plans)
- `me_lead_output.json` - 3D structure, assembly SOP, mold assessment
- `architect_output.json` - System architecture, HW-SW interface spec, protocols
- `hw_output.json` - BOM + firmware version + PCB requirements
- `hw_board_output.json` - PCB layout, signal/power integrity, EMC/EMI
- `fw_output.json` - Firmware architecture, drivers, protocol stack
- `app_output.json` - App design, UI components, device connectivity
- `backend_output.json` - Backend API, database schema, deployment
- `procurement_output.json` - Supplier evaluation, cost, lead time risk
- `verification_output.json` - System verification results
- `verification_issues.json` - Failed verification issues (if any)
- `qa_report.json` - Cross-validation report
- `production_output.json` - Production plan, capacity, quality standards
- `risk_register.json` - High-risk items (lead time >14 days)
