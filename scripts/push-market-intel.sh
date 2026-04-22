#!/usr/bin/env bash
# AgentFlow 市场情报报告推送脚本
# 由 cron / Claude Code CronCreate 调用
#
# 用法：./scripts/push-market-intel.js
#   或：bash scripts/push-market-intel.sh
#
# 环境变量（在 .env 文件中配置）：
#   OPENCLAW_BASE_URL, OPENCLAW_API_KEY     - LLM 网关
#   ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN - DashScope（可选）
#   DINGTALK_SECRET                          - 钉钉 Webhook 签名密钥

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
WORKSPACE="/tmp/agentflow"
ENV_FILE="$ROOT_DIR/.env"
LOG_FILE="$WORKSPACE/market-intel-log.txt"

# 加载环境变量
[ -f "$ENV_FILE" ] && source "$ENV_FILE"

mkdir -p "$WORKSPACE"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始生成市场情报报告..." | tee -a "$LOG_FILE"

node "$SCRIPT_DIR/push-market-intel.js" 2>&1 | tee -a "$LOG_FILE"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 市场情报推送完成" | tee -a "$LOG_FILE"
