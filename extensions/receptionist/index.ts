// ============================================================================
// Receptionist Plugin
//
// 架構：
//   主 Session  → 永遠跑 Haiku（接線生）分類意圖
//   Worker Session → 獨立 session，跑 Sonnet/Opus 執行實際任務
//
// Session key 格式：
//   主 session:  agent:main:discord:channel:{channelId}  (OpenClaw 原生格式)
//   Worker:      worker:{mainSessionKey}:{taskId}
//
// 狀態看板：
//   單一 Discord 訊息，任務有任何異動就 edit，不洗版
// ============================================================================

// ── Types ────────────────────────────────────────────────────────────────────

interface ReceptionistConfig {
  haikuModel?: string;
  sonnetModel?: string;
  opusModel?: string;
  statusUpdateIntervalMs?: number;
  boardTtlMs?: number;
}

type TaskStatus = "running" | "done" | "error" | "aborted";
type RouteTarget = "haiku" | "sonnet" | "opus";

interface TaskEntry {
  taskId: string;
  workerSessionKey: string;
  runId?: string;
  summary: string;
  model: string;
  startedAt: number;
  status: TaskStatus;
  endedAt?: number;
}

interface ChannelBoard {
  mainSessionKey: string;
  discordChannelId: string;
  accountId: string;
  statusMessageId?: string;
  statusChannelId?: string;
  tasks: TaskEntry[];
  timerHandle?: ReturnType<typeof setInterval>;
}

interface ParsedTags {
  abortTaskId?: string;
  summary: string;
  route?: RouteTarget;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_HAIKU_MODEL  = "claude-haiku-4-5-20251001";
const DEFAULT_SONNET_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_OPUS_MODEL   = "claude-opus-4-6";
const DEFAULT_STATUS_INTERVAL_MS = 20_000;
const DEFAULT_BOARD_TTL_MS = 5 * 60_000;

const WORKER_PREFIX = "worker:";

// ── System Prompt ─────────────────────────────────────────────────────────────

function buildReceptionistPrompt(activeTasks: TaskEntry[]): string {
  const taskList =
    activeTasks.length === 0
      ? "（目前無進行中的任務）"
      : activeTasks
          .map((t) => {
            const elapsed = Math.floor((Date.now() - t.startedAt) / 1000);
            const modelLabel = t.model.includes("opus")
              ? "Opus"
              : t.model.includes("sonnet")
              ? "Sonnet"
              : "Haiku";
            return `- [${t.taskId}] ${t.summary}（${modelLabel}，已執行 ${elapsed}s）`;
          })
          .join("\n");

  return `你是 OpenClaw 接線生，使用繁體中文回覆。

## 進行中的任務
${taskList}

## 你的工作
1. 用 1-2 句話禮貌回應用戶（不要列出命令或執行任何操作）
2. 判斷意圖：是否與現有任務相關？
   - 若相關（補充、修改、追問）：加上 [ABORT:taskId] 標籤
   - 若無關：直接路由新任務
3. **最後一行**必須是路由標籤，格式如下（絕對不能省略）：

## 路由標籤格式（最後一行，不得有其他文字）
新任務：[SUMMARY:10字內描述][ROUTE:haiku|sonnet|opus]
中止並重建：[ABORT:taskId][SUMMARY:任務描述][ROUTE:haiku|sonnet|opus]

## 路由規則（重要）
- haiku  → **只用於** 純文字回答、閒聊、打招呼（不需要執行任何工具或命令）
- sonnet → 所有需要執行操作的任務：查詢、檢查、管理、程式、除錯、系統分析
- opus   → 深度研究、策略規劃、複雜多步驟推理

## 範例
用戶：「你好」→ [SUMMARY:打招呼][ROUTE:haiku]
用戶：「檢查 cron jobs」→ [SUMMARY:檢查cron狀態][ROUTE:sonnet]
用戶：「分析這段程式碼」→ [SUMMARY:程式碼分析][ROUTE:sonnet]`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function genTaskId(): string {
  return `T${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

/** agent:main:discord:channel:123 → { type:"channel", discordChannelId:"123" } */
function parseDiscordFromSessionKey(
  sessionKey: string
): { type: string; discordChannelId: string } | null {
  const m = sessionKey.match(/^agent:[^:]+:discord:(channel|direct|group):(\d+)/);
  if (m) return { type: m[1], discordChannelId: m[2] };
  return null;
}

function isWorkerSession(sessionKey: string): boolean {
  return sessionKey.startsWith(WORKER_PREFIX);
}

function makeWorkerSessionKey(mainSessionKey: string, taskId: string): string {
  return `${WORKER_PREFIX}${mainSessionKey}:${taskId}`;
}

function mainSessionFromWorker(workerSessionKey: string): string {
  // worker:{mainSessionKey}:{taskId}  →  strip prefix and last :taskId
  const withoutPrefix = workerSessionKey.slice(WORKER_PREFIX.length);
  const lastColon = withoutPrefix.lastIndexOf(":");
  return lastColon > 0 ? withoutPrefix.slice(0, lastColon) : withoutPrefix;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c?.type === "text")
      .map((c: any) => c.text ?? "")
      .join("");
  }
  return "";
}

function parseRoutingTags(text: string): ParsedTags {
  const lastLine = text.trimEnd().split("\n").pop() ?? "";
  const abortM   = lastLine.match(/\[ABORT:([^\]]+)\]/);
  const summaryM = lastLine.match(/\[SUMMARY:([^\]]{1,30})\]/);
  const routeM   = lastLine.match(/\[ROUTE:(haiku|sonnet|opus)\]/i);
  return {
    abortTaskId: abortM?.[1]?.trim(),
    summary:     summaryM?.[1]?.trim() ?? "任務",
    route:       (routeM?.[1]?.toLowerCase() as RouteTarget) ?? undefined,
  };
}

function elapsedStr(ms: number): string {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

function modelLabel(model: string): string {
  if (model.includes("opus"))   return "Opus";
  if (model.includes("sonnet")) return "Sonnet";
  return "Haiku";
}

function buildBoardText(board: ChannelBoard): string {
  const running = board.tasks.filter((t) => t.status === "running");
  const finished = board.tasks.filter((t) => t.status !== "running");
  if (board.tasks.length === 0) return "";

  const lines: string[] = [
    `📋 **任務進度** ｜ ${running.length} 進行中 ｜ ${finished.length} 已完成`,
    "────────────────────────",
  ];

  for (const t of running) {
    lines.push(
      `🔄 \`${t.taskId}\` ${t.summary} (${modelLabel(t.model)}) — ${elapsedStr(Date.now() - t.startedAt)}`
    );
  }
  for (const t of finished) {
    const icon = t.status === "done" ? "✅" : t.status === "aborted" ? "🚫" : "❌";
    const dur  = t.endedAt ? elapsedStr(t.endedAt - t.startedAt) : "?";
    lines.push(`${icon} \`${t.taskId}\` ${t.summary} (${modelLabel(t.model)}) — ${dur}`);
  }

  const ts = new Date().toLocaleTimeString("zh-TW", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  lines.push(`\n*更新：${ts}*`);
  return lines.join("\n");
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default function register(api: any) {
  const cfg: ReceptionistConfig = api.pluginConfig ?? {};

  const HAIKU_MODEL    = cfg.haikuModel  ?? DEFAULT_HAIKU_MODEL;
  const SONNET_MODEL   = cfg.sonnetModel ?? DEFAULT_SONNET_MODEL;
  const OPUS_MODEL     = cfg.opusModel   ?? DEFAULT_OPUS_MODEL;
  const STATUS_INTERVAL = cfg.statusUpdateIntervalMs ?? DEFAULT_STATUS_INTERVAL_MS;
  const BOARD_TTL       = cfg.boardTtlMs ?? DEFAULT_BOARD_TTL_MS;

  // boards: mainSessionKey → ChannelBoard
  const boards = new Map<string, ChannelBoard>();
  // workerSessionKey → model  (for before_agent_start model override)
  const workerModel = new Map<string, string>();
  // accountId per Discord channel (stored from message_received)
  const channelAccountId = new Map<string, string>(); // discordChannelId → accountId

  // ── Board helpers ──────────────────────────────────────────────────────────

  function getOrCreateBoard(
    mainSessionKey: string,
    discordChannelId: string,
    accountId: string
  ): ChannelBoard {
    if (!boards.has(mainSessionKey)) {
      boards.set(mainSessionKey, {
        mainSessionKey,
        discordChannelId,
        accountId,
        tasks: [],
      });
    }
    return boards.get(mainSessionKey)!;
  }

  async function sendOrEditBoard(board: ChannelBoard): Promise<void> {
    const text = buildBoardText(board);
    if (!text) return;

    try {
      if (board.statusMessageId && board.statusChannelId) {
        // Edit existing status message
        await editDiscordMessage(
          board.statusChannelId,
          board.statusMessageId,
          text,
          board.accountId
        );
      } else {
        // Send new status message
        const result = await api.runtime.channel.discord.sendMessageDiscord(
          board.discordChannelId,
          text,
          { cfg: api.config, accountId: board.accountId }
        );
        board.statusMessageId  = result.messageId;
        board.statusChannelId  = result.channelId;
      }
    } catch (err) {
      api.logger.warn(`receptionist: board update failed: ${err}`);
    }
  }

  /** Edit a Discord message via REST (editMessageDiscord mirrors same opts pattern) */
  async function editDiscordMessage(
    channelId: string,
    messageId: string,
    content: string,
    accountId: string
  ): Promise<void> {
    // Lazy-import editMessageDiscord from openclaw's discord send module
    // Both sendMessageDiscord and editMessageDiscord share the same REST client
    try {
      const mod = await import(
        /* @vite-ignore */
        "openclaw/dist/plugin-sdk/discord/send.messages.js" as string
      );
      await mod.editMessageDiscord(
        channelId,
        messageId,
        { content },
        { cfg: api.config, accountId }
      );
    } catch {
      // Fallback: raw Discord REST
      const token = resolveDiscordToken(accountId);
      if (!token) return;
      await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
      });
    }
  }

  function resolveDiscordToken(accountId: string): string | undefined {
    const d = (api.config as any)?.discord;
    if (!d) return undefined;
    if (d.token) return d.token;
    return (
      d.accounts?.[accountId]?.token ??
      d.accounts?.["default"]?.token ??
      d.accounts?.["main"]?.token
    );
  }

  function startTimer(board: ChannelBoard): void {
    if (board.timerHandle) return;
    board.timerHandle = setInterval(async () => {
      const hasRunning = board.tasks.some((t) => t.status === "running");
      if (!hasRunning) { stopTimer(board); return; }
      await sendOrEditBoard(board).catch(() => {});
    }, STATUS_INTERVAL);
  }

  function stopTimer(board: ChannelBoard): void {
    if (board.timerHandle) {
      clearInterval(board.timerHandle);
      board.timerHandle = undefined;
    }
  }

  function scheduleCleanup(board: ChannelBoard): void {
    setTimeout(() => {
      board.tasks = board.tasks.filter((t) => t.status === "running");
      board.statusMessageId = undefined;
      board.statusChannelId = undefined;
    }, BOARD_TTL);
  }

  function modelForRoute(route: RouteTarget | undefined): string {
    if (route === "opus")   return OPUS_MODEL;
    if (route === "sonnet") return SONNET_MODEL;
    return HAIKU_MODEL;
  }

  // ── Hook: capture accountId from inbound message ───────────────────────────

  api.on("message_received", (_event: any, ctx: any) => {
    if (ctx.channelId === "discord" && ctx.conversationId && ctx.accountId) {
      channelAccountId.set(ctx.conversationId, ctx.accountId);
    }
  });

  // ── Hook: before_agent_start — set model ──────────────────────────────────

  api.on("before_agent_start", (_event: any, ctx: any) => {
    const sessionKey = ctx.sessionKey ?? "";

    // Worker session: override to stored model
    if (isWorkerSession(sessionKey)) {
      const model = workerModel.get(sessionKey);
      return model ? { modelOverride: model } : undefined;
    }

    // Only intercept Discord main sessions — leave heartbeat/cron/other runs alone
    const discordInfo = parseDiscordFromSessionKey(sessionKey);
    if (!discordInfo) return undefined;

    // Main Discord session: receptionist (Haiku) + inject system context
    const board = boards.get(sessionKey);
    const activeTasks = board?.tasks.filter((t) => t.status === "running") ?? [];

    return {
      modelOverride: HAIKU_MODEL,
      appendSystemContext: buildReceptionistPrompt(activeTasks),
    };
  });

  // ── Hook: agent_end — parse tags, dispatch worker ─────────────────────────

  api.on("agent_end", async (event: any, ctx: any) => {
    const sessionKey = ctx.sessionKey ?? "";
    if (isWorkerSession(sessionKey)) return;  // worker session end, skip

    // Must be a Discord main session
    const discordParsed = parseDiscordFromSessionKey(sessionKey);
    if (!discordParsed) return;

    const { discordChannelId } = discordParsed;
    const accountId = channelAccountId.get(discordChannelId) ?? "default";

    const board = getOrCreateBoard(sessionKey, discordChannelId, accountId);

    // Extract last assistant message (receptionist response)
    const messages: any[] = event.messages ?? [];
    let assistantText = "";
    let lastUserText  = "";

    for (let i = messages.length - 1; i >= 0; i--) {
      const role = messages[i].role ?? messages[i].type ?? "";
      if (!assistantText && role === "assistant") {
        assistantText = extractText(messages[i].content);
      } else if (assistantText && role === "user") {
        lastUserText = extractText(messages[i].content);
        break;
      }
    }

    if (!assistantText) return;

    const parsed = parseRoutingTags(assistantText);
    const { abortTaskId, summary } = parsed;
    // If model forgot routing tags, default to sonnet (don't silently drop the request)
    const route: RouteTarget = parsed.route ?? "sonnet";

    // ── Abort existing task ────────────────────────────────────────────────
    let mergedContext = "";
    if (abortTaskId) {
      const oldTask = board.tasks.find(
        (t) => t.taskId === abortTaskId && t.status === "running"
      );
      if (oldTask) {
        try {
          const history = await api.runtime.subagent.getSessionMessages({
            sessionKey: oldTask.workerSessionKey,
            limit: 6,
          });
          const partialMsgs: any[] = history.messages ?? [];
          mergedContext = partialMsgs
            .filter((m: any) => (m.role === "assistant" || m.role === "user"))
            .slice(-4)
            .map((m: any) => `[${m.role}] ${extractText(m.content).slice(0, 300)}`)
            .join("\n");
        } catch {
          // getSessionMessages failed — proceed without context
        }

        try {
          await api.runtime.subagent.deleteSession({
            sessionKey: oldTask.workerSessionKey,
            deleteTranscript: false,
          });
        } catch (err) {
          api.logger.warn(`receptionist: delete session failed: ${err}`);
        }

        oldTask.status   = "aborted";
        oldTask.endedAt  = Date.now();
        api.logger.info(`receptionist: aborted task ${abortTaskId}`);
      }
    }

    // Haiku handles it directly (no worker needed) — only when explicitly routed to haiku
    if (route === "haiku") {
      if (board.tasks.some((t) => t.status === "running")) {
        await sendOrEditBoard(board);
      }
      return;
    }

    // ── Spawn worker ───────────────────────────────────────────────────────
    const taskId        = genTaskId();
    const model         = modelForRoute(route);
    const wSessionKey   = makeWorkerSessionKey(sessionKey, taskId);

    const workerMessage = mergedContext
      ? `[前任務部分內容（已中止）]\n${mergedContext}\n\n---\n[新任務]\n${lastUserText}`
      : lastUserText;

    if (!workerMessage.trim()) {
      api.logger.warn(`receptionist: empty worker message, skipping dispatch`);
      return;
    }

    workerModel.set(wSessionKey, model);

    const task: TaskEntry = {
      taskId,
      workerSessionKey: wSessionKey,
      summary,
      model,
      startedAt: Date.now(),
      status:    "running",
    };
    board.tasks.push(task);

    try {
      const result = await api.runtime.subagent.run({
        sessionKey: wSessionKey,
        message:    workerMessage,
        deliver:    true,
      });
      task.runId = result.runId;
      api.logger.info(
        `receptionist: dispatched ${taskId} → ${model} (runId=${result.runId})`
      );
    } catch (err) {
      task.status  = "error";
      task.endedAt = Date.now();
      api.logger.error(`receptionist: subagent.run failed: ${err}`);
    }

    await sendOrEditBoard(board);
    startTimer(board);
  });

  // ── Hook: subagent_ended — mark task done, update board ───────────────────

  api.on("subagent_ended", async (event: any, ctx: any) => {
    const workerKey = ctx.childSessionKey ?? event.targetSessionKey ?? "";
    if (!isWorkerSession(workerKey)) return;

    const mainKey = mainSessionFromWorker(workerKey);
    const board   = boards.get(mainKey);
    if (!board) return;

    const task = board.tasks.find((t) => t.workerSessionKey === workerKey);
    if (!task) return;

    const outcome  = event.outcome ?? "ok";
    task.status    = outcome === "ok" ? "done" : "error";
    task.endedAt   = Date.now();

    api.logger.info(
      `receptionist: task ${task.taskId} ${task.status} (${elapsedStr(task.endedAt - task.startedAt)})`
    );

    workerModel.delete(workerKey);
    await sendOrEditBoard(board);

    const hasRunning = board.tasks.some((t) => t.status === "running");
    if (!hasRunning) {
      stopTimer(board);
      scheduleCleanup(board);
    }
  });

  api.logger.info("receptionist: registered (Haiku gateway + independent worker sessions)");
}
