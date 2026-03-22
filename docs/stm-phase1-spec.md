# STM Phase 1 修改規格

## 背景

conversation-logger 目前只做 Layer 0 忠實記錄（JSONL），
沒有任何 session 長度控管機制。

實際觀察到的問題：
- Session 無上限增長，最大案例：2.7MB / 1249 records
- OpenClaw 內建 compaction 被 safeguard 取消（sessions 裡多為 tool call，無真實對話訊息）
- Context 超載 → `InteractionEventListener timed out (120s)` → gateway 假死

STM Phase 1 的目標：**最小實作，在不改動 openclaw 核心的前提下，透過告警讓用戶主動重置 session。**

---

## 修改範圍

**只修改一個檔案：**
`extensions/conversation-logger/index.ts`

---

## 新增功能

### 1. STM 狀態管理（per-channel）

**狀態檔位置：**
```
~/.openclaw/stm/{sanitizedChannelId}.json
```

**狀態檔格式：**
```json
{
  "turns": 12,
  "lastActivityTs": 1774171212000
}
```

- `turns`：已完成的回合數（1 user + 1 agent = 1 turn）
- `lastActivityTs`：最後一筆活動的 timestamp（ms）

**重置條件（任一即觸發）：**
1. 訊息內容為 `/reset` 或 `/new`（包含這些字串）
2. 距離上次活動超過 `stmIdleMinutes`（預設 120 分鐘）

重置時：`turns` 歸零，`lastActivityTs` 更新。

---

### 2. 告警邏輯

在 `message_received` hook 檢查 turn count，依閾值調整行為：

| 狀態 | 條件 | 行為 |
|------|------|------|
| 正常 | `turns < stmWarnTurns` | 無動作 |
| 軟警告 | `stmWarnTurns ≤ turns < stmHardTurns` | 在訊息末尾注入警告前綴 |
| 硬限制 | `turns ≥ stmHardTurns` | 拒絕訊息，要求 /reset |

**軟警告注入格式（加在訊息最前方，讓 agent 感知）：**
```
[⚠️ STM 提醒：本 session 已進行 {N} 輪，建議執行 /reset 開新 session 以維持效能。]

{原始訊息}
```

**硬限制拒絕訊息（回傳給用戶）：**
```
⛔ Session 已達 {N} 輪上限（最大 {stmHardTurns} 輪）。

請執行以下指令重置：
  /reset   — 重置當前 session（保留記憶）
  /new     — 開新 session

重置後記憶系統（LanceDB）會自動保留重要資訊。
```

---

### 3. Turn 計數時機

- **+1 turn**：在 `before_message_write` hook 確認 agent 完整回覆後
  （確保 user → agent 配對完成才計數，避免重複或遺漏）

---

## 新增設定參數

在 `openclaw.json` 的 `conversation-logger` config 區塊新增：

| 參數 | 預設值 | 說明 |
|------|--------|------|
| `stmDir` | `~/.openclaw/stm` | STM 狀態檔目錄 |
| `stmWarnTurns` | `15` | 軟警告閾值（turn 數） |
| `stmHardTurns` | `25` | 硬限制閾值（turn 數） |
| `stmIdleMinutes` | `120` | 閒置多久視為新 session（分鐘） |

已存在參數不變：
- `logDir`：JSONL 記錄目錄
- `stmMaxChars`：單筆訊息最大字元數

---

## 不修改的部分

- Layer 0 JSONL 記錄邏輯：完全不動
- `pendingQueue` 機制：完全不動
- smart-router：不涉及
- openclaw.json 其他區塊：不涉及

---

## 檔案異動清單

| 檔案 | 動作 | 說明 |
|------|------|------|
| `extensions/conversation-logger/index.ts` | 修改 | 加入 STM 狀態管理 + 告警邏輯 |
| `config/openclaw.json.template` | 修改 | 新增 stmDir / stmWarnTurns / stmHardTurns / stmIdleMinutes |
| `docs/stm-phase1-spec.md` | 新增 | 本文件 |

---

## 驗證方式（實作完成後）

1. Gateway restart，確認 log 無錯誤
2. 在 Discord 對話 15 輪，確認第 15 輪回覆前有 `[⚠️ STM 提醒]` 前綴
3. 繼續對話至 25 輪，確認訊息被拒絕並顯示操作說明
4. 執行 `/reset`，確認 STM 狀態檔 turns 歸零
5. 閒置 2 小時（或手動修改 lastActivityTs），確認自動歸零

---

## 後續（Phase 2，本次不做）

- STM 窗口內容摘要：從 JSONL 讀取最近 N 筆，生成壓縮摘要注入 context
- 由 Haiku subagent 生成摘要（品質提升）
