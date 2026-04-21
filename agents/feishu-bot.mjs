#!/usr/bin/env node
/**
 * 飞书 Bot 长连接客户端
 *
 * 用法：
 *   FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx \
 *   AGENT_ID=tester AGENT_NAME="Tester Bot" \
 *   OPENCLAW_API_KEY=xxx \
 *   node agents/feishu-bot.mjs
 *
 * 或通过 npm run bot:tester（见 package.json）
 *
 * 行为：
 *   1. 建立飞书 WebSocket 长连接
 *   2. 收到群里 @本Bot 的消息
 *   3. 拼接 system prompt（基于 agent 角色）
 *   4. 调用 LLM 生成回复
 *   5. 回复到飞书群消息
 */

import * as lark from "@larksuiteoapi/node-sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─── 加载 .env ───────────────────────────────────────
function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

// ─── 读取 agents.json 中本 Bot 的配置 ───────────────
function loadAgentConfig() {
  const raw = fs.readFileSync(path.join(ROOT, "config/agents.json"), "utf-8");
  const resolved = raw.replace(/\$\{([^}]+)\}/g, (_, k) => process.env[k] ?? "");
  const cfg = JSON.parse(resolved);
  const agentId = process.env.AGENT_ID;
  return cfg.agents.find((a) => a.id === agentId) ?? null;
}

// ─── 环境变量 ────────────────────────────────────────
const APP_ID     = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const AGENT_ID   = process.env.AGENT_ID;
const AGENT_NAME = process.env.AGENT_NAME ?? AGENT_ID;

if (!APP_ID || !APP_SECRET || !AGENT_ID) {
  console.error("❌ 必须设置 FEISHU_APP_ID、FEISHU_APP_SECRET、AGENT_ID");
  process.exit(1);
}

const agentCfg = loadAgentConfig();

// ─── System Prompt（各 Agent 角色）────────────────────
const SYSTEM_PROMPTS = {
  tester: `你是「首席测试开发」，负责测试用例管理、质量保障与问题跟踪。
收到上游任务完成通知后，你需要：
1. 确认收到，说明你将开始哪些测试工作
2. 列出针对该任务的测试要点（3-5条）
3. 指出潜在风险点
请用简洁专业的语言回复，不超过300字。`,

  dataanalyst: `你是 DataAnalyst Bot，负责数据处理、报表生成与业务洞察。
收到任务通知后，你需要：
1. 确认收到
2. 说明你将分析哪些数据维度
3. 预估产出时间和报表内容
请用简洁专业的语言回复，不超过300字。`,

  "main-feishu": `你是「首席开发工程师」，负责技术研发与架构决策。
收到任务通知后，你需要：
1. 确认收到
2. 明确技术实现方案要点
3. 提出需要上游确认的技术依赖
请用简洁专业的语言回复，不超过300字。`,

  "productmanager-feishu": `你是「首席产品经理」，负责需求分析、产品规划与跨团队协作。
收到任务通知后，你需要：
1. 确认收到
2. 说明下一步产品动作
3. 需要同步给哪些角色
请用简洁专业的语言回复，不超过300字。`,

  "sales-feishu": `你是 Sales Bot（飞书），销售助手。
收到任务通知后，你需要：
1. 确认收到
2. 说明销售侧跟进计划
3. 客户沟通要点
请用简洁专业的语言回复，不超过300字。`,
};

const systemPrompt =
  SYSTEM_PROMPTS[AGENT_ID] ??
  `你是 ${AGENT_NAME}，一个专业的 AI 助手。请根据收到的消息提供专业回复，不超过300字。`;

// ─── 调用 LLM ────────────────────────────────────────
async function callLLM(userMessage) {
  const baseUrl =
    process.env.ANTHROPIC_BASE_URL ?? "https://coding.dashscope.aliyuncs.com/apps/anthropic";
  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.OPENCLAW_API_KEY;
  const model  = agentCfg?.env?.model
    ? process.env[agentCfg.env.model] ?? "claude-sonnet-4-6"
    : process.env.AGENT_MODEL ?? "claude-sonnet-4-6";

  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM 调用失败: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? "（无回复）";
}

// ─── 飞书客户端 ──────────────────────────────────────
const client = new lark.Client({ appId: APP_ID, appSecret: APP_SECRET });

// ─── 回复消息 ────────────────────────────────────────
async function replyMessage(messageId, content) {
  await client.im.message.reply({
    path: { message_id: messageId },
    data: {
      msg_type: "text",
      content:  JSON.stringify({ text: content }),
    },
  });
}

// ─── 处理收到的消息 ──────────────────────────────────
async function handleMessage(event) {
  const msg     = event?.message;
  const msgId   = msg?.message_id;
  const msgType = msg?.message_type;

  if (msgType !== "text") return; // 只处理文本消息

  let text = "";
  try {
    text = JSON.parse(msg.content)?.text ?? "";
  } catch {
    return;
  }

  // 去掉 @bot 的前缀
  const cleanText = text.replace(/@\S+\s*/g, "").trim();
  if (!cleanText) return;

  console.log(`[${AGENT_NAME}] 收到消息: ${cleanText.slice(0, 80)}`);

  try {
    const reply = await callLLM(cleanText);
    await replyMessage(msgId, `【${AGENT_NAME}】\n${reply}`);
    console.log(`[${AGENT_NAME}] 已回复`);
  } catch (err) {
    console.error(`[${AGENT_NAME}] 处理失败:`, err.message);
    await replyMessage(msgId, `【${AGENT_NAME}】⚠️ 处理出错: ${err.message}`).catch(() => {});
  }
}

// ─── 启动长连接 ──────────────────────────────────────
const wsClient = new lark.WSClient({ appId: APP_ID, appSecret: APP_SECRET });

wsClient.start({
  eventDispatcher: new lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (data) => {
      await handleMessage(data);
    },
  }),
});

console.log(`\n🤖 ${AGENT_NAME} 已启动（长连接模式）`);
console.log(`   App ID: ${APP_ID}`);
console.log(`   Agent:  ${AGENT_ID}`);
console.log(`   在飞书群 @${AGENT_NAME} 即可触发\n`);
