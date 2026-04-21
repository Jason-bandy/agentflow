#!/usr/bin/env bash
# AgentFlow 项目风险摘要推送脚本
# 由 cron / Claude Code CronCreate 调用
#
# 用法：
#   直接调用：./scripts/push-risk-summary.sh
#   带参数：  ./scripts/push-risk-summary.sh --project "项目名" --dept "hardware"
#
# 环境变量（在 .env 文件中配置）：
#   DINGTALK_WEBHOOK_URL, DINGTALK_SECRET
#   FEISHU_WEBHOOK_URL
#   CLAUDE_API_KEY（用于 AI 摘要生成，可选）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
WORKSPACE="/tmp/agentflow"
ENV_FILE="$ROOT_DIR/.env"
LOG_FILE="$WORKSPACE/push-log.txt"

# 加载环境变量
[ -f "$ENV_FILE" ] && source "$ENV_FILE"

mkdir -p "$WORKSPACE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始生成风险摘要..." | tee -a "$LOG_FILE"

# ──────────────────────────────────────────────
# 1. 收集各 Agent 产出（读取最新文件或默认值）
# ──────────────────────────────────────────────

TODAY=$(date '+%Y年%m月%d日')
WEEKDAY=$(date '+%A' | sed 's/Monday/周一/;s/Tuesday/周二/;s/Wednesday/周三/;s/Thursday/周四/;s/Friday/周五/;s/Saturday/周六/;s/Sunday/周日/')

# 读取风险登记册（如果存在）
RISKS=""
if [ -f "$WORKSPACE/risk_register.json" ]; then
  RISKS=$(cat "$WORKSPACE/risk_register.json" 2>/dev/null || echo "[]")
fi

# 读取 QA 报告（如果存在）
QA_STATUS="进行中"
if [ -f "$WORKSPACE/qa_report.json" ]; then
  QA_STATUS=$(grep -o '"status":"[^"]*"' "$WORKSPACE/qa_report.json" 2>/dev/null | head -1 | cut -d'"' -f4 || echo "进行中")
fi

# ──────────────────────────────────────────────
# 2. 构建摘要内容
# ──────────────────────────────────────────────

build_summary() {
  cat << EOF
## 📊 AgentFlow 项目日报 - $TODAY ($WEEKDAY)

### 🤖 Agent 运行状态
| Agent | 状态 | 产出 |
|-------|------|------|
| PM-Agent | $([ -f "$WORKSPACE/task_queue.json" ] && echo "✅ 完成" || echo "⏳ 待启动") | 任务队列 |
| HW-Agent | $([ -f "$WORKSPACE/hw_output.json" ] && echo "✅ 完成" || echo "⏳ 待启动") | BOM + 接口约定 |
| SW-Agent | $([ -f "$WORKSPACE/sw_output.md" ] && echo "✅ 完成" || echo "⏳ 待启动") | 代码骨架 + API |
| Prod-Agent | $([ -f "$WORKSPACE/prd_output.md" ] && echo "✅ 完成" || echo "⏳ 待启动") | PRD 文档 |
| 采购-Agent | $([ -f "$WORKSPACE/procurement_output.json" ] && echo "✅ 完成" || echo "⏳ 待启动") | 供应商评估 |
| QA-Agent | $([ -f "$WORKSPACE/qa_report.json" ] && echo "✅ 完成" || echo "⏳ 待启动") | 验收报告 |

### ⚠️ 风险事项
$(if [ -f "$WORKSPACE/risk_register.json" ]; then
  echo "$(cat "$WORKSPACE/risk_register.json" | python3 -c "
import json, sys
risks = json.load(sys.stdin)
if not risks:
  print('暂无高风险事项 ✅')
else:
  for r in risks[:5]:
    level = r.get('severity','medium')
    emoji = '🔴' if level=='high' else '🟡' if level=='medium' else '🟢'
    print(f\"{emoji} [{r.get('id','')}] {r.get('description','')} (负责: {r.get('owner_agent','')})\")" 2>/dev/null || echo "风险数据解析中...")"
else
  echo "暂无风险登记"
fi)

### 📅 今日待决策事项
- [ ] 确认 HW/SW 接口协议版本
- [ ] 审批超交期料号替代方案
- [ ] Review QA 验收报告

---
*由 AgentFlow 自动生成 | $(date '+%H:%M') 推送*
EOF
}

SUMMARY=$(build_summary)
TITLE="AgentFlow 项目日报 - $TODAY"

# ──────────────────────────────────────────────
# 3. 推送钉钉 Webhook
# ──────────────────────────────────────────────

push_dingtalk_webhook() {
  local url="$DINGTALK_WEBHOOK_URL"
  local secret="${DINGTALK_SECRET:-}"

  if [ -n "$secret" ]; then
    local ts=$(date +%s%3N)
    local sign=$(echo -e "${ts}\n${secret}" | openssl dgst -sha256 -hmac "$secret" -binary | base64 | tr -d '\n' | python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read()))")
    url="${url}&timestamp=${ts}&sign=${sign}"
  fi

  local payload=$(cat << EOF
{
  "msgtype": "markdown",
  "markdown": {
    "title": "$TITLE",
    "text": $(echo "$SUMMARY" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))")
  },
  "at": {"isAtAll": false}
}
EOF
)
  curl -s -X POST "$url" \
    -H "Content-Type: application/json" \
    -d "$payload" | tee -a "$LOG_FILE"
  echo "" | tee -a "$LOG_FILE"
  echo "[$(date '+%H:%M:%S')] ✅ 钉钉 Webhook 推送完成" | tee -a "$LOG_FILE"
}

# ──────────────────────────────────────────────
# 4. 推送飞书 Webhook
# ──────────────────────────────────────────────

push_feishu_webhook() {
  local content_json=$(echo "$SUMMARY" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))")
  local payload=$(cat << EOF
{
  "msg_type": "interactive",
  "card": {
    "header": {
      "title": {"tag": "plain_text", "content": "$TITLE"},
      "template": "blue"
    },
    "elements": [
      {
        "tag": "div",
        "text": {"tag": "lark_md", "content": $content_json}
      },
      {
        "tag": "action",
        "actions": [
          {
            "tag": "button",
            "text": {"tag": "plain_text", "content": "查看详细报告"},
            "type": "primary",
            "url": "http://localhost:3000/dashboard"
          }
        ]
      }
    ]
  }
}
EOF
)
  curl -s -X POST "$FEISHU_WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "$payload" | tee -a "$LOG_FILE"
  echo "" | tee -a "$LOG_FILE"
  echo "[$(date '+%H:%M:%S')] ✅ 飞书 Webhook 推送完成" | tee -a "$LOG_FILE"
}

# ──────────────────────────────────────────────
# 5. 执行推送
# ──────────────────────────────────────────────

PUSHED=0

# 兼容 .env 中 DINGTALK_WEBHOOK_PM 变量名
DINGTALK_WEBHOOK_URL="${DINGTALK_WEBHOOK_URL:-${DINGTALK_WEBHOOK_PM:-}}"

if [ -n "${DINGTALK_WEBHOOK_URL:-}" ]; then
  push_dingtalk_webhook
  PUSHED=$((PUSHED + 1))
else
  echo "[WARN] 未配置 DINGTALK_WEBHOOK_URL，跳过钉钉推送" | tee -a "$LOG_FILE"
fi

if [ -n "${FEISHU_WEBHOOK_URL:-}" ]; then
  push_feishu_webhook
  PUSHED=$((PUSHED + 1))
else
  echo "[WARN] 未配置 FEISHU_WEBHOOK_URL，跳过飞书推送" | tee -a "$LOG_FILE"
fi

if [ "$PUSHED" -eq 0 ]; then
  echo "[ERROR] 未配置任何推送渠道！请在 .env 文件中设置 DINGTALK_WEBHOOK_URL 或 FEISHU_WEBHOOK_URL" | tee -a "$LOG_FILE"
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 摘要推送完成，共推送 $PUSHED 个渠道" | tee -a "$LOG_FILE"
