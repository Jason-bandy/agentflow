# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AgentFlow is an AI agent orchestration platform for cross-department collaboration (hardware, software, procurement, production). It coordinates multiple specialized agents through a directed acyclic graph (DAG) workflow, with automatic notification routing via DingTalk and Feishu.

## Architecture

```
agentflow/
├── config/
│   ├── sop-flow.jsonl          # Agent SOP workflow definitions (JSONL)
│   └── agents.json             # Agent configurations with notification routing
├── mcp-servers/notify/
│   ├── server.js               # DingTalk+Feishu notification MCP Server
│   └── package.json
├── scripts/
│   ├── launch-agents.sh        # tmux-based multi-Agent launcher
│   └── push-risk-summary.sh    # Risk summary push script
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

tmux-based orchestration script that:
1. Creates separate windows per agent (pm, hw, sw, prod, procurement, qa)
2. Implements dependency-based startup via file polling (`DONE:*` markers)
3. Writes outputs to `/tmp/agentflow/` directory
4. Triggers risk summary push on completion

### SOP Workflow (`config/sop-flow.jsonl`)

JSONL-based workflow definitions specifying:
- Step number, agent ID, role
- Trigger conditions (`manual`, `DONE:<agent>`)
- Dependencies and output files
- Loop mode and conditions

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

### Launch Agents
```bash
./scripts/launch-agents.sh "项目目标描述"
tmux attach -t agentflow
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
- `DINGTALK_*_CLIENT_ID/SECRET` - Department-specific DingTalk apps
- `FEISHU_*_APP_ID/SECRET` - Department-specific Feishu apps
- `FEISHU_WEBHOOK_URL` - Feishu custom robot

## Agent Configuration

Agents are defined in `config/agents.json` with:
- `channel`: "dingtalk" or "feishu"
- `notifies`: downstream agent IDs to notify on completion
- `receives_from`: upstream agents this agent depends on
- `env`: environment variable mappings for credentials

## Workflow Execution

1. User provides project goal → `launch-agents.sh`
2. PM-Agent generates task queue → writes `task_queue.json`
3. HW/SW/Prod agents start in parallel after `DONE:PM`
4. SW waits for HW interface definition before aligning
5. Procurement waits for HW BOM
6. QA validates all outputs → generates `qa_report.json`
7. Risk summary pushed to DingTalk/Feishu

## Output Files

All agent outputs written to `/tmp/agentflow/`:
- `task_queue.json` - PM task breakdown
- `hw_output.json` - BOM + interface specs
- `sw_output.md` - API design + code skeleton
- `prd_output.md` - Product requirements
- `procurement_output.json` - Supplier evaluation
- `risk_register.json` - High-risk items (lead time >14 days)
- `qa_report.json` - Cross-validation report
