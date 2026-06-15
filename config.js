const path = require("node:path");
const fs = require("node:fs");

function loadEnvFile() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) {
      continue;
    }
    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

module.exports = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "127.0.0.1",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-5.5",
  sessionSecret: process.env.SESSION_SECRET || "dev-session-secret",
  cookieSecure:
    process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production",
  dataDir: process.env.DATA_DIR || path.join(process.cwd(), "data"),
};
