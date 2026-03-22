import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface ConversationLoggerConfig {
  logDir?: string;
  stmMaxChars?: number;
}

const DEFAULT_LOG_DIR = path.join(os.homedir(), ".openclaw", "logs", "conversations");
const DEFAULT_STM_MAX_CHARS = 4000;

function sanitizeFolderName(name: string): string {
  return name.replace(/[^a-zA-Z0-9\u4e00-\u9fff\-_.]/g, "-").substring(0, 64);
}

function getLogFilePath(logDir: string, channelId: string, conversationId: string): string {
  const today = new Date().toISOString().substring(0, 10);

  // Cron job: both channelId and conversationId are empty
  if (!channelId && !conversationId) {
    return path.join(logDir, "cron", `${today}.jsonl`);
  }

  const folder = sanitizeFolderName(conversationId || channelId || "unknown");
  return path.join(logDir, "channels", folder, `${today}.jsonl`);
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function appendJsonl(filePath: string, record: object): void {
  ensureDir(filePath);
  fs.appendFileSync(filePath, JSON.stringify(record) + "\n", "utf8");
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c?.type === "text")
      .map((c: any) => c.text ?? "")
      .join("");
  }
  return String(content ?? "");
}

interface PendingCtx {
  ts: number;
  channelId: string;
  conversationId: string;
  from: string;
}

// Queue of recent inbound contexts (FIFO). Agent replies pop from front.
const pendingQueue: PendingCtx[] = [];
const MAX_QUEUE = 20;

export default function register(api: any) {
  const config: ConversationLoggerConfig = api.config ?? {};
  const logDir = config.logDir ?? DEFAULT_LOG_DIR;
  const stmMaxChars = config.stmMaxChars ?? DEFAULT_STM_MAX_CHARS;

  // ── Inbound: user message ──────────────────────────────────────────────────
  api.on("message_received", (event: any, ctx: any) => {
    const content: string = event.content ?? "";
    const channelId: string = ctx.channelId ?? "";
    const conversationId: string = ctx.conversationId ?? "";
    const from: string = event.from ?? "";

    if (content.length > stmMaxChars) {
      return {
        reject: true,
        rejectMessage: `⚠️ 訊息過長（${content.length} 字元），上限為 ${stmMaxChars} 字元。請拆分後重新傳送。`
      };
    }

    const ts = Date.now();
    const pending: PendingCtx = { ts, channelId, conversationId, from };
    pendingQueue.push(pending);
    if (pendingQueue.length > MAX_QUEUE) pendingQueue.shift();

    const record = { ts, role: "user", from, channel: channelId, conversationId, content };
    try {
      appendJsonl(getLogFilePath(logDir, channelId, conversationId), record);
    } catch (err) {
      process.stderr.write(`[conversation-logger] write error: ${err}\n`);
    }
  });

  // ── Outbound: agent message ────────────────────────────────────────────────
  // before_message_write ctx does NOT carry channelId/conversationId,
  // so we pop the oldest pending context from the queue.
  api.on("before_message_write", (event: any, _ctx: any) => {
    const message = event.message as Record<string, unknown> | undefined;
    if (!message) return;

    const role = typeof message.role === "string" ? message.role : "unknown";
    if (role === "user") return;

    const content = extractTextContent(message.content);
    if (!content) return;

    const ts = Date.now();
    const pending = pendingQueue.shift(); // consume oldest context
    const conversationId = pending?.conversationId ?? "";
    const channelId = pending?.channelId ?? "";
    const latencyMs = pending ? ts - pending.ts : undefined;

    const record: any = {
      ts,
      role: "agent",
      channel: channelId,
      conversationId,
      content
    };
    if (latencyMs !== undefined) record.latencyMs = latencyMs;

    try {
      appendJsonl(getLogFilePath(logDir, channelId, conversationId), record);
    } catch (err) {
      process.stderr.write(`[conversation-logger] write error: ${err}\n`);
    }
  });
}
