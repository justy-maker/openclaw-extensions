# HEARTBEAT.md

---

### 🧠 思考輪（已移至獨立 Cron Job）

**Cron ID**: `08430b9c-c2fe-4fb5-84f2-bc0eb7c1d2d3`
**排程**: 每天 08/10/12/14/16/18/20 點整 (7 次/天)
**模型**: Opus (強制)
**詳細指令**: `projects/ah-fu-evolution/THINKING-LOOP-PROMPT.md`

**流程**: 思考 → 產 TODO → 派 subAgent → 結果回報 → 閉環
**產出位置**: 
- 思考記錄: `projects/ah-fu-evolution/THINKING.md`
- TODO: `projects/ah-fu-evolution/TODO.md`
- subAgent 回報: `projects/ah-fu-evolution/results/`

**Heartbeat 只需檢查**：思考輪 cron 是否正常運作（consecutiveErrors）

---

### 可主動做的事（不需要問軒哥）
- 讀 TODO.md，看有沒有能自動推進的項目
- 檢查 memory/ 和 MEMORY.md 是否需要整理
- 看看 research/youtube_summaries 有沒有待處理的影片
- git status 檢查是否有未 commit 的變更
- 檢查 disk space 和系統健康
- 檢查 task buffer 是否有待推進的項目

### 需要通知軒哥的事
- 排程異常
- 系統空間不足或異常
- Memory 系統異常
- 重要系統錯誤
- 💡 **思考輪產出重大洞察時，主動分享給軒哥**

### 安靜時段（23:00-07:00）
- 不主動通知，除非緊急
- 只做 HEARTBEAT_OK
- 思考輪照常運作，但不通知（累積到早上報告）
