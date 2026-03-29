# Changelog

## 維護記錄

---

### 2026-03-29 — .73 QEMU CPU AVX2 修復 + Gateway 恢復正常

**問題：** 重開機後 OpenClaw gateway 無法啟動，memory-lancedb-pro SIGILL crash

**根因：** QEMU VM CPU 型號為 `qemu64`（2.5+ 舊版），無 AVX2 指令集。
LanceDB native binary（`lancedb.linux-x64-gnu.node`，Rust 編譯）需要 AVX2，
開機後 cron missed job 觸發首次載入 → SIGILL。

**處理：**
- 暫時停用 memory-lancedb-pro，改用 `cron @reboot` + `start-openclaw.sh` 啟動 gateway
- 宿主機將 .73 VM CPU 改為 `host` 模式（開放 AVX/AVX2/AVX-512）
- 重啟後重新啟用 memory-lancedb-pro，確認正常

**新增系統檔：**
- `/home/ysi/start-openclaw.sh` — 開機啟動腳本（含 15s 等網路、nvm、OPENCLAW_NO_RESPAWN=1）
- `crontab @reboot /home/ysi/start-openclaw.sh`

**結果：** ✅ Gateway 正常，Discord 阿福_ 登入，memory-lancedb-pro 運行中

---

### 2026-03-29 — 磁碟 100% 清理 + journal 永久上限

**問題：** `/dev/sda2` 98G 全滿，無法寫入任何檔案

**根因：** `/var/log/journal` 4G + syslog ~1G（22 天未重開機累積）

**處理：**
```bash
journalctl --vacuum-time=7d     # 釋出 ~3.5G
journalctl --vacuum-size=500M
truncate -s 0 /var/log/syslog /var/log/syslog.1
```

**永久上限設定（`/etc/systemd/journald.conf.d/size-limit.conf`）：**
```ini
[Journal]
SystemMaxUse=500M
MaxRetentionSec=7day
```

**結果：** 可用空間 0 → 3.6G，後續不再發生

---

### 2026-03-22 — openclaw-extensions 倉庫建立 + STM Phase 1 部署

**新增：**
- GitHub repo `justy-maker/openclaw-extensions` 建立
- `smart-router` extension 部署至 .73
- `conversation-logger` STM Phase 1 部署至 .73
- `install.sh` 一鍵安裝腳本
- `cron/jobs.json` 含 5 個 cron job 範本
- `cron-config.json` delivery 接口集中設定（Discord ID 佔位符）

---

### 2026-03-18 — conversation-logger v1.0 建立

**功能：**
- Layer 0：每筆對話 JSONL 記錄（user + agent）
- hooks：`message_received` + `before_message_write`
- 儲存：`~/.openclaw/logs/conversations/channels/{source}-{channelId}/YYYY-MM-DD.jsonl`

---

### 2026-03-17 — smart-router bug 修復

**問題：** `Unknown model: anthropic/anthropic/claude-opus-4-6`（provider 前綴被加兩次）

**修正：** 移除 `providerOverride`，`modelOverride` 只傳 `"claude-opus-4-6"`（不含 provider 前綴）

---

### 2026-03-17 — smart-router v1.0 建立

**功能：** `before_model_resolve` hook，根據關鍵字自動路由：
- Opus：深度研究 / 策略 / 企劃 / 創意 / @opus
- Sonnet：架構 / 除錯 / 重構 / 資安 / @sonnet
- Haiku：預設（不 override）

---

### 2026-03-15 ~ 2026-03-16 — openclaw.json 重大設定更新

| 項目 | 變更 |
|------|------|
| contextTokens | 32000 → 65536 |
| contextPruning | `cache-ttl`, ttl=55m, keepLastAssistants=2 |
| cacheRetention | `"long"` 加入 Sonnet/Opus params |
| embedding | nomic-embed-text via Ollama (.50:11434) |
| browser.executablePath | snap Chromium → `/usr/bin/google-chrome-stable` |
| Cron job | channel-memory-sync（每晚 23:00） |

---

### 2026-03-14 — 一鍵還原基礎建設（`_setup/`）

建立 `~/.openclaw/workspace/_setup/`：
- `install.sh`、`openclaw.json.template`、`.env.template`
- `cron/jobs.json`、`openclaw-gateway.service`
- 推送至 GitHub `justy-maker/openclaw-workspace`
