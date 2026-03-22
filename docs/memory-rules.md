# 記憶系統使用規則

## 架構概覽

```
L0  即時上下文          本次對話（自動）
L1  短期記憶            memory/YYYY-MM-DD.md（session 開始注入今+昨）
L2  長期記憶            LanceDB（每晚 21:00 批次寫入）
L3  頻道記憶            memory/channels/{頻道}.md（隔離存儲）
L4  系統檔案            SOUL.md / USER.md / AGENTS.md（session 開始讀取）
```

## memory_recall（查詢）

**頻道隔離原則**：在特定頻道查詢時，優先搜尋該頻道主題相關關鍵字。

**跨域搜尋例外**（須先聲明）：
1. 用戶明確要求「查其他領域」
2. 當前主題確實需要其他領域知識

**鐵律**：避免「串台」— 不在量化頻道談產品規劃，不在策略室談交易系統。

## memory_store（寫入）

**時機**：
- 白天：每個主題完成 → 先寫 `memory/YYYY-MM-DD.md`（輕量、文字）
- 每晚 21:00：Sonnet cron job 自動分析當日筆記 → 提煉 → 批次寫入 LanceDB
- 不即時呼叫 `memory_store`（避免每條對話都觸發 embedding）

**Scope 設定**（依頻道自動對應）：
```
#策略室         → scope="strategy"
#理財-量化      → scope="quant"
#程式           → scope="engineering"
#高中教育       → scope="education"
```

## 生命週期

- Importance score 隨時間衰減（預設 30 天 half-life）
- 30 天無訪問 → 自動降為 peripheral tier
- 月底自動歸檔：`memory/archive/YYYY-QX.jsonl`
- 人工激活重要記憶：`memory_update(importance=0.9)`

## 安裝需求

### LanceDB 本體
memory-lancedb-pro 安裝時會自動處理 Node.js 依賴，**但需要確認以下項目**：

```bash
# 1. Embedding 模型（必要）
# 在 ollama 主機上執行：
ollama pull nomic-embed-text

# 2. LanceDB 資料庫目錄（自動建立，確認磁碟空間足夠）
# 預設路徑：~/.openclaw/memory/lancedb-pro
# 建議預留至少 2GB

# 3. 確認 embedding 服務可連線
curl http://YOUR_OLLAMA_HOST:11434/v1/models | grep nomic
```

### openclaw.json 設定重點
```json
"memory-lancedb-pro": {
  "config": {
    "embedding": {
      "provider": "openai-compatible",
      "apiKey": "ollama",
      "model": "nomic-embed-text",
      "baseURL": "http://YOUR_OLLAMA_HOST:11434/v1",
      "dimensions": 768
    },
    "autoCapture": true,
    "autoRecall": true,
    "sessionStrategy": "memoryReflection"
  }
}
```
