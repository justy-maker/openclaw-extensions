---
name: strategy-meeting
description: MeowCloud 策略會議 — 多角色 Agent 從不同專業角度分析議題，產出多元觀點與決策建議。
metadata:
  openclaw:
    emoji: "🏢"
    requires:
      bins: ["gemini"]
      envKeys: ["OPENAI_API_KEY"]
---

# 策略會議 Skill（Strategy Meeting）

## 概念
模擬公司高管會議：每個 C-level 角色由不同 AI 模型擔任，從各自專業角度分析同一議題。支援角色記憶、角色間對話反駁、會議紀錄自動歸檔。

## 角色 × 模型配對（可在 config.json 調整）

| 角色 | 代號 | 模型 | 專注面向 |
|------|------|------|----------|
| 🐱 CEO | ceo | Claude | 策略整合、最終決策 |
| 🔧 CTO | cto | Claude | 技術可行性、架構、風險 |
| 📣 CMO | cmo | Gemini | 市場機會、行銷策略、用戶增長 |
| 💰 CFO | cfo | GPT | 成本效益、財務模型、ROI |
| 🎨 CDO | cdo | Gemini | UX/UI、用戶體驗、品牌 |
| 💼 CSO | cso | GPT | 銷售策略、客戶關係、定價 |
| 🎧 CCO | cco | Claude | 客戶支援、FAQ、回饋循環 |

角色名稱、Prompt、模型配對都可以自訂。編輯 `config.json` 和 `roles/*.md` 即可。

## 使用方式

### 觸發方式
在任何 Discord 頻道對 agent 說：
> 「開個策略會議，議題是 XXX」
> 「用 CTO 和 CFO 的角度分析 XXX」

Agent 會自動：
1. 解析議題與需要的角色
2. 執行 `strategy_meeting.py` 收集 Gemini/GPT 觀點
3. 以 Claude 角色補完 + CEO 彙整
4. 自動歸檔會議紀錄
5. 貼回 Discord

### CLI 直接使用
```bash
# MVP 三角色
python3 SKILL_DIR/scripts/strategy_meeting.py \
  -q "議題" -c "背景" -r cto,cmo,cfo

# 全員
python3 SKILL_DIR/scripts/strategy_meeting.py \
  -q "議題" -r all

# 指定輸出
python3 SKILL_DIR/scripts/strategy_meeting.py \
  -q "議題" -r cto,cfo -o /tmp/meeting.md
```

## 四大功能

### Phase 1 — 文字會議 ✅
基本多角色諮詢 + CEO 彙整。

### Phase 2 — 角色記憶
每個角色記住過去的決策，不會自相矛盾。
- 記憶檔：`memory/roles/<role_key>.md`
- 每次會議後自動追加該角色的觀點摘要
- 下次開會時自動注入歷史決策作為 context

### Phase 3 — 角色間對話
第一輪各自發言後，進入反駁輪：
- 每個角色讀取其他人的觀點
- 針對分歧點提出反駁或補充
- 最多 2 輪對話，避免無限迴圈

### Phase 4 — 會議歸檔
自動儲存到 `meetings/YYYY-MM-DD-<slug>.md`，包含：
- 議題、背景、與會者
- 各角色觀點全文
- CEO 彙整決策
- 行動項目（可追溯）

## 可移植性
整個 `strategy-meeting/` 資料夾可複製到任何 OpenClaw workspace：
1. 複製資料夾到 `skills/strategy-meeting/`
2. 確保有 `gemini` CLI 和 `OPENAI_API_KEY`
3. 編輯 `config.json` 自訂角色名稱和模型配對
4. 開始使用

## 檔案結構
```
strategy-meeting/
├── SKILL.md              # 本文件
├── config.json           # 角色×模型配對
├── roles/                # 角色 Prompt（可自訂）
│   ├── ceo.md  cto.md  cmo.md  cfo.md
│   ├── cdo.md  cso.md  cco.md
├── scripts/
│   └── strategy_meeting.py   # 主腳本
├── meetings/             # 會議紀錄歸檔（自動產生）
└── memory/
    └── roles/            # 角色記憶（自動產生）
```
