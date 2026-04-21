/**
 * PM2 Ecosystem Config — AgentFlow 全部进程
 *
 * 启动: pm2 start ecosystem.config.cjs
 * 查看: pm2 list / pm2 logs
 * 停止: pm2 stop all
 * 重启: pm2 restart all
 * 开机自启: pm2 startup && pm2 save
 */

const path = require("path");
const fs = require("fs");

// 加载 .env
const ROOT = __dirname;
const envPath = path.join(ROOT, ".env");
const envVars = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    envVars[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
}

// 公共环境变量
const commonEnv = {
  AGENTFLOW_ROOT: ROOT,
  ANTHROPIC_BASE_URL: envVars.ANTHROPIC_BASE_URL || "",
  ANTHROPIC_AUTH_TOKEN: envVars.ANTHROPIC_AUTH_TOKEN || "",
  ANTHROPIC_MODEL: envVars.ANTHROPIC_MODEL || "",
  OPENCLAW_BASE_URL: envVars.OPENCLAW_BASE_URL || "",
  OPENCLAW_API_KEY: envVars.OPENCLAW_API_KEY || "",
  AGENTFLOW_WORKSPACE: envVars.AGENTFLOW_WORKSPACE || "/tmp/agentflow",
};

module.exports = {
  apps: [
    // ═══════════════════════════════════════════
    // 1. AgentFlow HTTP Server（核心调度）
    // ═══════════════════════════════════════════
    {
      name: "agentflow-server",
      script: "scripts/agentflow-server.mjs",
      cwd: ROOT,
      env: {
        ...commonEnv,
        DINGTALK_WEBHOOK_PM: envVars.DINGTALK_WEBHOOK_PM || "",
        DINGTALK_WEBHOOK_PM_SECRET: envVars.DINGTALK_WEBHOOK_PM_SECRET || "",
        FEISHU_WEBHOOK_URL: envVars.FEISHU_WEBHOOK_URL || "",
        AGENTFLOW_SERVER_PORT: envVars.AGENTFLOW_SERVER_PORT || "3456",
      },
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },

    // ═══════════════════════════════════════════
    // 2. 飞书 Bot — 首席测试开发
    // ═══════════════════════════════════════════
    {
      name: "bot-tester",
      script: "agents/feishu-bot.mjs",
      cwd: ROOT,
      env: {
        ...commonEnv,
        FEISHU_APP_ID: envVars.FEISHU_TESTER_APP_ID || "",
        FEISHU_APP_SECRET: envVars.FEISHU_TESTER_APP_SECRET || "",
        AGENT_ID: "tester",
        AGENT_NAME: "首席测试开发",
      },
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },

    // ═══════════════════════════════════════════
    // 3. 飞书 Bot — DataAnalyst
    // ═══════════════════════════════════════════
    {
      name: "bot-dataanalyst",
      script: "agents/feishu-bot.mjs",
      cwd: ROOT,
      env: {
        ...commonEnv,
        FEISHU_APP_ID: envVars.FEISHU_DATAANALYST_APP_ID || "",
        FEISHU_APP_SECRET: envVars.FEISHU_DATAANALYST_APP_SECRET || "",
        AGENT_ID: "dataanalyst",
        AGENT_NAME: "DataAnalyst Bot",
      },
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },

    // ═══════════════════════════════════════════
    // 4. 飞书 Bot — 首席开发工程师
    // ═══════════════════════════════════════════
    {
      name: "bot-main-feishu",
      script: "agents/feishu-bot.mjs",
      cwd: ROOT,
      env: {
        ...commonEnv,
        FEISHU_APP_ID: envVars.FEISHU_MAIN_APP_ID || "",
        FEISHU_APP_SECRET: envVars.FEISHU_MAIN_APP_SECRET || "",
        AGENT_ID: "main-feishu",
        AGENT_NAME: "首席开发工程师",
      },
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },

    // ═══════════════════════════════════════════
    // 5. 飞书 Bot — 首席产品经理
    // ═══════════════════════════════════════════
    {
      name: "bot-pm-feishu",
      script: "agents/feishu-bot.mjs",
      cwd: ROOT,
      env: {
        ...commonEnv,
        FEISHU_APP_ID: envVars.FEISHU_PM_APP_ID || "",
        FEISHU_APP_SECRET: envVars.FEISHU_PM_APP_SECRET || "",
        AGENT_ID: "productmanager-feishu",
        AGENT_NAME: "首席产品经理",
      },
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },

    // ═══════════════════════════════════════════
    // 6. 飞书 Bot — Sales
    // ═══════════════════════════════════════════
    {
      name: "bot-sales-feishu",
      script: "agents/feishu-bot.mjs",
      cwd: ROOT,
      env: {
        ...commonEnv,
        FEISHU_APP_ID: envVars.FEISHU_SALES_APP_ID || "",
        FEISHU_APP_SECRET: envVars.FEISHU_SALES_APP_SECRET || "",
        AGENT_ID: "sales-feishu",
        AGENT_NAME: "Sales Bot",
      },
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
