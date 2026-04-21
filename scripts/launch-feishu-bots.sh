#!/usr/bin/env bash
# launch-feishu-bots.sh — 启动所有飞书长连接 Bot
# 用法: ./scripts/launch-feishu-bots.sh [bot_id]
#   不传参数 → 启动所有飞书 Bot
#   传参数   → 只启动指定 bot（如 tester）

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 加载 .env
set -a; [ -f .env ] && source .env; set +a

BOT_SCRIPT="$ROOT/agents/feishu-bot.mjs"
ONLY="${1:-}"

declare -A BOT_NAMES=(
  ["tester"]="Tester Bot"
  ["dataanalyst"]="DataAnalyst Bot"
  ["main-feishu"]="Main Dev Bot (飞书)"
  ["productmanager-feishu"]="ProductManager Bot (飞书)"
  ["sales-feishu"]="Sales Bot (飞书)"
)

declare -A BOT_APP_IDS=(
  ["tester"]="$FEISHU_TESTER_APP_ID"
  ["dataanalyst"]="$FEISHU_DATAANALYST_APP_ID"
  ["main-feishu"]="$FEISHU_MAIN_APP_ID"
  ["productmanager-feishu"]="$FEISHU_PM_APP_ID"
  ["sales-feishu"]="$FEISHU_SALES_APP_ID"
)

declare -A BOT_APP_SECRETS=(
  ["tester"]="$FEISHU_TESTER_APP_SECRET"
  ["dataanalyst"]="$FEISHU_DATAANALYST_APP_SECRET"
  ["main-feishu"]="$FEISHU_MAIN_APP_SECRET"
  ["productmanager-feishu"]="$FEISHU_PM_APP_SECRET"
  ["sales-feishu"]="$FEISHU_SALES_APP_SECRET"
)

# 检查 tmux
if ! command -v tmux &>/dev/null; then
  echo "❌ 需要安装 tmux: brew install tmux"
  exit 1
fi

SESSION="feishu-bots"

# 如果 session 已存在先杀掉
tmux kill-session -t "$SESSION" 2>/dev/null || true
tmux new-session -d -s "$SESSION" -x 220 -y 50

FIRST=true
for BOT_ID in "${!BOT_NAMES[@]}"; do
  [[ -n "$ONLY" && "$BOT_ID" != "$ONLY" ]] && continue

  APP_ID="${BOT_APP_IDS[$BOT_ID]}"
  APP_SECRET="${BOT_APP_SECRETS[$BOT_ID]}"
  BOT_NAME="${BOT_NAMES[$BOT_ID]}"

  if [[ -z "$APP_ID" || -z "$APP_SECRET" ]]; then
    echo "⚠️  跳过 $BOT_ID（未配置 APP_ID/SECRET）"
    continue
  fi

  if $FIRST; then
    tmux rename-window -t "$SESSION:0" "$BOT_ID"
    FIRST=false
  else
    tmux new-window -t "$SESSION" -n "$BOT_ID"
  fi

  tmux send-keys -t "$SESSION:$BOT_ID" \
    "FEISHU_APP_ID='$APP_ID' FEISHU_APP_SECRET='$APP_SECRET' AGENT_ID='$BOT_ID' AGENT_NAME='$BOT_NAME' node '$BOT_SCRIPT'" \
    Enter

  echo "✅ 已启动 $BOT_NAME ($BOT_ID)"
done

echo ""
echo "🚀 飞书 Bot 全部启动完毕"
echo "   查看: tmux attach -t $SESSION"
echo "   切换窗口: Ctrl+B + 数字键"
