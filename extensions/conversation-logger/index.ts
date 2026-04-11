import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ============================================================================
// conversation-logger
// Layer 0: 底層 JSONL 忠實記錄
// Layer 1: STM 短期記憶告警（Phase 1）
// ============================================================================

interface ConversationLoggerConfig {
  logDir?: string;
  stmDir?: string;
  stmMaxChars?: number;
  stmWarnTurns?: number;
  stmHardTurns?: number;
  stmIdleMinutes?: number;
}

interface StmState {
  turns: number;
  lastActivityTs: number;
}

interface PendingCtx {
  ts: number;
  channelId: string;
  conversationId: string;
  from: string;
}

const DEFAULT_LOG_DIR      = path.join(os.homedir(), ".openclaw", "logs", "conversations");
const DEFAULT_STM_DIR      = path.join(os.homedir(), ".openclaw", "stm");
const DEFAULT_STM_MAX_CHARS   = 4000;
const DEFAULT_STM_WARN_TURNS  = 15;
const DEFAULT_STM_HARD_TURNS  = 25;
const DEFAULT_STM_IDLE_MINUTES = 120;

// ── 共用工具 ─────────────────────────────────────────────────────────────────

function sanitizeFolderName(name: string): string {
  return name.replace(/[^a-zA-Z0-9\u4e00-\u9fff\-_.]/g, "-").substring(0, 64);
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

// ── Layer 0：JSONL 記錄路徑 ──────────────────────────────────────────────────

function getLogFilePath(logDir: string, channelId: string, conversationId: string): string {
  const today = new Date().toISOString().substring(0, 10);
  if (!channelId && !conversationId) {
    return path.join(logDir, "cron", `${today}.jsonl`);
  }
  const folder = sanitizeFolderName(conversationId || channelId || "unknown");
  return path.join(logDir, "channels", folder, `${today}.jsonl`);
}

// ── Layer 1：STM 狀態管理 ────────────────────────────────────────────────────

function getStmFilePath(stmDir: string, channelId: string, conversationId: string): string {
  const key = sanitizeFolderName(conversationId || channelId || "unknown");
  return path.join(stmDir, `${key}.json`);
}

function loadStmState(filePath: string): StmState {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8")) as StmState;
    }
  } catch {}
  return { turns: 0, lastActivityTs: Date.now() };
}

function saveStmState(filePath: string, state: StmState): void {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(state), "utf8");
}

function isResetCommand(content: string): boolean {
  return /\/reset\b|\/new\b/i.test(content.trim());
}

function isCronSession(channelId: string, conversationId: string): boolean {
  return !channelId && !conversationId;
}

// ── pendingQueue（供 before_message_write 取得頻道資訊）────────────────────

const pendingQueue: PendingCtx[] = [];
const MAX_QUEUE = 20;

// ── Plugin 主體 ──────────────────────────────────────────────────────────────

export default function register(api: any) {
  const config: ConversationLoggerConfig = api.config ?? {};

  const logDir         = config.logDir         ?? DEFAULT_LOG_DIR;
  const stmDir         = config.stmDir         ?? DEFAULT_STM_DIR;
  const stmMaxChars    = config.stmMaxChars    ?? DEFAULT_STM_MAX_CHARS;
  const stmWarnTurns   = config.stmWarnTurns   ?? DEFAULT_STM_WARN_TURNS;
  const stmHardTurns   = config.stmHardTurns   ?? DEFAULT_STM_HARD_TURNS;
  const stmIdleMinutes = config.stmIdleMinutes ?? DEFAULT_STM_IDLE_MINUTES;

  // ── Inbound: user message ─────────────────────────────────────────────────
  api.on("message_received", (event: any, ctx: any) => {
    const content: string = event.content ?? "";
    const channelId: string = ctx.channelId ?? "";
    const conversationId: string = ctx.conversationId ?? "";
    const from: string = event.from ?? "";
    const ts = Date.now();

    // 0. 如果訊息 @mention 了其他人（非 bot 自身），忽略不回應
    const BOT_ID = "1469102666272473152";
    const mentionPattern = /<@!?(\d+)>/g;
    let mentionMatch: RegExpExecArray | null;
    let hasOtherMention = false;
    while ((mentionMatch = mentionPattern.exec(content)) !== null) {
      if (mentionMatch[1] !== BOT_ID) {
        hasOtherMention = true;
        break;
      }
    }
    if (hasOtherMention) {
      return { reject: true };
    }

    // 1. 訊息長度檢查
    if (content.length > stmMaxChars) {
      return {
        reject: true,
        rejectMessage: `⚠️ 訊息過長（${content.length} 字元），上限為 ${stmMaxChars} 字元。請拆分後重新傳送。`
      };
    }

    // 2. STM（cron session 不計turn）
    let modifiedContent = content;

    if (!isCronSession(channelId, conversationId)) {
      const stmFile = getStmFilePath(stmDir, channelId, conversationId);
      let state = loadStmState(stmFile);

      // 閒置重置
      const idleMs = stmIdleMinutes * 60 * 1000;
      if (ts - state.lastActivityTs > idleMs) {
        state = { turns: 0, lastActivityTs: ts };
      }

      // /reset 或 /new 指令重置
      if (isResetCommand(content)) {
        state = { turns: 0, lastActivityTs: ts };
        saveStmState(stmFile, state);
      } else {
        // 更新活動時間
        state.lastActivityTs = ts;

        // 硬限制：拒絕訊息
        if (state.turns >= stmHardTurns) {
          saveStmState(stmFile, state);
          return {
            reject: true,
            rejectMessage:
              `⛔ Session 已達 ${state.turns} 輪上限（最大 ${stmHardTurns} 輪）。\n\n` +
              `請執行以下指令重置：\n` +
              `  \`/reset\` — 重置當前 session（LanceDB 記憶保留）\n` +
              `  \`/new\`   — 開新 session\n\n` +
              `重置後記憶系統會自動保留重要資訊。`
          };
        }

        // 軟警告：注入提醒前綴（讓 agent 感知）
        if (state.turns >= stmWarnTurns) {
          modifiedContent =
            `[⚠️ STM 提醒：本 session 已進行 ${state.turns} 輪，` +
            `建議執行 /reset 開新 session 以維持效能。]\n\n` +
            content;
        }

        saveStmState(stmFile, state);
      }
    }

    // 3. Layer 0 記錄
    const pending: PendingCtx = { ts, channelId, conversationId, from };
    pendingQueue.push(pending);
    if (pendingQueue.length > MAX_QUEUE) pendingQueue.shift();

    const record = { ts, role: "user", from, channel: channelId, conversationId, content };
    try {
      appendJsonl(getLogFilePath(logDir, channelId, conversationId), record);
    } catch (err) {
      process.stderr.write(`[conversation-logger] write error: ${err}\n`);
    }

    // 4. 若有軟警告注入，回傳修改後的 content
    if (modifiedContent !== content) {
      return { content: modifiedContent };
    }
  });

  // ── Outbound: agent message ───────────────────────────────────────────────
  // before_message_write ctx 不帶 channelId，從 pendingQueue 取得
  api.on("before_message_write", (event: any, _ctx: any) => {
    const message = event.message as Record<string, unknown> | undefined;
    if (!message) return;

    const role = typeof message.role === "string" ? message.role : "unknown";
    if (role === "user") return;

    const content = extractTextContent(message.content);
    if (!content) return;

    const ts = Date.now();
    const pending = pendingQueue.shift();
    const conversationId = pending?.conversationId ?? "";
    const channelId      = pending?.channelId      ?? "";
    const latencyMs      = pending ? ts - pending.ts : undefined;

    // STM turn +1（cron session 不計）
    if (!isCronSession(channelId, conversationId)) {
      try {
        const stmFile = getStmFilePath(stmDir, channelId, conversationId);
        const state = loadStmState(stmFile);
        state.turns += 1;
        state.lastActivityTs = ts;
        saveStmState(stmFile, state);
      } catch (err) {
        process.stderr.write(`[conversation-logger] stm update error: ${err}\n`);
      }
    }

    // Layer 0 記錄
    const record: any = { ts, role: "agent", channel: channelId, conversationId, content };
    if (latencyMs !== undefined) record.latencyMs = latencyMs;

    try {
      appendJsonl(getLogFilePath(logDir, channelId, conversationId), record);
    } catch (err) {
      process.stderr.write(`[conversation-logger] write error: ${err}\n`);
    }
  });

  api.logger?.info("conversation-logger: registered (Layer 0 + STM Phase 1 active)");
}
