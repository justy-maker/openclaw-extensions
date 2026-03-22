# openclaw-extensions

openclaw 的自訂 extension 套件，包含：

- **smart-router** — 依關鍵字自動路由至 Haiku / Sonnet / Opus
- **conversation-logger** — Layer 0 底層記錄 + STM 短期記憶告警

## 快速安裝

```bash
# 前提：已安裝 git, curl
git clone https://github.com/justy-maker/openclaw-extensions
cd openclaw-extensions
bash install.sh
```

安裝完成後，依照腳本提示填入必要設定，再啟動 gateway。

## Extensions 說明

### smart-router

根據訊息內容自動選擇模型：

| 觸發條件 | 路由目標 |
|----------|---------|
| 深度研究、策略、企劃、創意、@opus | Claude Opus |
| 架構、設計、除錯、重構、資安、@sonnet | Claude Sonnet |
| 其他（預設） | Claude Haiku |

手動覆蓋：在訊息開頭加 `@haiku` / `@sonnet` / `@opus`。

### conversation-logger

**Layer 0**：每筆對話以 JSONL 格式記錄於：

```
~/.openclaw/logs/conversations/channels/{channelId}/YYYY-MM-DD.jsonl
```

**STM 告警**（Phase 1）：

- 達到 `stmWarnTurns`（預設 15 輪）：回覆末尾注入提醒
- 達到 `stmHardTurns`（預設 25 輪）：拒絕訊息並要求 /reset

操作指令：
- `/reset` 或 `/new` — 重置 session（STM 計數器同步歸零）
- 超過 2 小時無活動 — 自動視為新 session

## 設定說明

安裝後需要手動編輯 `~/.openclaw/openclaw.json`：

```
YOUR_DISCORD_BOT_TOKEN   → Discord Bot Token
YOUR_GATEWAY_AUTH_TOKEN  → openssl rand -hex 24
YOUR_OLLAMA_HOST         → ollama 主機 IP
YOUR_EMBEDDING_API_KEY   → ollama 用 "ollama" 即可
```

## 記憶體分層架構

```
Layer 0  conversation-logger   底層 JSONL 忠實記錄
Layer 1  STM                   滑動視窗告警（含於 conversation-logger）
Layer 2  memory-lancedb-pro    向量長期記憶（外部 repo）
```
