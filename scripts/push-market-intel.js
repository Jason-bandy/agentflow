#!/usr/bin/env node
/**
 * 市场情报报告生成 + 推送脚本（图文版）
 *
 * 流程：
 * 1. 从 Amazon 搜索产品，提取产品图片 URL
 * 2. 调用 LLM 生成市场情报报告
 * 3. 将图片嵌入报告，推送图文消息到钉钉群
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
const DINGTALK_WEBHOOK_SECONDARY =
  "https://oapi.dingtalk.com/robot/send?access_token=5f8917250a3d6c57e5d035948f70bf108a1e6ad6c5fc6ac7154ff5c8cf8ec99f";
const DINGTALK_SECRET = process.env.DINGTALK_SECRET || "";
const DINGTALK_WEBHOOKS = [
  { url: DINGTALK_WEBHOOK, label: "主群" },
  { url: DINGTALK_WEBHOOK_SECONDARY, label: "副群" },
];

// ──────────────────────────────────────────────
// Amazon 图片提取
// ──────────────────────────────────────────────

const AMAZON_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function searchAmazonImages(keyword, maxItems = 4) {
  const url = `https://www.amazon.com/s?k=${encodeURIComponent(keyword)}`;
  try {
    const res = await fetch(url, { headers: AMAZON_HEADERS, signal: AbortSignal.timeout(12000) });
    const html = await res.text();

    const images = [];
    // 提取 s-image 标签的 src，并升级到高清
    const imgRe = /<img[^>]*class="[^"]*s-image[^"]*"[^>]*src="([^"]+)"/g;
    let m;
    while ((m = imgRe.exec(html)) && images.length < maxItems) {
      let src = m[1];
      // 过滤掉小图标/广告图，只要产品图
      if (src.includes("/images/I/") && !src.includes("/111") && !src.includes("/11++")) {
        // 升级到高清：将 _AC_UY218_ 替换为 _AC_SL400_
        src = src.replace(/_AC_UY\d+_/, "_AC_SL400_");
        images.push(src);
      }
    }

    return [...new Set(images)].slice(0, maxItems);
  } catch (err) {
    console.warn(`  [Amazon 搜索 "${keyword}" 失败] ${err.message}`);
    return [];
  }
}

async function collectProductImages() {
  const searches = [
    { query: "label+printer+thermal", label: "热门标签打印机" },
    { query: "Phomemo+label+printer", label: "Phomemo" },
    { query: "NIIMBOT+label+printer", label: "精臣" },
    { query: "MUNBYN+thermal+printer", label: "Munbyn" },
    { query: "HPRT+label+printer", label: "汉印" },
  ];

  const results = await Promise.all(
    searches.map(async (s) => ({
      label: s.label,
      images: await searchAmazonImages(s.query, 3),
    }))
  );

  return results.filter((r) => r.images.length > 0);
}

// ──────────────────────────────────────────────
// LLM 调用
// ──────────────────────────────────────────────

async function callDashScope({ model, systemPrompt, userPrompt }) {
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  const token = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!baseUrl || !token) throw new Error("缺少 ANTHROPIC_BASE_URL 或 ANTHROPIC_AUTH_TOKEN");

  const resolvedModel = model || process.env.ANTHROPIC_MODEL || "qwen3.6-plus";
  const body = {
    model: resolvedModel,
    max_tokens: 3000,
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
      max_tokens: 3000,
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

  // 1. 并行搜索 Amazon 图片 + LLM 生成报告
  console.log("  [1/2] 搜索 Amazon 图片 + 生成报告...");
  const [productImages, reportContent] = await Promise.all([
    collectProductImages(),
    callLLM({
      model: process.env.ANTHROPIC_MODEL || "qwen3.6-plus",
      systemPrompt: `你是资深电商市场分析师，专注打印机/标签打印机品类。
请生成一份精简的 Markdown 格式市场情报日报，适合钉钉群展示。

报告必须包含以下板块：

## 🔥 爆款追踪
- Amazon 热销标签打印机 TOP5（型号、价格、评分）
- 近期促销动态

## 🆕 新款发布
- 近 30 天新品动态（型号、功能亮点、定价）

## 🏪 卖家情报
- Top 5 卖家（名称、月销估算、运营特点）

## ⚔️ 竞品对标
- Phomemo / 汉印 / Munbyn / 精臣 最新表现
- 鹿匠的机会点

## 💡 鹿匠行动建议
- 2-3 条可执行建议

格式要求：
- 用 Markdown 表格
- 每个板块精简到 100 字以内
- 数据要具体
- 不确定的标注"待确认"`,
      userPrompt: `请生成今天的市场情报日报（${DATE_STR}）。`,
    }),
  ]);

  // 2. 嵌入产品图片
  console.log("  [2/2] 嵌入产品图片并推送...");
  const imageMap = Object.fromEntries(productImages.map((p) => [p.label, p.images]));

  let fullReport = reportContent;
  const imageSections = [];

  for (const [label, images] of Object.entries(imageMap)) {
    if (images.length > 0) {
      // 钉钉 markdown 中图片用标准 ![alt](url) 语法
      const imgMarkdown = images.slice(0, 2).map((u) => `![](${u})`).join("\n");
      imageSections.push(`**${label}**\n${imgMarkdown}`);
    }
  }

  if (imageSections.length > 0) {
    const gallerySection = `\n\n---\n\n## 📸 Amazon 热门产品实拍\n${imageSections.join("\n\n")}`;
    // 插入到报告末尾
    fullReport += gallerySection;
  }

  // 控制总大小（钉钉 markdown 限制约 20KB）
  if (fullReport.length > 18000) {
    fullReport = fullReport.slice(0, 17500) + "\n\n...（内容过长已截断）";
  }

  // 推送到两个钉钉群（单个失败不阻断其他）
  const title = `📊 打印机市场情报日报 - ${DATE_STR}`;
  for (const { url, label } of DINGTALK_WEBHOOKS) {
    try {
      const result = await sendDingtalkWebhook({
        webhookUrl: url,
        secret: DINGTALK_SECRET,
        title,
        content: fullReport,
      });
      console.log(`[${new Date().toISOString()}] ✅ 推送完成 [${label}]: ${JSON.stringify(result)}`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] ⚠️ 推送失败 [${label}]: ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error(`❌ 失败: ${err.message}`);
  process.exit(1);
});
