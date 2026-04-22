#!/usr/bin/env node
/**
 * AgentFlow 通知推送 MCP Server v2
 *
 * 新增能力：
 * - 从 agents.json 读取多 Agent 配置，自动路由
 * - A2A（Agent-to-Agent）通知：上下游自动串联
 * - OpenClaw 大模型调用（Claude / Gemini / Qwen 统一入口）
 * - 主动报告生成：调用 LLM 生成摘要后推送
 * - 钉钉 / 飞书 双通道（Webhook + 应用机器人）
 *
 * 启动：node mcp-servers/notify/server.js
 * 环境变量：见 .env 文件
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// ──────────────────────────────────────────────
// 加载配置
// ──────────────────────────────────────────────

function loadAgentsConfig() {
  const configPath = path.join(ROOT, "config/agents.json");
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return { agents: [], notification_rules: [] };
  }
}

function resolveEnv(key) {
  return process.env[key] ?? "";
}

function getAgentCredentials(agent) {
  if (agent.channel === "dingtalk") {
    return {
      clientId: resolveEnv(agent.env.clientId),
      clientSecret: resolveEnv(agent.env.clientSecret),
      model: resolveEnv(agent.env.model) || "claude-sonnet-4-6",
    };
  } else {
    return {
      appId: resolveEnv(agent.env.appId),
      appSecret: resolveEnv(agent.env.appSecret),
      model: resolveEnv(agent.env.model) || "claude-sonnet-4-6",
    };
  }
}

// ──────────────────────────────────────────────
// LLM 调用层：三级路由
//
// 优先级：
//   1. ANTHROPIC_BASE_URL 已设置 → DashScope Anthropic 兼容接口（主后端）
//      使用 ANTHROPIC_AUTH_TOKEN 鉴权，模型默认 ANTHROPIC_MODEL
//   2. gemini-* → openclaw 网关
//   3. 其他（无 ANTHROPIC_BASE_URL）→ openclaw 网关
// ──────────────────────────────────────────────

/**
 * DashScope Anthropic 兼容接口
 * Base URL: ANTHROPIC_BASE_URL  (https://coding.dashscope.aliyuncs.com/apps/anthropic)
 * Auth:     Authorization: Bearer ANTHROPIC_AUTH_TOKEN
 * 接口格式与 Anthropic Messages API 相同
 */
async function callDashScope({ model, systemPrompt, userPrompt }) {
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  const token = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!baseUrl || !token) throw new Error("缺少 ANTHROPIC_BASE_URL 或 ANTHROPIC_AUTH_TOKEN");

  // 若调用方未指定模型，使用环境变量默认值
  const resolvedModel = model || process.env.ANTHROPIC_MODEL || "qwen3.6-plus";

  const body = {
    model: resolvedModel,
    max_tokens: 2048,
    messages: [{ role: "user", content: userPrompt }],
    ...(systemPrompt ? { system: systemPrompt } : {}),
  };

  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DashScope API 错误 ${res.status}: ${err}`);
  }

  const data = await res.json();
  // DashScope 返回 content 数组：thinking 块在前，text 块在后
  const textBlock = data.content?.find((c) => c.type === "text");
  return textBlock?.text ?? "";
}

/**
 * OpenClaw 网关（兼容 OpenAI Chat Completions 格式）
 * 用于 gemini-* / qwen* 等 DashScope 不支持的模型
 */
async function callOpenClawGateway({ model, systemPrompt, userPrompt }) {
  const baseUrl = process.env.OPENCLAW_BASE_URL ?? "https://api.openclaw.ai/v1";
  const apiKey = process.env.OPENCLAW_API_KEY;
  if (!apiKey) throw new Error("缺少 OPENCLAW_API_KEY 环境变量");

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
        { role: "user", content: userPrompt },
      ],
      max_tokens: 2048,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenClaw API 错误 ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * 统一 LLM 入口
 *
 * gemini-* 模型          → openclaw 网关
 * 其他模型且有 ANTHROPIC_BASE_URL → DashScope Anthropic 兼容接口（主后端）
 * 其他                   → openclaw 网关（兜底）
 */
async function callOpenClaw({ model, systemPrompt, userPrompt }) {
  const isGemini = (model ?? "").startsWith("gemini-");

  if (!isGemini && process.env.ANTHROPIC_BASE_URL && process.env.ANTHROPIC_AUTH_TOKEN) {
    return callDashScope({ model, systemPrompt, userPrompt });
  }
  return callOpenClawGateway({ model, systemPrompt, userPrompt });
}

// ──────────────────────────────────────────────
// 钉钉工具函数
// ──────────────────────────────────────────────

function dingSignature(secret, timestamp) {
  const str = `${timestamp}\n${secret}`;
  return encodeURIComponent(
    crypto.createHmac("sha256", secret).update(str).digest("base64")
  );
}

async function sendDingtalkWebhook({ webhookUrl, secret, title, content, atAll = false, mentionUserids = [] }) {
  let url = webhookUrl;
  if (secret) {
    const ts = Date.now();
    url += `&timestamp=${ts}&sign=${dingSignature(secret, ts)}`;
  }
  const hasMentions = mentionUserids.length > 0;
  const body = {
    msgtype: "markdown",
    markdown: { title, text: content },
    at: { isAtAll: atAll || !hasMentions },
  };
  if (hasMentions) {
    body.at.atUserIds = mentionUserids;
    // 在正文中追加 @ 标记文本以确保钉钉正确触发提醒
    const mentionText = mentionUserids.map((uid) => `@${uid}`).join(" ");
    body.markdown.text = `${mentionText}\n\n${content}`;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(`钉钉 Webhook 错误: ${data.errmsg}`);
  return { success: true, channel: "dingtalk-webhook" };
}

async function getDingtalkToken(clientId, clientSecret) {
  const res = await fetch(
    `https://oapi.dingtalk.com/gettoken?appkey=${clientId}&appsecret=${clientSecret}`
  );
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(`获取钉钉 token 失败: ${data.errmsg}`);
  return data.access_token;
}

async function sendDingtalkAppNotify({ clientId, clientSecret, agentId, userids, title, content }) {
  const token = await getDingtalkToken(clientId, clientSecret);
  const res = await fetch(
    `https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: agentId,
        userid_list: userids.join(","),
        msg: { msgtype: "markdown", markdown: { title, text: content } },
      }),
    }
  );
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(`钉钉应用通知错误: ${data.errmsg}`);
  return { success: true, channel: "dingtalk-app", task_id: data.task_id };
}

// ──────────────────────────────────────────────
// 飞书工具函数
// ──────────────────────────────────────────────

async function getFeishuToken(appId, appSecret) {
  const res = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    }
  );
  const data = await res.json();
  if (data.code !== 0) throw new Error(`获取飞书 token 失败: ${data.msg}`);
  return data.tenant_access_token;
}

async function sendFeishuWebhook({ webhookUrl, title, content, mentionOpenIds = [] }) {
  const hasMentions = mentionOpenIds.length > 0;
  let cardContent = content;
  const atField = {};
  if (hasMentions) {
    // 在飞书富文本中，<at id='xxx'></at> 是 @mention 语法
    const mentionTags = mentionOpenIds.map((id) => `<at id='${id}'></at>`).join(" ");
    cardContent = `${mentionTags}\n\n${content}`;
    atField.at = { open_id: mentionOpenIds };
  }
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msg_type: "interactive",
      card: {
        header: { title: { tag: "plain_text", content: title }, template: "blue" },
        elements: [{ tag: "div", text: { tag: "lark_md", content: cardContent } }],
        ...atField,
      },
    }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`飞书 Webhook 错误: ${data.msg}`);
  return { success: true, channel: "feishu-webhook" };
}

async function sendFeishuAppMessage({ appId, appSecret, openId, title, content }) {
  const token = await getFeishuToken(appId, appSecret);
  const res = await fetch(
    "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: openId,
        msg_type: "interactive",
        content: JSON.stringify({
          header: { title: { tag: "plain_text", content: title }, template: "orange" },
          elements: [{ tag: "div", text: { tag: "lark_md", content } }],
        }),
      }),
    }
  );
  const data = await res.json();
  if (data.code !== 0) throw new Error(`飞书应用消息错误: ${data.msg}`);
  return { success: true, channel: "feishu-app", message_id: data.data?.message_id };
}

// ──────────────────────────────────────────────
// 核心：向指定 Agent 发消息（自动选择渠道）
// ──────────────────────────────────────────────

async function notifyAgent({ agentId, title, content, openIdOrUserid = null, mentionUserids = [], mentionOpenIds = [], isAtAll = false }) {
  const config = loadAgentsConfig();
  const agent = config.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`未找到 Agent: ${agentId}`);

  const creds = getAgentCredentials(agent);
  const results = [];

  // ── 第一层：群 Webhook 通知（重要节点，全员可见，双群同步）──

  // 1a. 钉钉群（总是推送，不论 agent 渠道）
  const dingWebhookUrl = process.env.DINGTALK_WEBHOOK_PM;
  if (dingWebhookUrl) {
    try {
      const r = await sendDingtalkWebhook({
        webhookUrl: dingWebhookUrl,
        secret: process.env.DINGTALK_SECRET,
        title,
        content,
        atAll: isAtAll,
        mentionUserids,
      });
      results.push(r);
    } catch (err) {
      results.push({ success: false, channel: "dingtalk-webhook", error: err.message });
    }
  }

  // 1b. 飞书群（总是推送，双群同步）
  const feiWebhookUrl = process.env.FEISHU_WEBHOOK_URL;
  if (feiWebhookUrl) {
    try {
      const r = await sendFeishuWebhook({
        webhookUrl: feiWebhookUrl,
        title,
        content,
        mentionOpenIds,
      });
      results.push(r);
    } catch (err) {
      results.push({ success: false, channel: "feishu-webhook", error: err.message });
    }
  }

  // ── 第二层：应用机器人单独通知（如有配置 + 指定了接收人）──
  if (agent.channel === "dingtalk") {
    if (creds.clientId && creds.clientSecret && openIdOrUserid) {
      try {
        const r = await sendDingtalkAppNotify({
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
          agentId: process.env.DINGTALK_AGENT_ID,
          userids: [openIdOrUserid],
          title,
          content,
        });
        results.push(r);
      } catch (err) {
        results.push({ success: false, channel: "dingtalk-app", error: err.message });
      }
    }
  } else {
    if (creds.appId && creds.appSecret && openIdOrUserid) {
      try {
        const r = await sendFeishuAppMessage({
          appId: creds.appId,
          appSecret: creds.appSecret,
          openId: openIdOrUserid,
          title,
          content,
        });
        results.push(r);
      } catch (err) {
        results.push({ success: false, channel: "feishu-app", error: err.message });
      }
    }
  }

  // 如果两层都没发成功，报错
  if (results.length === 0) {
    const fallbackUrl = agent.channel === "dingtalk" ? "DINGTALK_WEBHOOK_PM" : "FEISHU_WEBHOOK_URL";
    throw new Error(`未配置任何通知渠道，请设置 ${fallbackUrl}`);
  }

  return { agentId, channels: results };
}

// ──────────────────────────────────────────────
// A2A 通知：向下游 Agent 广播事件
// ──────────────────────────────────────────────

async function notifyDownstream({ sourceAgentId, event, title, content }) {
  const config = loadAgentsConfig();
  const agent = config.agents.find((a) => a.id === sourceAgentId);
  if (!agent) throw new Error(`未找到源 Agent: ${sourceAgentId}`);

  const targets = agent.notifies ?? [];
  const results = [];

  for (const targetId of targets) {
    const targetAgent = config.agents.find((a) => a.id === targetId);
    if (!targetAgent) {
      results.push({ agentId: targetId, success: false, error: "Agent 未找到" });
      continue;
    }

    // 自动提取下游 agent 的 @mention 信息
    const owner = targetAgent.owner || {};
    const mentionUserids = [];
    const mentionOpenIds = [];

    if (owner.dingtalk_userid) mentionUserids.push(owner.dingtalk_userid);
    if (owner.feishu_id && owner.feishu_id.startsWith("ou_")) mentionOpenIds.push(owner.feishu_id);

    // 在正文中追加 @负责人名称 提示（即使没有 ID 也能知道谁负责）
    const enrichedContent = owner.name
      ? `${content}\n\n> 📌 负责人：${owner.name}`
      : content;

    try {
      const result = await notifyAgent({
        agentId: targetId,
        title,
        content: enrichedContent,
        mentionUserids,
        mentionOpenIds,
      });
      results.push({ agentId: targetId, ...result });
    } catch (err) {
      results.push({ agentId: targetId, success: false, error: err.message });
    }
  }

  return { event, source: sourceAgentId, notified: results };
}

// ──────────────────────────────────────────────
// 主动报告生成：LLM 生成 + 推送
// ──────────────────────────────────────────────

async function generateAndPushReport({ agentId, reportType, contextData }) {
  const config = loadAgentsConfig();
  const agent = config.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`未找到 Agent: ${agentId}`);

  const creds = getAgentCredentials(agent);

  const systemPrompt = `你是 ${agent.name}，职责：${agent.description}。
请根据输入数据生成简洁的 Markdown 格式报告，适合在钉钉/飞书群中展示。
报告包含：摘要、关键指标、风险点（如有）、建议行动项。`;

  const userPrompt = `报告类型：${reportType}\n\n输入数据：\n${JSON.stringify(contextData, null, 2)}`;

  // 调用 OpenClaw 生成报告
  const reportContent = await callOpenClaw({
    model: creds.model,
    systemPrompt,
    userPrompt,
  });

  const title = `${agent.name} - ${reportType}`;

  // 推送到对应渠道
  const pushResult = await notifyAgent({ agentId, title, content: reportContent });

  // 同时通知下游
  const downstreamResult = await notifyDownstream({
    sourceAgentId: agentId,
    event: "report_generated",
    title: `[转发] ${title}`,
    content: reportContent,
  });

  return { generated: true, title, push: pushResult, downstream: downstreamResult };
}

// ──────────────────────────────────────────────
// Excel 里程碑解析
// ──────────────────────────────────────────────

/**
 * 解析 Excel 文件中的里程碑/任务数据
 * 支持的列名（模糊匹配）：任务名称、负责人/部门、开始日期、截止日期、依赖关系、预计天数
 *
 * @param {string} filePath - Excel 文件路径
 * @param {string} base64Content - 或 Base64 编码的 Excel 内容
 * @returns {Array} 标准化任务队列
 */
function parseExcelMilestones({ filePath, base64Content = null }) {
  let workbook;
  if (base64Content) {
    const buffer = Buffer.from(base64Content, "base64");
    workbook = XLSX.read(buffer, { type: "buffer" });
  } else if (filePath) {
    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(ROOT, filePath);
    workbook = XLSX.readFile(resolvedPath);
  } else {
    throw new Error("必须提供 filePath 或 base64Content 参数");
  }

  // 读取第一个 sheet
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Excel 文件中没有工作表");

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
  if (rows.length === 0) throw new Error("Excel 文件中没有数据行");

  // 列名映射：模糊匹配常见中文列名
  const headerRow = Object.keys(rows[0]);
  const colMap = {};
  for (const h of headerRow) {
    const normalized = h.toLowerCase().trim();
    if (/任务|名称|标题|事项|milestone|task/.test(normalized)) colMap.taskName = h;
    else if (/负责|部门|部门\/负责人|owner|assignee|执行/.test(normalized)) colMap.assignee = h;
    else if (/开始|start/.test(normalized)) colMap.startDate = h;
    else if (/截止|到期|结束|due|deadline|完成日期/.test(normalized)) colMap.dueDate = h;
    else if (/依赖|前置|precede|depend|前置任务/.test(normalized)) colMap.dependencies = h;
    else if (/预计天数|天数|工期|days|duration|estimated/.test(normalized)) colMap.estimatedDays = h;
    else if (/状态|status|进度|progress/.test(normalized)) colMap.status = h;
    else if (/优先级|priority|重要/.test(normalized)) colMap.priority = h;
  }

  const tasks = rows.map((row, index) => {
    const task = {
      id: `task_${index + 1}`,
      title: row[colMap.taskName] || `未命名任务-${index + 1}`,
      assignee: row[colMap.assignee] || "",
      startDate: colMap.startDate ? normalizeDate(row[colMap.startDate]) : "",
      dueDate: colMap.dueDate ? normalizeDate(row[colMap.dueDate]) : "",
      dependencies: parseDependencies(colMap.dependencies ? row[colMap.dependencies] : ""),
      estimatedDays: colMap.estimatedDays ? parseNumber(row[colMap.estimatedDays]) : null,
      status: colMap.status ? String(row[colMap.status]).trim() : "not_started",
      priority: colMap.priority ? String(row[colMap.priority]).trim() : "normal",
    };
    return task;
  });

  return {
    success: true,
    sheet: sheetName,
    totalTasks: tasks.length,
    tasks,
  };
}

/**
 * 将 Excel 日期值标准化为 ISO 字符串
 */
function normalizeDate(value) {
  if (!value) return "";
  if (typeof value === "number") {
    // Excel serial date → JS Date
    const date = new Date((value - 25569) * 86400 * 1000);
    return date.toISOString().split("T")[0];
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value).trim();
  return d.toISOString().split("T")[0];
}

/**
 * 解析依赖关系字符串（如 "task_1, task_2" 或 "任务1; 任务2"）
 */
function parseDependencies(value) {
  if (!value || typeof value !== "string") return [];
  return value
    .split(/[，,;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 将字符串安全解析为数字
 */
function parseNumber(value) {
  const n = Number(value);
  return isNaN(n) ? null : n;
}

// ──────────────────────────────────────────────
// 任务状态变更通知
// ──────────────────────────────────────────────

/**
 * 任务开始/结束时，向负责部门发送 @mention 通知
 */
async function announceTaskTransition({
  eventType,
  agentId,
  taskTitle,
  dueDate,
  estimatedDays,
  dependencies = [],
  mentionUserids = [],
  mentionOpenIds = [],
}) {
  const config = loadAgentsConfig();
  const agent = config.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`未找到 Agent: ${agentId}`);

  // 计算截止日期
  let displayDueDate = dueDate;
  if (!displayDueDate && estimatedDays) {
    const d = new Date();
    d.setDate(d.getDate() + estimatedDays);
    displayDueDate = d.toISOString().split("T")[0];
  }

  const isStart = eventType === "task_start";
  const icon = isStart ? "🚀" : "✅";
  const verb = isStart ? "已开始" : "已完成";

  let content = `## ${icon} **${taskTitle}** ${verb}\n\n`;
  if (isStart) {
    content += `**截止日期**：${displayDueDate || "待定"}\n\n`;
    if (dependencies.length > 0) {
      content += `**前置依赖**：${dependencies.join("、")}\n\n`;
    }
    content += `请相关同学关注任务进展，确保按期交付。`;
  } else {
    content += `**完成时间**：${new Date().toISOString().split("T")[0]}\n\n`;
    content += `下游环节可以开始准备了。`;
  }

  // 根据 Agent 渠道发送通知 — 两层：群 Webhook + 应用机器人
  const creds = getAgentCredentials(agent);
  const title = `${agent.name} - ${taskTitle}`;
  const results = [];

  if (agent.channel === "dingtalk") {
    // 第一层：群 Webhook @mention
    const webhookUrl = process.env.DINGTALK_WEBHOOK_PM;
    if (webhookUrl) {
      try {
        const r = await sendDingtalkWebhook({
          webhookUrl,
          secret: process.env.DINGTALK_SECRET,
          title,
          content,
          mentionUserids,
        });
        results.push(r);
      } catch (err) {
        results.push({ success: false, channel: "dingtalk-webhook", error: err.message });
      }
    }
    // 第二层：应用机器人（如有配置）
    if (creds.clientId && creds.clientSecret) {
      try {
        const r = await sendDingtalkAppNotify({
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
          agentId: process.env.DINGTALK_AGENT_ID,
          userids: mentionUserids.length > 0 ? mentionUserids : ["all"],
          title,
          content,
        });
        results.push(r);
      } catch (err) {
        results.push({ success: false, channel: "dingtalk-app", error: err.message });
      }
    }
  } else {
    // 飞书
    // 第一层：群 Webhook
    const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        const r = await sendFeishuWebhook({
          webhookUrl,
          title,
          content,
          mentionOpenIds,
        });
        results.push(r);
      } catch (err) {
        results.push({ success: false, channel: "feishu-webhook", error: err.message });
      }
    }
    // 第二层：应用机器人（如有配置）
    if (creds.appId && creds.appSecret) {
      try {
        const r = await sendFeishuAppMessage({
          appId: creds.appId,
          appSecret: creds.appSecret,
          openId: mentionOpenIds[0] || "",
          title,
          content,
        });
        results.push(r);
      } catch (err) {
        results.push({ success: false, channel: "feishu-app", error: err.message });
      }
    }
  }

  if (results.length === 0) {
    const fallback = agent.channel === "dingtalk" ? "DINGTALK_WEBHOOK_PM" : "FEISHU_WEBHOOK_URL";
    throw new Error(`未配置任何通知渠道，请设置 ${fallback}`);
  }

  return { channels: results };
}

// ──────────────────────────────────────────────
// 项目启动编排：从 Excel 里程碑启动全流程
// ──────────────────────────────────────────────

/**
 * 从 Excel 里程碑文件启动整个项目流程
 * 解析任务 → 排序依赖 → 通知第一个环节开始
 */
async function startProjectFromMilestones({
  filePath,
  base64Content = null,
  projectName = "未命名项目",
}) {
  // 1. 解析 Excel
  const parsed = parseExcelMilestones({ filePath, base64Content });

  // 2. 根据依赖关系排序（拓扑排序简化版）
  const sorted = topologicalSort(parsed.tasks);

  // 3. 找到无依赖的起始任务
  const rootTasks = sorted.filter((t) => t.dependencies.length === 0);

  // 4. 为每个起始任务触发通知
  const notifications = [];
  for (const task of rootTasks) {
    const agentId = resolveAgentForTask(task);
    try {
      const result = await announceTaskTransition({
        eventType: "task_start",
        agentId,
        taskTitle: task.title,
        dueDate: task.dueDate,
        estimatedDays: task.estimatedDays,
        dependencies: task.dependencies,
      });
      notifications.push({ taskId: task.id, agentId, ...result });
    } catch (err) {
      notifications.push({ taskId: task.id, agentId, success: false, error: err.message });
    }
  }

  return {
    success: true,
    projectName,
    totalTasks: sorted.length,
    startedTasks: rootTasks.length,
    taskQueue: sorted,
    notifications,
  };
}

/**
 * 简化拓扑排序：按依赖关系排序任务
 */
function topologicalSort(tasks) {
  const taskMap = new Map();
  for (const t of tasks) taskMap.set(t.title, t);

  const visited = new Set();
  const result = [];

  function visit(task) {
    if (visited.has(task.id)) return;
    visited.add(task.id);
    for (const depTitle of task.dependencies) {
      const dep = taskMap.get(depTitle) || tasks.find((t) => t.title.includes(depTitle));
      if (dep) visit(dep);
    }
    result.push(task);
  }

  for (const task of tasks) visit(task);
  return result;
}

/**
 * 根据任务的 assignee 字段匹配对应的 Agent ID
 * 模糊匹配任务标签和名称
 */
function resolveAgentForTask(task) {
  const config = loadAgentsConfig();
  const assignee = (task.assignee || "").toLowerCase().trim();
  const title = (task.title || "").toLowerCase();

  // 先按 assignee 精确匹配
  for (const agent of config.agents) {
    const label = (agent.task_label || "").toLowerCase();
    const name = (agent.name || "").toLowerCase();
    if (assignee.includes(label) || label.includes(assignee)) return agent.id;
    if (assignee.includes(name) || name.includes(assignee)) return agent.id;
  }

  // 按关键词匹配
  const keywords = {
    main: ["研发", "开发", "技术", "代码", "backend", "frontend"],
    productmanager: ["产品", "需求", "PRD", "product"],
    tester: ["测试", "QA", "质量", "test"],
    sales: ["销售", "市场", "sales", "market"],
    hr: ["HR", "人力", "招聘", "人事"],
    aftersale: ["售后", "技术支持", "客服"],
    dataanalyst: ["数据", "分析", "报表", "data"],
  };

  for (const [agentId, words] of Object.entries(keywords)) {
    for (const word of words) {
      if (title.includes(word) || assignee.includes(word)) return agentId;
    }
  }

  // 默认回退到 PM
  return "productmanager";
}

// ──────────────────────────────────────────────
// MCP Server 定义
// ──────────────────────────────────────────────

const server = new Server(
  { name: "agentflow-notify-v2", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "notify_agent",
      description: "向指定 Agent 发送通知（自动选择钉钉/飞书渠道，支持 Webhook 和应用机器人，支持 @mention）",
      inputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "目标 Agent ID（见 config/agents.json）" },
          title: { type: "string", description: "消息标题" },
          content: { type: "string", description: "Markdown 格式正文" },
          openIdOrUserid: { type: "string", description: "指定人员的 open_id（飞书）或 userid（钉钉），留空则发群通知" },
          mentionUserids: { type: "array", items: { type: "string" }, description: "钉钉群 @mention 多人 userid 列表" },
          mentionOpenIds: { type: "array", items: { type: "string" }, description: "飞书群 @mention 多人 open_id 列表" },
          isAtAll: { type: "boolean", description: "是否 @所有人" },
        },
        required: ["agentId", "title", "content"],
      },
    },
    {
      name: "notify_downstream",
      description: "A2A 通知：某 Agent 完成工作后，自动向其配置的所有下游 Agent 广播事件",
      inputSchema: {
        type: "object",
        properties: {
          sourceAgentId: { type: "string", description: "发起通知的源 Agent ID" },
          event: { type: "string", description: "事件名称，如 task_completed / risk_detected" },
          title: { type: "string", description: "通知标题" },
          content: { type: "string", description: "通知内容（Markdown）" },
        },
        required: ["sourceAgentId", "event", "title", "content"],
      },
    },
    {
      name: "generate_and_push_report",
      description: "调用 OpenClaw 大模型生成报告，推送到 Agent 渠道，并自动通知下游",
      inputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "发起报告的 Agent ID（决定用哪个模型和推送渠道）" },
          reportType: { type: "string", description: "报告类型，如：日报、风险摘要、里程碑进展、BOM状态" },
          contextData: { type: "object", description: "报告所需的上下文数据（JSON对象）" },
        },
        required: ["agentId", "reportType", "contextData"],
      },
    },
    {
      name: "broadcast_to_all",
      description: "向所有已配置 Agent 的渠道广播紧急通知（如系统告警、里程碑冻结等）",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "广播标题" },
          content: { type: "string", description: "广播内容（Markdown）" },
          severity: { type: "string", enum: ["info", "warning", "critical"], description: "严重级别" },
        },
        required: ["title", "content"],
      },
    },
    {
      name: "call_openclaw",
      description: "直接调用 OpenClaw 大模型 API（支持 Claude / Gemini / Qwen）",
      inputSchema: {
        type: "object",
        properties: {
          model: { type: "string", description: "模型名称，如 claude-sonnet-4-6 / gemini-3.1-pro-preview / qwen3-coder-plus" },
          systemPrompt: { type: "string", description: "系统提示词（可选）" },
          userPrompt: { type: "string", description: "用户输入" },
        },
        required: ["model", "userPrompt"],
      },
    },
    {
      name: "list_agents",
      description: "列出所有已配置的 Agent 及其渠道信息",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "parse_excel_milestones",
      description: "解析 Excel 文件中的项目里程碑/任务数据，输出标准化任务队列 JSON",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Excel 文件路径（绝对或相对路径）" },
          base64Content: { type: "string", description: "或 Base64 编码的 Excel 文件内容" },
        },
      },
    },
    {
      name: "announce_task_transition",
      description: "任务开始/结束时，向负责部门发送通知（支持 @mention 指定人员）",
      inputSchema: {
        type: "object",
        properties: {
          eventType: { type: "string", enum: ["task_start", "task_complete"], description: "事件类型" },
          agentId: { type: "string", description: "负责该任务的 Agent ID" },
          taskTitle: { type: "string", description: "任务标题" },
          dueDate: { type: "string", description: "截止日期（ISO 格式，如 2026-05-01）" },
          estimatedDays: { type: "number", description: "预计天数（从当天算起）" },
          dependencies: { type: "array", items: { type: "string" }, description: "前置依赖任务名列表" },
          mentionUserids: { type: "array", items: { type: "string" }, description: "钉钉 @mention 的用户 userid 列表" },
          mentionOpenIds: { type: "array", items: { type: "string" }, description: "飞书 @mention 的用户 open_id 列表" },
        },
        required: ["eventType", "agentId", "taskTitle"],
      },
    },
    {
      name: "start_project_from_milestones",
      description: "从 Excel 里程碑文件启动整个项目流程：解析任务 → 拓扑排序 → 通知起始任务",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Excel 文件路径" },
          base64Content: { type: "string", description: "或 Base64 编码的 Excel 内容" },
          projectName: { type: "string", description: "项目名称" },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result;
    switch (name) {
      case "notify_agent":
        result = await notifyAgent(args);
        break;

      case "notify_downstream":
        result = await notifyDownstream(args);
        break;

      case "generate_and_push_report":
        result = await generateAndPushReport(args);
        break;

      case "broadcast_to_all": {
        const config = loadAgentsConfig();
        const emoji = args.severity === "critical" ? "🔴" : args.severity === "warning" ? "⚠️" : "ℹ️";
        const decoratedContent = `${emoji} **[${(args.severity ?? "info").toUpperCase()}]**\n\n${args.content}`;
        const results = [];

        // 去重：同一 Webhook URL 只发一次
        const sentWebhooks = new Set();

        for (const agent of config.agents) {
          if (agent.channel === "dingtalk") {
            const url = process.env.DINGTALK_WEBHOOK_PM;
            if (url && !sentWebhooks.has(url)) {
              sentWebhooks.add(url);
              try {
                results.push(await sendDingtalkWebhook({ webhookUrl: url, title: args.title, content: decoratedContent }));
              } catch (e) {
                results.push({ channel: "dingtalk", error: e.message });
              }
            }
          } else if (agent.channel === "feishu") {
            const url = process.env.FEISHU_WEBHOOK_URL;
            if (url && !sentWebhooks.has(url)) {
              sentWebhooks.add(url);
              try {
                results.push(await sendFeishuWebhook({ webhookUrl: url, title: args.title, content: decoratedContent }));
              } catch (e) {
                results.push({ channel: "feishu", error: e.message });
              }
            }
          }
        }
        result = { broadcast: true, channels_notified: results.length, results };
        break;
      }

      case "call_openclaw":
        result = { response: await callOpenClaw(args) };
        break;

      case "list_agents": {
        const config = loadAgentsConfig();
        result = {
          agents: config.agents.map((a) => ({
            id: a.id,
            name: a.name,
            channel: a.channel,
            model: resolveEnv(a.env.model) || "claude-sonnet-4-6",
            notifies: a.notifies ?? [],
            receives_from: a.receives_from ?? [],
          })),
        };
        break;
      }

      case "parse_excel_milestones":
        result = parseExcelMilestones({
          filePath: args.filePath,
          base64Content: args.base64Content,
        });
        break;

      case "announce_task_transition":
        result = await announceTaskTransition(args);
        break;

      case "start_project_from_milestones":
        result = await startProjectFromMilestones({
          filePath: args.filePath,
          base64Content: args.base64Content,
          projectName: args.projectName || "未命名项目",
        });
        break;

      default:
        throw new Error(`未知工具: ${name}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `错误: ${error.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("AgentFlow 通知 MCP Server v2 已启动");
