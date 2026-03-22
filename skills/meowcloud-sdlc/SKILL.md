---
name: meowcloud-sdlc
description: MeowCloud 完整軟體開發生命週期（SDLC）流程。當需要啟動新專案、執行開發迭代、建立 PR/Code Review 流程、或管理從需求到部署的完整開發週期時使用。涵蓋：(1) 需求收集與 Issue 建立 (2) 系統設計與文件產出 (3) GitHub Flow 開發（Branch → PR → Review → Merge）(4) 自動化 CI/CD 與 Preview 部署 (5) 驗收與正式部署。適用於 MeowCloud-ai GitHub Organization 下所有專案。
---

# MeowCloud SDLC

MeowCloud 的標準軟體開發流程。所有專案遵循相同的五階段流程。

## 角色分工

| 角色 | 執行者 | 職責 |
|------|--------|------|
| **Orchestrator** | 阿福 (OpenClaw) | 需求分析、系統設計、任務拆解、品質把關、進度回報 |
| **Coding Agent** | Claude Code Sub-agent | 根據 TASKS.md 逐任務開發，Branch 開發 |
| **Review Agent** | Claude Code Sub-agent | 在 GitHub PR 留 Comment，審碼品質/安全/效能 |
| **驗收人** | 軒哥 | 透過 Preview URL 實際操作驗證 |

**核心原則：Orchestrator 負責「想」，Claude Code 負責「做」。**

## 倉庫架構

- **MeowCloud-ai/meowcloud** — 公司層級（流程、模板、共用設定）
- **MeowCloud-ai/<project-name>** — 每個專案獨立 repo

## 五階段流程

### Phase 0: 需求收集

1. 軒哥在 Discord 或對話中提出需求
2. Orchestrator 釐清需求，產出標準化 GitHub Issue
3. Issue 格式使用 `assets/issue-templates/feature.md`

**產出物：** GitHub Issues（帶 User Story + Acceptance Criteria + Priority）

### Phase 1: 系統設計

1. 根據 Issues 分析需求
2. 產出設計文件（使用 `assets/templates/` 中的模板）：
   - `CLAUDE.md` — 開發指引（Claude Code 自動讀取）
   - `DECISIONS.md` — 架構決策紀錄
   - `docs/PRD.md` — 產品需求規格
   - `docs/ARCHITECTURE.md` — 技術架構
   - `docs/TASKS.md` — 任務拆解（每個 Task 對應一個 Issue）
3. 建立 `.claude/agents/` Agent 定義
4. 軒哥確認後進入開發

**產出物：** 設計文件 + Agent 定義，推送到 repo main branch

### Phase 2: 開發迭代（GitHub Flow）

每個 Task 執行以下流程：

1. **建立 Feature Branch**: `feat/task-N-description`
2. **Coding Agent 開發**: 根據 CLAUDE.md + TASKS.md 寫碼
3. **本地檢查**: Hooks 自動觸發 Lint + Type Check + Unit Test
4. **推送 + 建立 PR**:
   - PR 描述使用 `assets/github/pr-template.md`
   - 關聯 Issue: `Closes #N`
5. **CI Pipeline**: GitHub Actions 自動跑 Build + Test + Lint
6. **Preview 部署**: PR 觸發自動部署 Preview 環境
7. **Review Agent 審碼**: 在 PR 留結構化 Comment
   - ✅ Approve → 進入 Merge
   - ❌ Request Changes → Coding Agent 修改 → 重新 Push
8. **Merge to main**

**詳細 CI 設定**: 見 `references/ci-setup.md`
**Review 標準**: 見 `references/review-standards.md`

### Phase 3: 驗收部署

1. PR 建立時自動產生 Preview URL
2. 通知軒哥驗收（提供 Preview URL + 測試要點）
3. 軒哥實際操作驗證
4. Approve PR → Merge to main → 自動部署 Production

### Phase 3.5: 應用程式安全審計

每次 Production 部署前，對 Preview URL 執行 squirrelscan 全面審計：

```bash
# 基本審計（230+ 規則）
squirrel audit <preview-url> --format json -o audit-report.json

# LLM 友好格式，自動分析修復
squirrel audit <preview-url> --format llm
```

**審計範圍（21 類別）：**
- 🔒 **Security** — HTTPS、CSP、leaked secrets、安全標頭
- ♿ **Accessibility** — ARIA、焦點管理、landmark
- ⚡ **Performance** — Core Web Vitals (LCP/CLS/INP)
- 🔍 **SEO** — Meta tags、canonical、structured data
- 📱 **Mobile** — Viewport、tap targets
- 🔗 **Links** — 壞連結、內外部連結健康
- 🛡️ **E-E-A-T** — 信任度信號
- 📄 **Content** — 品質、可讀性
- 其他：Legal、i18n、Schema、Social、Images...

**處理規則：**
1. **Critical/High** severity → 必須修復才能部署，建 Issue 回 Phase 2
2. **Medium** → 評估後決定，可排入下個 Sprint
3. **Low/Info** → 記錄到 DECISIONS.md，作為技術債追蹤
4. 審計報告存入 `docs/AUDIT-REPORT.md`

**自動化整合：**
- PR 階段可在 CI 加入 `squirrel audit` 做 pre-deploy 檢查
- 定期排程掃描 Production URL 監控退化

### Phase 4: 維運監控

1. Production 部署後監控錯誤
2. 定期健康檢查（含 `squirrel audit` 定期掃描）
3. Bug → 回到 Phase 0 建 Issue

## 🚦 品質 Gate 與遞迴品質閉環

### Definition of Done（每個 PR 必須通過）

| Gate | 檢查項 | 工具 |
|------|--------|------|
| Gate 1 | TypeScript 零錯誤 + Lint 通過 + Build 成功 | `npm run typecheck/lint/build` |
| Gate 2 | 測試全 PASS，新功能有測試 | `npm run test` |
| Gate 3 | 所有 Link/import 指向存在的檔案/頁面 | CI route check |
| Gate 4 | DB CRUD 有 integration test，table/column 存在 | Supabase schema 驗證 |
| Gate 5 | 核心 user flow 有 E2E 測試 | Playwright |
| Gate 6 | Build 成功 + Preview 可存取 + 環境變數齊全 | Vercel Preview |
| Gate 7 | 網站安全/SEO/效能/無障礙審計通過 | `squirrel audit` (squirrelscan) |

品質 Gate 定義在 `CLAUDE.md` 模板中，每個專案 init 自動帶入。

### 🔄 遞迴修復協議（Auto-Fix Loop）

CI 或 Review 失敗時自動觸發修復迴路：

```
Coder 提交
  → CI 品質 Gate 檢查
    → 失敗？→ 錯誤訊息回傳 Coder → fix(ci) commit → 重新提交
    → 成功？→ Reviewer 審碼
      → 有問題？→ Comment 回傳 Coder → 修復 → 重新提交
      → 通過？→ ✅ Merge
```

**規則：**
1. 最多 3 次自動修復，超過通知 Orchestrator 介入
2. 每次只修最嚴重的錯誤
3. 同一錯誤連續 2 次 → 停止（可能是架構問題）
4. 每次 retry commit: `fix(ci): <修了什麼>`

### Orchestrator 介入時機
- 自動修復 3 次仍失敗
- 需要修改架構（非局部修復能解決）
- 需要新增/修改 DB schema
- 安全性問題

## 🤖 Agent Teams

每個專案在 `.claude/agents/` 定義兩個 Agent：

| Agent | 職責 | 權限 | Model |
|-------|------|------|-------|
| **Coder** | 功能開發、寫測試、修 CI | Read + Write + Edit + Bash | sonnet |
| **Reviewer** | Code Review、品質 Gate 驗證 | Read + Search + Bash（**無寫入**） | sonnet |

**權限分離是關鍵** — Reviewer 不能改 code，只能指出問題。這確保了審碼的獨立性。

### 與 Orchestrator（阿福）的協作流程

```
Orchestrator 拆 task → 分配給 Coder
  → Coder 開 branch + 寫碼 + 跑品質 Gate + 推 PR
  → Orchestrator 觸發 Reviewer
  → Reviewer 逐項檢查品質 Gate + 留 Comment
    → 通過 → Orchestrator merge + 分配下一個 task
    → 拒絕 → Comment 回 Coder → 進入修復迴路
```

### 使用方式
- Claude Code CLI: `/agent coder` 或 `/agent reviewer`
- Agent 定義模板在 `assets/agents/`，init 時自動複製到 `.claude/agents/`

## 初始化新專案

當啟動新專案時，執行 `scripts/init-project.sh`：

```bash
bash scripts/init-project.sh <project-name>
```

此腳本會：
1. 在 MeowCloud-ai org 建立新 repo
2. 從 `assets/templates/` 複製所有模板檔案
3. 從 `assets/github/` 複製 CI + PR/Issue templates
4. 從 `assets/agents/` 複製 Agent 定義
5. 推送初始 commit

初始化後，進入 Phase 0 開始需求收集。

## 專案類型

並非所有專案都走完整 SDLC。依性質分為兩種類型：

### 🏗️ Type A：產品設計 / 委外需求書

**適用**：產品規劃、系統設計、委外 RFP 產出
**流程**：Phase 0 → Phase 1（止於系統設計，不進入開發）

**必要文件**：

| 文件 | 說明 |
|------|------|
| `docs/PRD.md` | 需求規格 |
| `docs/ARCHITECTURE.md` | 技術架構 |
| `docs/TASKS.md` | 任務拆解（供委外估價用） |
| `DECISIONS.md` | 架構決策紀錄 |

**不需要的文件**（這些屬於開發階段）：
- `CLAUDE.md` — 開發指引（Phase 2）
- `docs/TEST-PLAN.md` — 測試計劃（Phase 2）
- `docs/INSTALL-GUIDE.md` — 安裝手冊（Phase 2）
- `docs/CHANGELOG.md` — 版本變更（Phase 2）
- `.claude/agents/` — Agent 定義（Phase 2）

### 🚀 Type B：完整開發專案

**適用**：自行開發、AI Agent 開發的產品
**流程**：Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4（完整五階段）
**文件**：下方完整文件清單全部適用

---

## 文件體系

每個專案必須維護以下六類文件，隨開發流程逐步產出：

> ⚠️ **Type A 專案**（產品設計/委外）只需分析文件 + 設計文件，詳見上方「專案類型」。

### 📋 文件清單與產出時機

| 類別 | 文件 | 產出時機 | 說明 |
|------|------|----------|------|
| **分析文件** | `docs/PRD.md` | Phase 1 | 需求規格、User Story、驗收條件 |
| **設計文件** | `docs/ARCHITECTURE.md` | Phase 1 | 技術架構、模組設計、資料流 |
| | `DECISIONS.md` | Phase 1 起持續更新 | 架構決策紀錄 |
| | `CLAUDE.md` | Phase 1 | 開發指引（Claude Code 讀取） |
| **測試文件** | `docs/TEST-PLAN.md` | Phase 1 | 測試策略、測試案例、覆蓋率目標 |
| | `docs/TEST-REPORT.md` | Phase 2 每個 Sprint 更新 | 測試執行結果、通過率、已知問題 |
| **使用手冊** | `docs/USER-GUIDE.md` | Phase 2 Sprint 5 起 | 功能說明、操作步驟、截圖 |
| **安裝手冊** | `docs/INSTALL-GUIDE.md` | Phase 2 Sprint 1 起 | 環境需求、安裝步驟、常見問題 |
| **安全文件** | `docs/AUDIT-REPORT.md` | Phase 3.5 | squirrelscan 審計結果、修復狀態 |
| **維運文件** | `docs/CHANGELOG.md` | Phase 2 起持續更新 | 版本變更紀錄 |

### 📝 文件規則

1. **Phase 1 結束前**：分析 + 設計 + 測試計劃 + 安裝手冊初版 必須完成
2. **每個 Sprint 結束**：更新 TEST-REPORT.md + CHANGELOG.md
3. **Phase 3 驗收前**：USER-GUIDE.md + INSTALL-GUIDE.md 必須完成
4. **文件跟著 code 走**：功能變更時同步更新相關文件
5. **安裝手冊必須讓非技術人員也能照著做**

模板見 `assets/templates/` 目錄。

## PDF 匯出

每個階段完成後，都可以將文件匯出為專業 PDF（含封面、目錄、品牌樣式）。

### 快速使用

```bash
# 匯出單一文件
python3 scripts/export-pdf.py docs/PRD.md

# 匯出 Phase 1 所有文件（個別 PDF）
python3 scripts/export-pdf.py --phase 1

# 合併成一份 PDF（封面 + 目錄 + 所有文件）
python3 scripts/export-pdf.py --phase 2 --merge -o "MyProject-設計文件.pdf"

# 使用自訂主題
python3 scripts/export-pdf.py --phase 1 --theme minimal

# 列出可用主題
python3 scripts/export-pdf.py --list-themes
```

### 專案配置

在專案根目錄放 `pdf-config.json`（從 `assets/pdf/pdf-config.example.json` 複製修改）：

```json
{
  "project_name": "My Project",
  "company_name": "My Company",
  "version": "0.1.0",
  "confidential": true,
  "logo": "assets/logo.png",
  "accent_color": "#2563EB",
  "theme": "default"
}
```

**Logo 建議尺寸：** 400×100px PNG（透明背景）或 SVG，寬高比 4:1 最佳。

### 自訂主題

在 `assets/pdf/themes/` 新增 CSS 檔案即可。也可在 `pdf-config.json` 用 `"custom_css"` 指向額外的覆蓋樣式。

### Phase 對應文件

| Phase | 匯出的文件 |
|-------|-----------|
| 0 | PRD |
| 1 | PRD, ARCHITECTURE, TASKS, TEST-PLAN, INSTALL-GUIDE, DECISIONS |
| 2 | Phase 1 + TEST-REPORT, CHANGELOG |
| 3 | Phase 2 + USER-GUIDE + AUDIT-REPORT（完整交付） |

### 相依套件

- Python 3、chromium-browser（或 google-chrome）
- `pip3 install markdown pymdown-extensions`

## 專案目錄結構

每個專案初始化後的結構：

```
project-name/
├── CLAUDE.md                  # 開發指引
├── DECISIONS.md               # 架構決策
├── README.md
├── docs/
│   ├── PRD.md                 # 需求規格（分析文件）
│   ├── ARCHITECTURE.md        # 技術架構（設計文件）
│   ├── TASKS.md               # 任務拆解
│   ├── TEST-PLAN.md           # 測試計劃
│   ├── TEST-REPORT.md         # 測試紀錄
│   ├── USER-GUIDE.md          # 使用手冊
│   ├── INSTALL-GUIDE.md       # 安裝手冊
│   ├── AUDIT-REPORT.md        # 安全審計報告
│   └── CHANGELOG.md           # 版本變更紀錄
├── .claude/
│   └── agents/
│       ├── coder.md           # Coding Agent
│       └── reviewer.md        # Review Agent
├── .github/
│   ├── workflows/
│   │   └── ci.yml             # CI Pipeline
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── ISSUE_TEMPLATE/
│       ├── feature.md
│       └── bug.md
└── src/
```
