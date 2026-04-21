#!/usr/bin/env bash
# AgentFlow dmux 多 Agent 并发编排脚本
# 用法：./scripts/launch-agents.sh "你的项目目标描述"
#
# 前置条件：tmux, claude CLI 已安装

set -e

PROJECT_GOAL="${1:-默认项目目标}"
SESSION="agentflow"
WORKSPACE="/tmp/agentflow"

# 确保工作目录存在
mkdir -p "$WORKSPACE"

# 如果 session 已存在则先销毁
tmux has-session -t "$SESSION" 2>/dev/null && tmux kill-session -t "$SESSION"

echo "🚀 启动 AgentFlow 编排 Session: $SESSION"
echo "📋 项目目标: $PROJECT_GOAL"

# ────────────────────────────────────────────
# 创建 tmux session + 各 Agent 窗口
# ────────────────────────────────────────────

# 主控窗口 - PM Agent（阻塞等待完成再触发下游）
tmux new-session -d -s "$SESSION" -n "pm-agent" -x 220 -y 50
tmux send-keys -t "$SESSION:pm-agent" "
claude --print \"$(cat << 'PROMPT'
你是项目经理Agent。请对以下项目目标进行任务拆解：

项目目标：${PROJECT_GOAL}

输出格式（严格JSON）：
{
  \"tasks\": [
    {\"task_id\": \"T001\", \"title\": \"任务名\", \"owner_agent\": \"hw-agent|sw-agent|prod-agent|procurement-agent\", \"priority\": \"P0|P1|P2\", \"estimated_days\": 5, \"depends_on\": []}
  ],
  \"milestones\": [
    {\"id\": \"M1\", \"name\": \"里程碑名\", \"due_date\": \"2025-02-01\", \"owner\": \"pm-agent\"}
  ],
  \"risks\": [
    {\"id\": \"R001\", \"description\": \"风险描述\", \"owner_agent\": \"hw-agent\", \"severity\": \"high|medium|low\"}
  ]
}

完成后输出：DONE:PM
PROMPT
)\" | tee /tmp/agentflow/task_queue.json
echo '=== PM Agent 完成 ==='" Enter

# HW Agent 窗口（等待 PM 完成后启动）
tmux new-window -t "$SESSION" -n "hw-agent"
tmux send-keys -t "$SESSION:hw-agent" "
echo '等待 PM-Agent 完成...'
while ! grep -q 'DONE:PM' /tmp/agentflow/task_queue.json 2>/dev/null; do sleep 3; done
echo '✅ PM 完成，启动 HW Agent'
claude --print \"你是硬件工程师Agent。读取任务队列：\$(cat /tmp/agentflow/task_queue.json)\n\n请完成owner_agent=hw-agent的任务，生成BOM初稿和接口约定，输出JSON到/tmp/agentflow/hw_output.json，末尾打印DONE:HW\" | tee /tmp/agentflow/hw_output.json
echo '=== HW Agent 完成 ==='" Enter

# SW Agent 窗口（等待 PM 完成后启动，接口对齐等 HW）
tmux new-window -t "$SESSION" -n "sw-agent"
tmux send-keys -t "$SESSION:sw-agent" "
echo '等待 PM-Agent 完成...'
while ! grep -q 'DONE:PM' /tmp/agentflow/task_queue.json 2>/dev/null; do sleep 3; done
echo '✅ PM 完成，启动 SW Agent（并行）'
echo '等待 HW 接口约定...'
while ! grep -q 'DONE:HW' /tmp/agentflow/hw_output.json 2>/dev/null; do sleep 5; done
echo '✅ HW 接口就绪，SW 对齐接口'
claude --print \"你是软件工程师Agent。任务队列：\$(cat /tmp/agentflow/task_queue.json)\nHW接口约定：\$(cat /tmp/agentflow/hw_output.json)\n\n完成SW任务，生成API设计和代码骨架，输出到/tmp/agentflow/sw_output.md，末尾打印DONE:SW\" | tee /tmp/agentflow/sw_output.md
echo '=== SW Agent 完成 ==='" Enter

# Prod Agent 窗口
tmux new-window -t "$SESSION" -n "prod-agent"
tmux send-keys -t "$SESSION:prod-agent" "
echo '等待 PM-Agent 完成...'
while ! grep -q 'DONE:PM' /tmp/agentflow/task_queue.json 2>/dev/null; do sleep 3; done
echo '✅ 启动 Prod Agent'
claude --print \"你是产品经理Agent。任务队列：\$(cat /tmp/agentflow/task_queue.json)\n\n为prod-agent任务生成PRD、用户故事和验收标准，输出到/tmp/agentflow/prd_output.md，末尾打印DONE:PROD\" | tee /tmp/agentflow/prd_output.md
echo '=== Prod Agent 完成 ==='" Enter

# Procurement Agent（等 HW 的 BOM）
tmux new-window -t "$SESSION" -n "procurement-agent"
tmux send-keys -t "$SESSION:procurement-agent" "
echo '等待 HW-Agent 完成 BOM...'
while ! grep -q 'DONE:HW' /tmp/agentflow/hw_output.json 2>/dev/null; do sleep 5; done
echo '✅ BOM 就绪，启动采购 Agent'
claude --print \"你是采购Agent。BOM数据：\$(cat /tmp/agentflow/hw_output.json)\n\n执行供应商评估、交期风险分析和替代料推荐。交期超14天的标记为风险项写入/tmp/agentflow/risk_register.json。输出采购报告到/tmp/agentflow/procurement_output.json，末尾打印DONE:PROCUREMENT\" | tee /tmp/agentflow/procurement_output.json
echo '=== Procurement Agent 完成 ==='" Enter

# QA 汇总窗口（等所有 Agent 完成）
tmux new-window -t "$SESSION" -n "qa-agent"
tmux send-keys -t "$SESSION:qa-agent" "
echo '等待所有 Agent 完成...'
while ! (grep -q 'DONE:HW' /tmp/agentflow/hw_output.json 2>/dev/null && grep -q 'DONE:SW' /tmp/agentflow/sw_output.md 2>/dev/null && grep -q 'DONE:PROCUREMENT' /tmp/agentflow/procurement_output.json 2>/dev/null); do sleep 5; done
echo '✅ 所有 Agent 完成，启动 QA 验收'
claude --print \"你是质量验收Agent。请交叉验证：\nPRD：\$(cat /tmp/agentflow/prd_output.md)\nHW：\$(cat /tmp/agentflow/hw_output.json)\nSW：\$(cat /tmp/agentflow/sw_output.md)\n采购：\$(cat /tmp/agentflow/procurement_output.json)\n\n生成综合验收报告（接口对齐、BOM完整性、风险汇总），输出到/tmp/agentflow/qa_report.json\" | tee /tmp/agentflow/qa_report.json
echo '🎉 AgentFlow 本轮完成！'
# 触发推送风险摘要
bash /Users/a123/agent/agentflow/scripts/push-risk-summary.sh" Enter

# 回到 PM 窗口
tmux select-window -t "$SESSION:pm-agent"

echo ""
echo "✅ AgentFlow 已启动！"
echo "   查看所有窗口：tmux attach -t $SESSION"
echo "   切换窗口：Ctrl+B 然后按数字键"
echo "   各 Agent 输出在 /tmp/agentflow/ 目录下"
