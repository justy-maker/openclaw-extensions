---
name: three-brain
description: 三腦會議 — 同時諮詢 Claude、Gemini、GPT，整合三方觀點。用於策略討論、產品規劃、市場分析等需要多元觀點的議題。
metadata:
  openclaw:
    emoji: "🧠"
    requires:
      bins: ["gemini"]
      envKeys: ["OPENAI_API_KEY"]
---

# 三腦會議 Skill（Three-Brain Meeting）

## 概念
同一個問題同時問三個 AI 模型，收集不同觀點，找出共識與分歧，整合出最終建議。

- **Claude（主持人）** — 你自己，負責出題、整合、最終決策
- **Gemini** — 透過 Gemini CLI 呼叫
- **GPT** — 透過 OpenAI API 呼叫

## 使用方式

### Step 1：準備問題
設計一個清晰的策略問題，包含：
- 背景（Context）
- 具體問題（Question）
- 期望輸出格式（Format）

### Step 2：同時諮詢 Gemini 和 GPT
用以下腳本同時呼叫兩個模型：

```bash
# GPT（透過 scripts/ask-gpt.sh）
bash SKILL_DIR/scripts/ask-gpt.sh "你的問題" > /tmp/three-brain-gpt.md &

# Gemini（透過 CLI）
gemini "你的問題" > /tmp/three-brain-gemini.md &

# 等待兩個都完成
wait
```

或用 Python 腳本一次搞定：
```bash
python3 SKILL_DIR/scripts/three_brain.py --question "你的問題" --context "背景資料"
```

### Step 3：整合
讀取三方結果，產出比較表：

```markdown
## 🧠 三腦會議結果

### 議題：[問題]

| 面向 | Claude | Gemini | GPT |
|------|--------|--------|-----|
| 核心觀點 | ... | ... | ... |
| 建議方案 | ... | ... | ... |
| 風險提醒 | ... | ... | ... |

### ✅ 共識
- ...

### ⚡ 分歧
- ...

### 📋 整合建議
- ...
```

### Step 4：呈報決策者
將整合結果呈報給軒哥，等待拍板。

## 角色模式

三腦會議可指定角色模式，在問題前加上角色 prompt：

| 模式 | 說明 | 用於 |
|------|------|------|
| `strategist` | 產品策略思考 | Product Strategist 角色 |
| `marketer` | 行銷與成長策略 | Marketing Strategist 角色 |
| `critic` | 專門找漏洞和反對 | Critic 角色 |
| `analyst` | 數據分析與驗證 | Data Analyst 角色 |
| `open` | 無特定角色，自由回答 | 一般討論 |

## 注意事項
- GPT 呼叫需要 `OPENAI_API_KEY`（在 `~/.openclaw/.env`）
- Gemini 需要 `gemini` CLI 已安裝且認證
- 每次三腦會議約消耗 3 個模型的 token，注意成本
- 複雜議題建議拆成多個小問題分別開會
