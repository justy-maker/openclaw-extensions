// ============================================================================
// Receptionist Plugin
//
// 架構：
//   接線生（分類器）→ qwen2.5:14b，快速分類意圖，不執行任務
//   Worker Session  → 依路由派發不同模型：
//     local  → qwen3.5:27b（本地，免費，日常任務預設）
//     haiku  → claude-haiku（Anthropic，簡單但需 Claude 品質）
//     sonnet → claude-sonnet（Anthropic，複雜任務）
//     opus   → claude-opus（Anthropic，深度研究）
//
// 用戶可在訊息中加 @local/@haiku/@sonnet/@opus 強制指定 worker
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
  receptionistModel?: string;
  localModel?: string;
  haikuModel?: string;
  sonnetModel?: string;
  opusModel?: string;
  statusUpdateIntervalMs?: number;
  boardTtlMs?: number;
}

type TaskStatus = "running" | "done" | "error" | "aborted";
type RouteTarget = "local" | "haiku" | "sonnet" | "opus";

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
  discordSessionType: "channel" | "direct" | "group";
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

const DEFAULT_RECEPTIONIST_MODEL = "qwen2.5:14b";
const DEFAULT_LOCAL_MODEL        = "qwen3.5:27b";
const DEFAULT_HAIKU_MODEL        = "claude-haiku-4-5-20251001";
const DEFAULT_SONNET_MODEL       = "claude-sonnet-4-6";
const DEFAULT_OPUS_MODEL         = "claude-opus-4-6";
const DEFAULT_STATUS_INTERVAL_MS = 20_000;
const DEFAULT_BOARD_TTL_MS       = 5 * 60_000;

const WORKER_PREFIX = "worker:";

// ── System Prompt ─────────────────────────────────────────────────────────────

function buildReceptionistPrompt(activeTasks: TaskEntry[]): string {
  const taskList =
    activeTasks.length === 0
      ? "（目前無進行中的任務）"
      : activeTasks
          .map((t) => {
            const elapsed = Math.floor((Date.now() - t.startedAt) / 1000);
            const label = modelLabel(t.model);
            return `- [${t.taskId}] ${t.summary}（${label}，已執行 ${elapsed}s）`;
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
新任務：[SUMMARY:10字內描述][ROUTE:local|haiku|sonnet|opus]
中止並重建：[ABORT:taskId][SUMMARY:任務描述][ROUTE:local|haiku|sonnet|opus]

## 路由規則（重要）
- local  → **預設**：所有日常任務、查詢、系統管理、程式、除錯（使用本地 Qwen 模型）
- haiku  → 用戶明確標記 @haiku，或需要 Claude 品質的簡單問答、翻譯、格式化
- sonnet → 用戶明確標記 @sonnet，或複雜分析、高品質創作、多步驟規劃（Claude Sonnet）
- opus   → 用戶明確標記 @opus，或深度研究、策略規劃、最高難度推理（Claude Opus）

## 用戶路由指定（最高優先）
若用戶訊息包含 @local / @haiku / @sonnet / @opus，**必須**使用對應路由，不得自行判斷覆蓋。

## 範例
用戶：「你好」→ [SUMMARY:打招呼][ROUTE:local]
用戶：「檢查 cron jobs」→ [SUMMARY:檢查cron狀態][ROUTE:local]
用戶：「@haiku 幫我翻譯這段文字」→ [SUMMARY:翻譯文字][ROUTE:haiku]
用戶：「@sonnet 分析這個架構」→ [SUMMARY:架構分析][ROUTE:sonnet]`;
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
  const routeM   = lastLine.match(/\[ROUTE:(local|haiku|sonnet|opus)\]/i);
  return {
    abortTaskId: abortM?.[1]?.trim(),
    summary:     summaryM?.[1]?.trim() ?? "任務",
    route:       (routeM?.[1]?.toLowerCase() as RouteTarget) ?? undefined,
  };
}

/** 從用戶原始訊息提取 @local/@haiku/@sonnet/@opus 強制路由指定 */
function parseUserRouteTag(userText: string): RouteTarget | undefined {
  const m = userText.match(/@(local|haiku|sonnet|opus)\b/i);
  return m ? (m[1].toLowerCase() as RouteTarget) : undefined;
}

function elapsedStr(ms: number): string {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

function modelLabel(model: string): string {
  if (model.includes("opus"))   return "Opus";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("haiku"))  return "Haiku";
  if (model.includes("qwen3.5:27b")) return "Local";
  if (model.includes("coder"))  return "Local";
  return "Local";
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

  const RECEPTIONIST_MODEL = cfg.receptionistModel ?? DEFAULT_RECEPTIONIST_MODEL;
  const LOCAL_MODEL        = cfg.localModel  ?? DEFAULT_LOCAL_MODEL;
  const HAIKU_MODEL        = cfg.haikuModel  ?? DEFAULT_HAIKU_MODEL;
  const SONNET_MODEL       = cfg.sonnetModel ?? DEFAULT_SONNET_MODEL;
  const OPUS_MODEL         = cfg.opusModel   ?? DEFAULT_OPUS_MODEL;
  const STATUS_INTERVAL    = cfg.statusUpdateIntervalMs ?? DEFAULT_STATUS_INTERVAL_MS;
  const BOARD_TTL          = cfg.boardTtlMs ?? DEFAULT_BOARD_TTL_MS;

  // boards: mainSessionKey → ChannelBoard
  const boards = new Map<string, ChannelBoard>();
  // taskId (lowercase) → model  (OpenClaw transforms session key; identify by task suffix)
  const workerModelByTaskId = new Map<string, string>();
  // taskId (lowercase) → { boardKey, workerSessionKey }  (for subagent_ended lookup)
  const workerTaskInfo = new Map<string, { boardKey: string; workerSessionKey: string }>();
  // accountId per Discord channel (stored from message_received)
  const channelAccountId = new Map<string, string>(); // discordChannelId → accountId

  // ── Board helpers ──────────────────────────────────────────────────────────

  function getOrCreateBoard(
    mainSessionKey: string,
    discordChannelId: string,
    discordSessionType: "channel" | "direct" | "group",
    accountId: string
  ): ChannelBoard {
    if (!boards.has(mainSessionKey)) {
      boards.set(mainSessionKey, {
        mainSessionKey,
        discordChannelId,
        discordSessionType,
        accountId,
        tasks: [],
      });
    }
    return boards.get(mainSessionKey)!;
  }

  /** Build Discord recipient string based on session type */
  function discordRecipient(board: ChannelBoard): string {
    return board.discordSessionType === "direct"
      ? `user:${board.discordChannelId}`
      : `channel:${board.discordChannelId}`;
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
          discordRecipient(board),
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
    if (route === "haiku")  return HAIKU_MODEL;
    return LOCAL_MODEL;  // "local" or undefined → qwen3.5:27b
  }

  // ── Hook: capture accountId from inbound message ───────────────────────────

  api.on("message_received", (_event: any, ctx: any) => {
    if (ctx.channelId === "discord" && ctx.conversationId && ctx.accountId) {
      channelAccountId.set(ctx.conversationId, ctx.accountId);
    }
  });

  // ── Worker identification helpers ─────────────────────────────────────────

  /** OpenClaw may transform our session key: strip 'worker:' prefix + lowercase.
   *  Identify workers by checking if the session ends with a known task ID. */
  function findWorkerModel(sessionKey: string): string | undefined {
    const lower = sessionKey.toLowerCase();
    for (const [taskId, model] of workerModelByTaskId) {
      if (lower.endsWith(`:${taskId}`)) return model;
    }
    return undefined;
  }

  function findWorkerTask(sessionKey: string): { boardKey: string; workerSessionKey: string } | undefined {
    const lower = sessionKey.toLowerCase();
    for (const [taskId, info] of workerTaskInfo) {
      if (lower.endsWith(`:${taskId}`)) return info;
    }
    return undefined;
  }

  // ── Hook: before_agent_start — set model ──────────────────────────────────

  api.on("before_agent_start", (_event: any, ctx: any) => {
    const sessionKey = ctx.sessionKey ?? "";

    // Worker session: override to the registered worker model
    const workerMod = findWorkerModel(sessionKey);
    if (workerMod !== undefined) {
      api.logger.info(`receptionist: worker session ${sessionKey} → model ${workerMod}`);
      return { modelOverride: workerMod };
    }

    // Only intercept Discord main sessions — leave heartbeat/cron/other runs alone
    const discordInfo = parseDiscordFromSessionKey(sessionKey);
    if (!discordInfo) return undefined;

    // Skip sessions that look like sub-sessions (main session keys end with a task ID suffix)
    // e.g. agent:main:discord:direct:123:t9vnf — the :t9vnf suffix means it's a worker
    const parts = sessionKey.split(":");
    if (parts.length > 5) return undefined;  // more segments than a normal session key

    // Main Discord session: receptionist (Haiku) + inject system context
    const board = boards.get(sessionKey);
    const activeTasks = board?.tasks.filter((t) => t.status === "running") ?? [];

    return {
      modelOverride: RECEPTIONIST_MODEL,
      appendSystemContext: buildReceptionistPrompt(activeTasks),
    };
  });

  // ── Hook: agent_end — parse tags, dispatch worker ─────────────────────────

  api.on("agent_end", async (event: any, ctx: any) => {
    const sessionKey = ctx.sessionKey ?? "";
    if (isWorkerSession(sessionKey) || findWorkerTask(sessionKey)) return;  // worker end, skip

    // Must be a Discord main session
    const discordParsed = parseDiscordFromSessionKey(sessionKey);
    if (!discordParsed) return;

    const { discordChannelId } = discordParsed;
    const accountId = channelAccountId.get(discordChannelId) ?? "default";

    const board = getOrCreateBoard(sessionKey, discordChannelId, discordParsed.type as "channel" | "direct" | "group", accountId);

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
    // User @tag takes priority over receptionist's auto-routing
    const userRoute = parseUserRouteTag(lastUserText);
    // If model forgot routing tags, default to local (don't silently drop the request)
    const route: RouteTarget = userRoute ?? parsed.route ?? "local";

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

    workerModelByTaskId.set(taskId.toLowerCase(), model);
    workerTaskInfo.set(taskId.toLowerCase(), { boardKey: sessionKey, workerSessionKey: wSessionKey });

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
        sessionKey:     wSessionKey,
        message:        workerMessage,
        deliver:        true,
        idempotencyKey: taskId,
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

    // OpenClaw may transform the worker session key (strip 'worker:' + lowercase).
    // Use task-ID suffix matching instead of direct key comparison.
    const taskInfo = findWorkerTask(workerKey);
    if (!taskInfo) return;

    const board = boards.get(taskInfo.boardKey);
    if (!board) return;

    // Find the task by matching either the original or transformed session key
    const lowerWorkerKey = workerKey.toLowerCase();
    const task = board.tasks.find((t) => {
      const lowerStored = t.workerSessionKey.toLowerCase();
      // Match by suffix: both keys should end with :taskId
      return lowerWorkerKey.endsWith(`:${t.taskId.toLowerCase()}`) ||
             lowerStored === lowerWorkerKey;
    });
    if (!task) return;

    const outcome  = event.outcome ?? "ok";
    task.status    = outcome === "ok" ? "done" : "error";
    task.endedAt   = Date.now();

    api.logger.info(
      `receptionist: task ${task.taskId} ${task.status} (${elapsedStr(task.endedAt - task.startedAt)})`
    );

    workerModelByTaskId.delete(task.taskId.toLowerCase());
    workerTaskInfo.delete(task.taskId.toLowerCase());
    await sendOrEditBoard(board);

    const hasRunning = board.tasks.some((t) => t.status === "running");
    if (!hasRunning) {
      stopTimer(board);
      scheduleCleanup(board);
    }
  });

  api.logger.info("receptionist: registered (Haiku gateway + independent worker sessions)");
}
