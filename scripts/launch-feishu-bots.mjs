#!/usr/bin/env node
/**
 * launch-feishu-bots.mjs — 以子进程方式后台启动所有飞书 Bot
 * 用法: node scripts/launch-feishu-bots.mjs [bot_id]
 * 日志: /tmp/agentflow/bot-<id>.log
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG_DIR = process.env.AGENTFLOW_WORKSPACE ?? "/tmp/agentflow";

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
fs.mkdirSync(LOG_DIR, { recursive: true });

const BOT_SCRIPT = path.join(ROOT, "agents/feishu-bot.mjs");
const ONLY = process.argv[2] ?? "";

const BOTS = [
  { id: "tester",                name: "Tester Bot",               appId: process.env.FEISHU_TESTER_APP_ID,       appSecret: process.env.FEISHU_TESTER_APP_SECRET },
  { id: "dataanalyst",           name: "DataAnalyst Bot",           appId: process.env.FEISHU_DATAANALYST_APP_ID,  appSecret: process.env.FEISHU_DATAANALYST_APP_SECRET },
  { id: "main-feishu",           name: "Main Dev Bot (飞书)",        appId: process.env.FEISHU_MAIN_APP_ID,         appSecret: process.env.FEISHU_MAIN_APP_SECRET },
  { id: "productmanager-feishu", name: "ProductManager Bot (飞书)", appId: process.env.FEISHU_PM_APP_ID,           appSecret: process.env.FEISHU_PM_APP_SECRET },
  { id: "sales-feishu",          name: "Sales Bot (飞书)",           appId: process.env.FEISHU_SALES_APP_ID,        appSecret: process.env.FEISHU_SALES_APP_SECRET },
];

const pids = [];

for (const bot of BOTS) {
  if (ONLY && bot.id !== ONLY) continue;
  if (!bot.appId || !bot.appSecret) {
    console.log(`⚠️  跳过 ${bot.id}（未配置 APP_ID/SECRET）`);
    continue;
  }

  const logFile = path.join(LOG_DIR, `bot-${bot.id}.log`);
  const out = fs.openSync(logFile, "a");

  const child = spawn("node", [BOT_SCRIPT], {
    detached: true,
    stdio: ["ignore", out, out],
    env: {
      ...process.env,
      FEISHU_APP_ID:     bot.appId,
      FEISHU_APP_SECRET: bot.appSecret,
      AGENT_ID:          bot.id,
      AGENT_NAME:        bot.name,
    },
  });
  child.unref();

  // 写 PID 文件方便后续管理
  const pidFile = path.join(LOG_DIR, `bot-${bot.id}.pid`);
  fs.writeFileSync(pidFile, String(child.pid));

  console.log(`✅ ${bot.name} (pid=${child.pid}) → 日志: ${logFile}`);
  pids.push({ id: bot.id, pid: child.pid });
}

console.log(`\n🚀 飞书 Bot 全部启动（后台运行）`);
console.log(`\n查看日志：`);
for (const { id } of pids) {
  console.log(`  tail -f ${LOG_DIR}/bot-${id}.log`);
}
console.log(`\n停止所有 Bot：`);
console.log(`  node scripts/launch-feishu-bots.mjs stop`);
