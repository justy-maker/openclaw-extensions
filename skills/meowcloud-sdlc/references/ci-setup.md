# CI/CD 設定指南

## GitHub Actions CI Pipeline

每個 PR 觸發：
1. **Build** — 確認可以編譯
2. **Lint** — ESLint + Prettier 檢查
3. **Type Check** — TypeScript 嚴格模式
4. **Test** — 單元測試 + 覆蓋率

## Vercel Preview 部署

- 連接 GitHub repo 到 Vercel
- PR 建立 → 自動部署 Preview
- main 合併 → 自動部署 Production
- 設定環境變數在 Vercel Dashboard

## CI YAML 模板

見 `assets/github/ci.yml`，根據專案技術棧調整：
- Node.js 版本
- 測試框架（Vitest / Jest）
- 建置指令
