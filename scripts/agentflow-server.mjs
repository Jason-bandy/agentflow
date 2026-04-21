#!/usr/bin/env node
/**
 * AgentFlow Outgoing Webhook HTTP Server
 *
 * 接收钉钉群的出站消息（Outgoing Webhook），
 * 检测完成关键词，自动推送调度群 + 下游 Agent 群。
 *
 * 启动：node scripts/agentflow-server.mjs
 * 端口：AGENTFLOW_SERVER_PORT（默认 3456）
 *
 * 钉钉 Outgoing Webhook 配置路径（在钉钉开放平台）：
 *   机器人管理 → 出站消息 → 填入：http://YOUR_IP:3456/webhook/dingtalk
 *
 * 钉钉 Outgoing Webhook POST 数据格式：
 * {
 *   "msgtype": "text",
 *   "text": { "content": " 完成了" },
 *   "senderNick": "张三",
 *   "chatbotUserId": "@bot_id",
 *   "sessionWebhook": "https://oapi.dingtalk.com/robot/sendBySession?session=xxx",
 *   "sessionWebhookExpiredTime": 1234567890,
 *   "conversationTitle": "AgentFlow 协同群"
 * }
 */

import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// ROOT 始终指向项目根目录（scripts/ 的上一级）
const ROOT = process.env.AGENTFLOW_ROOT ?? path.resolve(__dirname, "..");

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

function loadConfig() {
  const raw = fs.readFileSync(path.join(ROOT, "config/agents.json"), "utf-8");
  // 替换 ${ENV_VAR} 占位符
  const resolved = raw.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? "");
  return JSON.parse(resolved);
}

function logEvent(type, data) {
  const workspace = process.env.AGENTFLOW_WORKSPACE ?? "/tmp/agentflow";
  fs.mkdirSync(workspace, { recursive: true });
  const logLine = JSON.stringify({ ts: new Date().toISOString(), type, ...data }) + "\n";
  fs.appendFileSync(path.join(workspace, "events.jsonl"), logLine);
  console.log(`[${new Date().toISOString()}] ${type}`, data);
}

// ──────────────────────────────────────────────
// 推送函数
// ──────────────────────────────────────────────

function dingSignature(secret, timestamp) {
  const str = `${timestamp}\n${secret}`;
  return encodeURIComponent(
    crypto.createHmac("sha256", secret).update(str).digest("base64")
  );
}

async function pushDingtalk(webhookUrl, secret, title, content) {
  if (!webhookUrl) return { skipped: true, reason: "no webhook url" };

  let url = webhookUrl;
  if (secret) {
    const ts = Date.now();
    url += `&timestamp=${ts}&sign=${dingSignature(secret, ts)}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msgtype: "markdown",
      markdown: { title, text: content },
      at: { isAtAll: false },
    }),
  });
  const data = await res.json();
  return data.errcode === 0
    ? { success: true }
    : { success: false, error: data.errmsg };
}

async function pushFeishu(webhookUrl, title, content, atUsers = []) {
  if (!webhookUrl) return { skipped: true, reason: "no webhook url" };

  // 构建 @ 用户段落（飞书卡片 lark_md 格式）
  let atSection = "";
  if (atUsers.length > 0) {
    atSection = "\n\n" + atUsers.map(u => `<at id=${u.feishu_id}>${u.name}</at>`).join(" ");
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msg_type: "interactive",
      card: {
        header: { title: { tag: "plain_text", content: title }, template: "blue" },
        elements: [{ tag: "div", text: { tag: "lark_md", content: content + atSection } }],
      },
    }),
  });
  const data = await res.json();
  return data.code === 0 ? { success: true } : { success: false, error: data.msg };
}

/** 回复到触发消息的会话（sessionWebhook） */
async function replyToSession(sessionWebhook, content) {
  if (!sessionWebhook) return;
  // sessionWebhook 在 30 分钟内有效
  try {
    await fetch(sessionWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msgtype: "markdown",
        markdown: { title: "AgentFlow", text: content },
      }),
    });
  } catch (e) {
    console.warn("sessionWebhook 回复失败:", e.message);
  }
}

// ──────────────────────────────────────────────
// 核心：识别机器人 + 检测关键词 + 推送
// ──────────────────────────────────────────────

function detectCompletedAgent(messageText, config) {
  const text = messageText.toLowerCase();

  // 1. 先找关键词
  const hasKeyword = config.completion_keywords.some((kw) =>
    text.includes(kw.toLowerCase())
  );
  if (!hasKeyword) return null;

  // 2. 找消息中提到的机器人名
  for (const agent of config.agents) {
    const botName = agent.bot_name ?? agent.name;
    if (text.includes(botName.toLowerCase())) {
      return agent;
    }
  }

  return null; // 有关键词但没识别到具体 agent
}

async function handleTaskCompletion({ agent, senderNick, messageText, sessionWebhook, config }) {
  const now = new Date();
  const timestamp = now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const summary = messageText.slice(0, 80) + (messageText.length > 80 ? "…" : "");

  // 下游 agent 列表
  const downstreamIds = agent.notifies ?? [];
  const downstreamAgents = downstreamIds
    .map((id) => config.agents.find((a) => a.id === id))
    .filter(Boolean);
  const downstreamNames = downstreamAgents.map((a) => a.name).join("、") || "无";

  // ── 1. 推送调度群（PM Webhook）──
  const schedulingMsg = [
    `## ✅ 任务流转通知`,
    `**来源 Agent**：${agent.name}`,
    `**${agent.task_label}** 已完成`,
    `**触发人**：${senderNick}`,
    `**时间**：${timestamp}`,
    `**摘要**：${summary}`,
    ``,
    `➡️ **已通知下游**：${downstreamNames}`,
  ].join("\n");

  const schedulingWebhook = process.env.DINGTALK_WEBHOOK_PM;
  const schedulingResult = await pushDingtalk(
    schedulingWebhook,
    process.env.DINGTALK_WEBHOOK_PM_SECRET,
    `任务流转 | ${agent.name}`,
    schedulingMsg
  );

  // ── 2. 推送下游通知：统一走飞书群，@到负责人 + 铁丁群备份 ──
  const downstreamResults = [];

  // 2a. 汇总飞书群消息：一条卡片 @所有下游负责人
  const feishuWebhook = process.env.FEISHU_WEBHOOK_URL;
  if (feishuWebhook && downstreamAgents.length > 0) {
    const atUsers = downstreamAgents
      .filter(d => d.owner?.feishu_id && !d.owner.feishu_id.startsWith("__"))
      .map(d => ({ feishu_id: d.owner.feishu_id, name: d.owner.name }));

    const taskLines = downstreamAgents.map(d => {
      const ownerTag = d.owner?.feishu_id && !d.owner.feishu_id.startsWith("__")
        ? `<at id=${d.owner.feishu_id}>${d.owner.name}</at>`
        : d.name;
      return `• **${d.task_label}** → ${ownerTag}`;
    }).join("\n");

    const feishuMsg = [
      `**来自**：${agent.name}（${agent.task_label}）`,
      `**触发人**：${senderNick}`,
      `**时间**：${timestamp}`,
      ``,
      `> ${summary}`,
      ``,
      `**下游任务分配：**`,
      taskLines,
      ``,
      `请各位负责人确认并推进。`,
    ].join("\n");

    const feishuResult = await pushFeishu(
      feishuWebhook,
      `✅ 任务流转 | ${agent.name} → ${downstreamNames}`,
      feishuMsg,
      atUsers
    );
    downstreamResults.push({ target: "feishu-group", ...feishuResult });
  }

  // 2b. 铁丁群下游通知（备份，仅推铁丁渠道的 agent）
  for (const downstream of downstreamAgents.filter(d => d.channel === "dingtalk")) {
    const instructionMsg = [
      `## 📨 上游任务完成通知`,
      `**来自**：${agent.name}（${agent.task_label}）`,
      `**触发人**：${senderNick}`,
      `**时间**：${timestamp}`,
      ``,
      `> ${summary}`,
      ``,
      `@${downstream.bot_name ?? downstream.name} 请根据以上信息推进你的相关任务。`,
    ].join("\n");

    const result = await pushDingtalk(
      downstream.group_webhook,
      process.env.DINGTALK_WEBHOOK_PM_SECRET,
      `来自 ${agent.name} 的任务通知`,
      instructionMsg
    );
    downstreamResults.push({ agentId: downstream.id, channel: "dingtalk", ...result });
  }

  // ── 3. 回复到原群的会话（确认已处理）──
  await replyToSession(
    sessionWebhook,
    `✅ **AgentFlow 已接收**\n任务流转完成：${agent.name} → ${downstreamNames}\n调度群已通知。`
  );

  logEvent("TASK_COMPLETED", {
    agent: agent.id,
    sender: senderNick,
    downstream: downstreamIds,
    scheduling: schedulingResult,
    downstreamResults,
  });

  return { agent: agent.id, downstreamResults };
}

// ──────────────────────────────────────────────
// Express Server
// ──────────────────────────────────────────────

loadEnv();
const app = express();
app.use(express.json());

/** 健康检查 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    port: PORT,
  });
});

/**
 * 钉钉 Outgoing Webhook 接收端点
 *
 * 钉钉配置步骤：
 *   1. 打开 https://open.dingtalk.com → 你的机器人应用
 *   2. 消息接收模式 → 选"HTTP模式"
 *   3. 消息接收地址填：http://你的IP:3456/webhook/dingtalk
 *   4. 保存后，群里 @机器人的消息会同时 POST 到此地址
 */
app.post("/webhook/dingtalk", async (req, res) => {
  // 立刻返回 200，避免钉钉超时重试
  res.json({ success: true });

  const body = req.body;
  const messageText = body?.text?.content ?? body?.content?.text ?? "";
  const senderNick = body?.senderNick ?? "未知";
  const sessionWebhook = body?.sessionWebhook ?? null;
  const robotName = body?.robotName ?? "";

  logEvent("INCOMING_DINGTALK", {
    sender: senderNick,
    robotName,
    textPreview: messageText.slice(0, 60),
  });

  try {
    const config = loadConfig();
    // 优先用 robotName 匹配，再用消息内容匹配
    let agent = config.agents.find(
      (a) => a.channel === "dingtalk" && (a.bot_name === robotName || a.name === robotName)
    );
    if (!agent) {
      agent = detectCompletedAgent(messageText, config);
    }

    if (!agent) {
      // 没有识别到 agent，检测是否有完成关键词
      const hasKeyword = config.completion_keywords.some((kw) =>
        messageText.toLowerCase().includes(kw.toLowerCase())
      );
      if (hasKeyword) {
        // 有关键词但不知道是哪个 agent → 推调度群提示人工确认
        await pushDingtalk(
          process.env.DINGTALK_WEBHOOK_PM,
          process.env.DINGTALK_WEBHOOK_PM_SECRET,
          "AgentFlow | 需人工确认",
          `⚠️ 检测到完成关键词，但未识别对应 Agent\n**发言人**：${senderNick}\n**内容**：${messageText.slice(0, 100)}\n\n请人工确认并在消息中包含机器人名称。`
        );
      }
      return;
    }

    // 检测完成关键词
    const hasKeyword = config.completion_keywords.some((kw) =>
      messageText.toLowerCase().includes(kw.toLowerCase())
    );

    if (hasKeyword) {
      await handleTaskCompletion({
        agent,
        senderNick,
        messageText: messageText.trim(),
        sessionWebhook,
        config,
      });
    }
  } catch (err) {
    console.error("处理 Webhook 出错:", err);
    logEvent("ERROR", { error: err.message });
  }
});

/**
 * 飞书 Outgoing Webhook 接收端点
 * 飞书配置：应用管理 → 事件订阅 → 填入 http://你的IP:3456/webhook/feishu
 */
app.post("/webhook/feishu", async (req, res) => {
  // 飞书需要先完成 URL 验证
  if (req.body?.type === "url_verification") {
    return res.json({ challenge: req.body.challenge });
  }

  res.json({ success: true });

  const event = req.body?.event;
  const messageText = event?.message?.content
    ? JSON.parse(event.message.content)?.text ?? ""
    : "";
  const senderName = event?.sender?.sender_id?.open_id ?? "未知";

  logEvent("INCOMING_FEISHU", {
    sender: senderName,
    textPreview: messageText.slice(0, 60),
  });

  try {
    const config = loadConfig();
    const agent = config.agents.find((a) => a.channel === "feishu" &&
      messageText.includes(a.bot_name ?? a.name)
    );
    if (!agent) return;

    const hasKeyword = config.completion_keywords.some((kw) =>
      messageText.toLowerCase().includes(kw.toLowerCase())
    );

    if (hasKeyword) {
      await handleTaskCompletion({
        agent,
        senderNick: senderName,
        messageText: messageText.trim(),
        sessionWebhook: null,
        config,
      });
    }
  } catch (err) {
    console.error("处理飞书 Webhook 出错:", err);
  }
});

/**
 * 手动触发接口（测试用 / 方案2兜底）
 * POST /trigger { "agentId": "main", "sender": "手动触发", "message": "任务完成" }
 */
app.post("/trigger", async (req, res) => {
  const { agentId, sender = "手动触发", message = "任务完成" } = req.body ?? {};
  const config = loadConfig();
  const agent = config.agents.find((a) => a.id === agentId);
  if (!agent) return res.status(404).json({ error: `未找到 Agent: ${agentId}` });

  const result = await handleTaskCompletion({
    agent,
    senderNick: sender,
    messageText: message,
    sessionWebhook: null,
    config,
  });
  res.json(result);
});

const PORT = process.env.AGENTFLOW_SERVER_PORT ?? 3456;
app.listen(PORT, () => {
  console.log(`\n🚀 AgentFlow Server 已启动`);
  console.log(`   健康检查:     http://localhost:${PORT}/health`);
  console.log(`   钉钉 Webhook: http://YOUR_IP:${PORT}/webhook/dingtalk`);
  console.log(`   飞书 Webhook: http://YOUR_IP:${PORT}/webhook/feishu`);
  console.log(`   手动触发:     POST http://localhost:${PORT}/trigger`);
  console.log(`\n   监听关键词: 完成 / DONE / ✅ / 已完成 / 任务完成`);
  console.log(`   日志文件:   ${process.env.AGENTFLOW_WORKSPACE ?? "/tmp/agentflow"}/events.jsonl\n`);
});
