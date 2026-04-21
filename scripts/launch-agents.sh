#!/usr/bin/env bash
# AgentFlow 5 阶段 SOP 多 Agent 并发编排脚本
# 用法：./scripts/launch-agents.sh "你的项目目标描述"
#
# 前置条件：tmux, claude CLI 已安装
#
# 阶段：
#   Phase 1 - ID & ME Design (Day 1-15):  PM → ID → ME_MANAGER → ME_LEAD (串行)
#   Phase 2 - HW & PCB (Day 15-20):       ARCHITECT → HW_LEAD → HW_BOARD_APP
#   Phase 3 - Parallel Dev (Day 20-45):   FW_LEAD + APP_LEAD + BACKEND + PROCUREMENT (并行)
#   Phase 4 - Verification (Day 45-60):   VERIFICATION + QA (并行)
#   Phase 5 - Production (Day 60-90):     PRODUCTION

set -e

PROJECT_GOAL="${1:-默认项目目标}"
SESSION="agentflow"
WORKSPACE="/tmp/agentflow"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 确保工作目录存在
mkdir -p "$WORKSPACE"

# 如果 session 已存在则先销毁
tmux has-session -t "$SESSION" 2>/dev/null && tmux kill-session -t "$SESSION"

echo "🚀 启动 AgentFlow 5 阶段编排 Session: $SESSION"
echo "📋 项目目标: $PROJECT_GOAL"

# ────────────────────────────────────────────
# Phase 1 - ID & ME Design (Day 1-15) 串行
# ────────────────────────────────────────────

# PM Agent (Phase 1 起点)
tmux new-session -d -s "$SESSION" -n "pm-agent" -x 220 -y 50
tmux send-keys -t "$SESSION:pm-agent" "
echo '=== Phase 1: ID & ME Design ==='
claude --dangerously-skip-permissions --print \"你是项目经理Agent。项目目标：${PROJECT_GOAL}\n\n请输出：1.任务清单(JSON:task_id,title,owner_agent,priority,estimated_days,depends_on) 2.关键里程碑(M1-M5对应5个阶段) 3.风险预判(每项附对应部门Agent)\n\n完成后写入 /tmp/agentflow/task_queue.json，末尾打印 DONE:PM\" | tee /tmp/agentflow/task_queue.json
echo '=== PM Agent 完成 ==='
" Enter

# ID Agent (wait: PM)
tmux new-window -t "$SESSION" -n "id-agent"
tmux send-keys -t "$SESSION:id-agent" "
echo '等待 PM 完成...'
while ! grep -q 'DONE:PM' /tmp/agentflow/task_queue.json 2>/dev/null; do sleep 3; done
echo '✅ PM 完成，启动 ID Agent'
claude --dangerously-skip-permissions --print \"你是工业设计师Agent。读取任务队列：\$(cat /tmp/agentflow/task_queue.json)\n\n请完成：1.产品外观设计方案(2D/3D渲染图描述) 2.材料选择建议(CMF:Color/Material/Finish) 3.色彩定义与配色方案 4.人机交互外观设计\n\n输出写入 /tmp/agentflow/id_output.json，末尾打印 DONE:ID\" | tee /tmp/agentflow/id_output.json
echo '=== ID Agent 完成 ==='
" Enter

# ME Manager Agent (wait: ID)
tmux new-window -t "$SESSION" -n "me-manager"
tmux send-keys -t "$SESSION:me-manager" "
echo '等待 ID 完成...'
while ! grep -q 'DONE:ID' /tmp/agentflow/id_output.json 2>/dev/null; do sleep 3; done
echo '✅ ID 完成，启动 ME Manager Agent'
claude --dangerously-skip-permissions --print \"你是结构工程经理Agent。读取外观方案：\$(cat /tmp/agentflow/id_output.json)\n\n请完成：1.主体结构设计方案 2.内部堆叠与空间规划 3.防水/防尘/散热等工程方案 4.结构件BOM初稿\n\n输出写入 /tmp/agentflow/me_manager_output.json，末尾打印 DONE:ME_MANAGER\" | tee /tmp/agentflow/me_manager_output.json
echo '=== ME Manager Agent 完成 ==='
" Enter

# ME Lead Agent (wait: ME_MANAGER)
tmux new-window -t "$SESSION" -n "me-lead"
tmux send-keys -t "$SESSION:me-lead" "
echo '等待 ME Manager 完成...'
while ! grep -q 'DONE:ME_MANAGER' /tmp/agentflow/me_manager_output.json 2>/dev/null; do sleep 3; done
echo '✅ ME Manager 完成，启动 ME Lead Agent'
claude --dangerously-skip-permissions --print \"你是结构工程主管Agent。读取结构方案：\$(cat /tmp/agentflow/me_manager_output.json)\n\n请完成：1.3D结构图定义(部件关系、公差分析) 2.装配方案设计(SOP草案) 3.模具需求评估 4.与ID方案的对齐检查\n\n输出写入 /tmp/agentflow/me_lead_output.json，末尾打印 DONE:ME_LEAD\" | tee /tmp/agentflow/me_lead_output.json
echo '=== ME Lead Agent 完成 ==='
" Enter

# ────────────────────────────────────────────
# Phase 2 - HW & PCB (Day 15-20)
# ────────────────────────────────────────────

# Architect Agent (wait: ME_LEAD)
tmux new-window -t "$SESSION" -n "architect"
tmux send-keys -t "$SESSION:architect" "
echo '等待 ME Lead 完成(Phase 1)...'
while ! grep -q 'DONE:ME_LEAD' /tmp/agentflow/me_lead_output.json 2>/dev/null; do sleep 3; done
echo '✅ Phase 1 完成，启动 Architect Agent'
claude --dangerously-skip-permissions --print \"你是系统架构师Agent。读取：任务队列\$(cat /tmp/agentflow/task_queue.json)\n3D结构与装配方案：\$(cat /tmp/agentflow/me_lead_output.json)\n\n请完成：1.系统功能架构设计(模块划分、数据流、控制流) 2.软硬件接口约定 3.通信协议定义(BLE/WiFi/UART/I2C/SPI) 4.数据存储与同步方案 5.安全与加密方案\n\n输出写入 /tmp/agentflow/architect_output.json，末尾打印 DONE:ARCHITECT\" | tee /tmp/agentflow/architect_output.json
echo '=== Architect Agent 完成 ==='
" Enter

# HW Lead Agent (wait: ARCHITECT)
tmux new-window -t "$SESSION" -n "hw-lead"
tmux send-keys -t "$SESSION:hw-lead" "
echo '等待 Architect 完成...'
while ! grep -q 'DONE:ARCHITECT' /tmp/agentflow/architect_output.json 2>/dev/null; do sleep 3; done
echo '✅ Architect 完成，启动 HW Lead Agent'
claude --dangerously-skip-permissions --print \"你是硬件工程师Agent。读取架构方案：\$(cat /tmp/agentflow/architect_output.json)\n\n请完成：1.硬件选型方案与BOM清单(料号/规格/供应商) 2.PCB需求描述(层数/尺寸/阻抗要求) 3.固件版本号定义(v{major}.{minor}.{patch}) 4.接口约定对齐(I2C/SPI/UART协议参数) 5.测试点定义\n\n输出写入 /tmp/agentflow/hw_output.json，末尾打印 DONE:HW_LEAD\" | tee /tmp/agentflow/hw_output.json
echo '=== HW Lead Agent 完成 ==='
" Enter

# HW Board App Agent (wait: HW_LEAD)
tmux new-window -t "$SESSION" -n "hw-board"
tmux send-keys -t "$SESSION:hw-board" "
echo '等待 HW Lead 完成...'
while ! grep -q 'DONE:HW_LEAD' /tmp/agentflow/hw_output.json 2>/dev/null; do sleep 3; done
echo '✅ HW Lead 完成，启动 HW Board App Agent'
claude --dangerously-skip-permissions --print \"你是PCB应用工程师Agent。读取：BOM与PCB需求\$(cat /tmp/agentflow/hw_output.json)\n架构接口约定：\$(cat /tmp/agentflow/architect_output.json)\n\n请完成：1.PCB布局方案(关键器件placement) 2.信号完整性分析 3.电源完整性分析 4.EMC/EMI设计考虑 5.Gerber文件需求描述\n\n输出写入 /tmp/agentflow/hw_board_output.json，末尾打印 DONE:HW_BOARD\" | tee /tmp/agentflow/hw_board_output.json
echo '=== HW Board App Agent 完成 ==='
" Enter

# ────────────────────────────────────────────
# Phase 3 - Parallel Dev (Day 20-45) 并行
# ────────────────────────────────────────────

# FW Lead Agent (wait: HW_LEAD + ARCHITECT)
tmux new-window -t "$SESSION" -n "fw-lead"
tmux send-keys -t "$SESSION:fw-lead" "
echo '等待 HW Lead + Architect 完成...'
while ! (grep -q 'DONE:HW_LEAD' /tmp/agentflow/hw_output.json 2>/dev/null && grep -q 'DONE:ARCHITECT' /tmp/agentflow/architect_output.json 2>/dev/null); do sleep 3; done
echo '✅ HW + Architect 完成，启动 FW Lead Agent'
claude --dangerously-skip-permissions --print \"你是固件工程师Agent。读取：架构接口约定\$(cat /tmp/agentflow/architect_output.json)\nBOM与固件版本：\$(cat /tmp/agentflow/hw_output.json)\n\n请完成：1.固件架构设计(RTLS/Bare-metal选择、任务划分) 2.外设驱动代码骨架(I2C/SPI/UART/GPIO/ADC) 3.通信协议栈实现(BLE/WiFi/MQTT) 4.OTA升级方案 5.功耗优化方案 6.单元测试框架\n\n输出写入 /tmp/agentflow/fw_output.json，末尾打印 DONE:FW\" | tee /tmp/agentflow/fw_output.json
echo '=== FW Lead Agent 完成 ==='
" Enter

# App Lead Agent (wait: ARCHITECT)
tmux new-window -t "$SESSION" -n "app-lead"
tmux send-keys -t "$SESSION:app-lead" "
echo '等待 Architect 完成...'
while ! grep -q 'DONE:ARCHITECT' /tmp/agentflow/architect_output.json 2>/dev/null; do sleep 3; done
echo '✅ Architect 完成，启动 App Lead Agent'
claude --dangerously-skip-permissions --print \"你是App开发工程师Agent。读取架构方案：\$(cat /tmp/agentflow/architect_output.json)\n\n请完成：1.App技术选型(iOS/Android/Flutter/React Native) 2.UI组件设计与状态管理方案 3.API调用层实现 4.设备连接与通信模块(BLE/WiFi) 5.数据持久化方案 6.单元测试框架\n\n输出写入 /tmp/agentflow/app_output.json，末尾打印 DONE:APP\" | tee /tmp/agentflow/app_output.json
echo '=== App Lead Agent 完成 ==='
" Enter

# Backend Agent (wait: ARCHITECT)
tmux new-window -t "$SESSION" -n "backend"
tmux send-keys -t "$SESSION:backend" "
echo '等待 Architect 完成...'
while ! grep -q 'DONE:ARCHITECT' /tmp/agentflow/architect_output.json 2>/dev/null; do sleep 3; done
echo '✅ Architect 完成，启动 Backend Agent'
claude --dangerously-skip-permissions --print \"你是后端工程师Agent。读取架构方案：\$(cat /tmp/agentflow/architect_output.json)\n\n请完成：1.后端技术栈选择与API服务设计(REST/GraphQL) 2.数据库Schema设计 3.用户认证与授权方案 4.设备管理API(注册/状态/OTA推送) 5.数据上报与统计分析API 6.部署方案与监控告警\n\n输出写入 /tmp/agentflow/backend_output.json，末尾打印 DONE:BACKEND\" | tee /tmp/agentflow/backend_output.json
echo '=== Backend Agent 完成 ==='
" Enter

# Procurement Agent (wait: HW_LEAD + ARCHITECT)
tmux new-window -t "$SESSION" -n "procurement"
tmux send-keys -t "$SESSION:procurement" "
echo '等待 HW Lead + Architect 完成...'
while ! (grep -q 'DONE:HW_LEAD' /tmp/agentflow/hw_output.json 2>/dev/null && grep -q 'DONE:ARCHITECT' /tmp/agentflow/architect_output.json 2>/dev/null); do sleep 3; done
echo '✅ HW + Architect 完成，启动 Procurement Agent'
claude --dangerously-skip-permissions --print \"你是采购Agent。读取：BOM清单\$(cat /tmp/agentflow/hw_output.json)\n接口约定与规格：\$(cat /tmp/agentflow/architect_output.json)\n\n请完成：1.供应商询价 2.交期风险评估 3.替代料推荐 4.采购成本汇总。若有料号交期超14天，自动标记为[风险项]写入 /tmp/agentflow/risk_register.json\n\n输出采购报告到 /tmp/agentflow/procurement_output.json，末尾打印 DONE:PROCUREMENT\" | tee /tmp/agentflow/procurement_output.json
echo '=== Procurement Agent 完成 ==='
" Enter

# ────────────────────────────────────────────
# Phase 4 - Verification (Day 45-60) 并行
# ────────────────────────────────────────────

# Verification Agent (wait: FW + APP + BACKEND + HW_LEAD + ARCHITECT)
tmux new-window -t "$SESSION" -n "verification"
tmux send-keys -t "$SESSION:verification" "
echo '等待所有开发 Agent 完成(FW/APP/BACKEND/HW/ARCHITECT)...'
while ! (grep -q 'DONE:FW' /tmp/agentflow/fw_output.json 2>/dev/null && grep -q 'DONE:APP' /tmp/agentflow/app_output.json 2>/dev/null && grep -q 'DONE:BACKEND' /tmp/agentflow/backend_output.json 2>/dev/null && grep -q 'DONE:HW_LEAD' /tmp/agentflow/hw_output.json 2>/dev/null && grep -q 'DONE:ARCHITECT' /tmp/agentflow/architect_output.json 2>/dev/null); do sleep 5; done
echo '✅ 所有开发完成，启动 Verification Agent'
claude --dangerously-skip-permissions --print \"你是验证工程师Agent。请读取所有产出文件并执行系统功能验证：\n1.实现vs架构方案对齐度检查 2.App/FW/Backend三者接口一致性验证 3.软硬件接口对齐检查 4.系统功能完整性验证\n\n若验证通过 → 打印 DONE:VERIFICATION\n若验证不通过 → 生成 /tmp/agentflow/verification_issues.json 标记问题Agent的prd.json为passes:false\n\n输出写入 /tmp/agentflow/verification_output.json\" | tee /tmp/agentflow/verification_output.json
echo '=== Verification Agent 完成 ==='
" Enter

# QA Agent (wait: APP + FW + BACKEND + HW_LEAD + PROCUREMENT)
tmux new-window -t "$SESSION" -n "qa-agent"
tmux send-keys -t "$SESSION:qa-agent" "
echo '等待开发+采购完成(APP/FW/BACKEND/HW/PROCUREMENT)...'
while ! (grep -q 'DONE:APP' /tmp/agentflow/app_output.json 2>/dev/null && grep -q 'DONE:FW' /tmp/agentflow/fw_output.json 2>/dev/null && grep -q 'DONE:BACKEND' /tmp/agentflow/backend_output.json 2>/dev/null && grep -q 'DONE:HW_LEAD' /tmp/agentflow/hw_output.json 2>/dev/null && grep -q 'DONE:PROCUREMENT' /tmp/agentflow/procurement_output.json 2>/dev/null); do sleep 5; done
echo '✅ 开发+采购完成，启动 QA Agent'
claude --dangerously-skip-permissions --print \"你是质量验收Agent。请交叉验证所有产出文件：\n1.实现vs架构方案对齐度 2.App/FW/Backend三者接口一致性 3.HW接口vsSW接口对齐 4.BOM完整性 5.PRD覆盖率 6.风险项汇总\n\n生成综合验收报告到 /tmp/agentflow/qa_report.json，末尾打印 DONE:QA\" | tee /tmp/agentflow/qa_report.json
echo '=== QA Agent 完成 ==='
" Enter

# ────────────────────────────────────────────
# Phase 5 - Production (Day 60-90)
# ────────────────────────────────────────────

# Production Manager Agent (wait: VERIFICATION + QA)
tmux new-window -t "$SESSION" -n "production"
tmux send-keys -t "$SESSION:production" "
echo '等待 VERIFICATION + QA 完成...'
while ! (grep -q 'DONE:VERIFICATION' /tmp/agentflow/verification_output.json 2>/dev/null && grep -q 'DONE:QA' /tmp/agentflow/qa_report.json 2>/dev/null); do sleep 5; done
echo '✅ 验证+QA完成，启动 Production Manager Agent'
claude --dangerously-skip-permissions --print \"你是生产经理Agent。读取：QA报告\$(cat /tmp/agentflow/qa_report.json)\n验证结果\$(cat /tmp/agentflow/verification_output.json)\n采购成本与交期\$(cat /tmp/agentflow/procurement_output.json)\n\n请完成：1.生产计划排期(EVT/DVT/PVT/MP里程碑) 2.产能评估(日产能/月产能/瓶颈分析) 3.质量控制标准(IQC/IPQC/OQC/FQC) 4.试产计划(数量/周期/验收标准) 5.供应链风险评估与备选方案\n\n输出写入 /tmp/agentflow/production_output.json，末尾打印 DONE:PRODUCTION\" | tee /tmp/agentflow/production_output.json
echo '🎉 AgentFlow 5 阶段完成！'
# 触发推送风险摘要
bash \"${PROJECT_ROOT}/scripts/push-risk-summary.sh\"
" Enter

# ────────────────────────────────────────────
# 回到 PM 窗口
# ────────────────────────────────────────────
tmux select-window -t "$SESSION:pm-agent"

echo ""
echo "✅ AgentFlow 5 阶段已启动！"
echo "   查看所有窗口：tmux attach -t $SESSION"
echo "   切换窗口：Ctrl+B 然后按数字键"
echo "   各 Agent 输出在 /tmp/agentflow/ 目录下"
echo ""
echo "   阶段流转：Phase 1(串行 PM→ID→ME_MGR→ME_LEAD) → Phase 2(ARCH→HW→BOARD) → Phase 3(并行 FW/APP/BACK/PROC) → Phase 4(并行 VERIF/QA) → Phase 5(PROD)"
