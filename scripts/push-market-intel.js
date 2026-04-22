#!/usr/bin/env node
/**
 * 市场情报报告生成 + 推送脚本（图文嵌套版 v3）
 *
 * 1. LLM 生成报告（多表格 + 多文字）
 * 2. Amazon 提取产品小图嵌入
 * 3. 推送至单群测试（成功后再开双群）
 *
 * 用法：node scripts/push-market-intel.js
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf-8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

// 仅主群（测试通过后再开副群）
const DINGTALK_WEBHOOK =
  process.env.MARKET_INTEL_WEBHOOK ||
  "https://oapi.dingtalk.com/robot/send?access_token=bda6e530beab15f6a363178e4e836711c9e6c4d65afee5e8d52352b12db183af";
const DINGTALK_WEBHOOKS = [{ url: DINGTALK_WEBHOOK, label: "主群" }];
const DINGTALK_SECRET = process.env.DINGTALK_SECRET || "";

// ──────────────────────────────────────────────
// 首席市场官知识库
// ──────────────────────────────────────────────

const MARKET_REPORTS_DIR = process.env.MARKET_REPORTS_DIR ||
  path.join(process.env.HOME, ".openclaw/workspace-market/reports");

function saveReportToKnowledgeBase(content, dateStr) {
  // 确保目录存在
  fs.mkdirSync(MARKET_REPORTS_DIR, { recursive: true });

  // 文件名：market-intel-YYYY-MM-DD.md
  const datePart = new Date().toISOString().split("T")[0];
  const filePath = path.join(MARKET_REPORTS_DIR, `market-intel-${datePart}.md`);
  fs.writeFileSync(filePath, content, "utf-8");
  console.log(`  📄 报告已保存至知识库: ${filePath}`);
  return filePath;
}

// ──────────────────────────────────────────────
// Amazon 产品提取（小图 + 名称）
// ──────────────────────────────────────────────

const AMAZON_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function searchAmazonProducts(keyword, maxItems = 4) {
  const url = `https://www.amazon.com/s?k=${encodeURIComponent(keyword)}`;
  try {
    const res = await fetch(url, { headers: AMAZON_HEADERS, signal: AbortSignal.timeout(12000) });
    const html = await res.text();

    const titles = [];
    const titleRe = /<span[^>]*class="[^"]*a-text-normal[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
    let m;
    while ((m = titleRe.exec(html))) {
      const text = m[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
      if (text.length > 8 && !text.startsWith("Sponsored")) titles.push(text);
    }

    const images = [];
    const imgRe = /<img[^>]*class="[^"]*s-image[^"]*"[^>]*src="([^"]+)"/g;
    while ((m = imgRe.exec(html))) {
      const src = m[1];
      if (src.includes("/images/I/") && !src.includes("/111") && !src.includes("/11++")) {
        // AC_UL160_ 小尺寸，钉钉渲染时不会太大，清晰度高
        images.push(src.replace(/_AC_UY\d+_/, "_AC_UL160_"));
      }
    }

    const products = [];
    for (let i = 0; i < Math.min(maxItems, titles.length, images.length); i++) {
      // 截断标题避免过长
      products.push({
        title: titles[i].slice(0, 80),
        image: images[i],
      });
    }
    return products;
  } catch (err) {
    console.warn(`  [Amazon "${keyword}"] ${err.message}`);
    return [];
  }
}

async function collectProducts() {
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
      products: await searchAmazonProducts(s.query, 3),
    }))
  );
  return results.filter((r) => r.products.length > 0);
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

  // 1. 获取 Amazon 产品数据
  console.log("  [1/3] 搜索 Amazon 产品...");
  const productData = await collectProducts();

  // 2. LLM 生成报告（多表格 + 多文字分析）
  console.log("  [2/3] 生成报告...");
  const reportContent = await callLLM({
    model: process.env.ANTHROPIC_MODEL || "qwen3.6-plus",
    systemPrompt: `你是资深电商市场分析师，专注标签打印机品类。
请生成一份详细的市场情报日报，文字分析要多，表格要多。

报告必须包含以下板块：

## 🔥 爆款追踪
- 用表格列出 Amazon 热销 TOP10（型号、价格、评分、月销估算、近7日变化）
- 分析价格带分布（$20-50 / $50-100 / $100+ 占比）
- 列出近期促销动态（Coupon、Deal、站外推广）

## 🆕 新款发布
- 用表格列出近 30 天新品（品牌、型号、核心功能、定价、上市时间）
- 分析新品功能趋势（连接方式、打印速度、特殊功能）
- 定价策略对比

## 🏪 卖家情报
- 用表格列出 Top 10 卖家（店铺名、月销估算、主力品类、运营特点、增长趋势）
- 分析头部卖家的运营模式差异

## ⚔️ 竞品对标
- 用表格对比 Phomemo / 汉印(HPRT) / Munbyn / 精臣(Niimbot)
  （品牌、核心价位段、月销、主销市场、优势、短板）
- 分析鹿匠的机会点和差异化方向

## 💡 鹿匠行动建议
- 3-5 条可执行建议（具体到品类、价格段、渠道、动作）

格式要求：
- 每个板块先用一段话总结核心发现
- 再用表格展示数据
- 最后用列表补充细节
- 不确定的数据标注"待确认"
- 使用钉钉支持的 Markdown：|表格|、**加粗**、-列表、![alt](url)`,
    userPrompt: `请生成今天的市场情报日报（${DATE_STR}）。`,
  });

  // 3. 图文嵌套排版：在每个品类板块后插入产品图片
  console.log("  [3/3] 图文嵌套 + 推送...");

  // 先插入产品图文卡片到报告末尾
  const productCards = [];
  for (const { label, products } of productData) {
    if (products.length === 0) continue;
    // 每个品牌展示 2-3 个产品，图片在上、名称在下
    const cards = products
      .slice(0, 2)
      .map((p) => `![${p.title}](${p.image})\n\n${p.title}`)
      .join("\n\n");
    productCards.push(`### 📷 ${label} 热门产品\n\n${cards}`);
  }

  let fullReport = reportContent;
  if (productCards.length > 0) {
    fullReport += `\n\n---\n\n## 📸 Amazon 热门产品实拍\n\n${productCards.join("\n\n")}`;
  }

  // 控制大小
  if (fullReport.length > 15000) {
    fullReport = fullReport.slice(0, 14500) + "\n\n...（内容过长已截断）";
  }

  console.log(`  报告长度: ${fullReport.length} 字符`);

  // 保存至首席市场官知识库
  saveReportToKnowledgeBase(fullReport, DATE_STR);

  // 推送
  const title = `📊 打印机市场情报日报 - ${DATE_STR}`;
  for (const { url, label } of DINGTALK_WEBHOOKS) {
    const result = await sendDingtalkWebhook({
      webhookUrl: url,
      secret: DINGTALK_SECRET,
      title,
      content: fullReport,
    });
    console.log(`[${new Date().toISOString()}] ✅ 推送完成 [${label}]`);
  }
}

main().catch((err) => {
  console.error(`❌ 失败: ${err.message}`);
  process.exit(1);
});
