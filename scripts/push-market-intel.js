#!/usr/bin/env node
/**
 * 市场情报报告生成 + 推送脚本
 *
 * 流程：
 * 1. 调用 LLM（DashScope qwen3.6-plus）生成市场情报报告
 * 2. 推送到钉钉群 Webhook
 *
 * 用法：node scripts/push-market-intel.js
 * 环境变量：ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_MODEL
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ──────────────────────────────────────────────
// 环境变量
// ──────────────────────────────────────────────

const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf-8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const DINGTALK_WEBHOOK =
  process.env.MARKET_INTEL_WEBHOOK ||
  "https://oapi.dingtalk.com/robot/send?access_token=bda6e530beab15f6a363178e4e836711c9e6c4d65afee5e8d52352b12db183af";
const DINGTALK_SECRET = process.env.DINGTALK_SECRET || "";

// ──────────────────────────────────────────────
// LLM 调用（复用 server.js 的 DashScope 逻辑）
// ──────────────────────────────────────────────

async function callDashScope({ model, systemPrompt, userPrompt }) {
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  const token = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!baseUrl || !token) throw new Error("缺少 ANTHROPIC_BASE_URL 或 ANTHROPIC_AUTH_TOKEN");

  const resolvedModel = model || process.env.ANTHROPIC_MODEL || "qwen3.6-plus";

  const body = {
    model: resolvedModel,
    max_tokens: 4096,
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
      max_tokens: 4096,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenClaw API 错误 ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function callLLM({ model, systemPrompt, userPrompt }) {
  if (process.env.ANTHROPIC_BASE_URL && process.env.ANTHROPIC_AUTH_TOKEN) {
    return callDashScope({ model, systemPrompt, userPrompt });
  }
  return callOpenClawGateway({ model, systemPrompt, userPrompt });
}

// ──────────────────────────────────────────────
// 钉钉推送
// ──────────────────────────────────────────────

function dingSignature(secret, timestamp) {
  const str = `${timestamp}\n${secret}`;
  return encodeURIComponent(
    crypto.createHmac("sha256", secret).update(str).digest("base64")
  );
}

async function sendDingtalkWebhook({ webhookUrl, secret, title, content }) {
  let url = webhookUrl;
  if (secret) {
    const ts = Date.now();
    url += `&timestamp=${ts}&sign=${dingSignature(secret, ts)}`;
  }

  const payload = {
    msgtype: "markdown",
    markdown: { title, text: content },
    at: { isAtAll: false },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (data.errcode !== 0) throw new Error(`钉钉 Webhook 错误: ${data.errmsg}`);
  return { success: true, channel: "dingtalk-webhook" };
}

// ──────────────────────────────────────────────
// 主流程
// ──────────────────────────────────────────────

const TODAY = new Date();
const DATE_STR = TODAY.toLocaleDateString("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});

async function main() {
  console.log(`[${new Date().toISOString()}] 开始生成市场情报报告...`);

  // 调用 LLM 生成报告
  console.log("  [1/2] 生成市场情报报告...");
  const systemPrompt = `你是资深电商市场分析师，专注打印机/标签打印机品类。你擅长分析 Amazon 等电商平台的销售数据、用户评价和竞品动态。

请生成一份简洁的 Markdown 格式市场情报日报，适合在钉钉群中展示。

报告必须包含以下板块（用 emoji 标题分隔）：

## 🔥 爆款追踪
- Amazon 等平台上热销 TOP10 标签打印机型号
- 价格区间分布
- 用户评分分析
- 近期促销动态

## 🆕 新款发布
- 近 30 天内标签打印机新品动态
- 功能亮点
- 定价策略
- 市场定位

## 🏪 卖家情报
- Top 10 标签打印机卖家资料
- 月销量估算
- 产品线分析
- 运营特点

## ⚔️ 竞品对标
- Phomemo（爱印）/ 汉印(HPRT) / Munbyn / 精臣(Niimbot) 最新表现
- 鹿匠的机会点分析

## 💡 鹿匠行动建议
- 2-3 条可执行建议

格式要求：
- 用 Markdown 表格展示数据
- 简洁精炼，每个板块不超过 200 字
- 数据要具体（具体型号、价格、评分）
- 不确定的数据标注"待确认"`;

  const userPrompt = `请生成今天的市场情报日报（${DATE_STR}）。基于你掌握的最新的电商数据和行业知识，分析标签打印机品类的市场动态。`;

  const reportContent = await callLLM({
    model: process.env.ANTHROPIC_MODEL || "qwen3.6-plus",
    systemPrompt,
    userPrompt,
  });

  // 推送到钉钉
  console.log("  [2/2] 推送报告到钉钉群...");
  const title = `📊 打印机市场情报日报 - ${DATE_STR}`;
  const result = await sendDingtalkWebhook({
    webhookUrl: DINGTALK_WEBHOOK,
    secret: DINGTALK_SECRET,
    title,
    content: reportContent,
  });

  console.log(`[${new Date().toISOString()}] ✅ 推送完成: ${JSON.stringify(result)}`);
}

main().catch((err) => {
  console.error(`❌ 失败: ${err.message}`);
  process.exit(1);
});
