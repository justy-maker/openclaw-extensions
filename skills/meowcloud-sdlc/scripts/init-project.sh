#!/bin/bash
# MeowCloud SDLC — 新專案初始化腳本
# 用法: bash init-project.sh <project-name> [--private]

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_NAME="${1:?Usage: init-project.sh <project-name> [--private]}"
VISIBILITY="${2:---public}"
ORG="MeowCloud-ai"
CLONE_DIR="/tmp/${PROJECT_NAME}"

echo "🐱 MeowCloud SDLC — 初始化專案: ${PROJECT_NAME}"
echo "   Organization: ${ORG}"
echo "   Visibility: ${VISIBILITY}"
echo ""

# Step 1: 建立 GitHub repo
echo "📦 Step 1: 建立 GitHub repo..."
if gh repo view "${ORG}/${PROJECT_NAME}" &>/dev/null; then
    echo "   ⚠️  Repo 已存在，跳過建立"
else
    gh repo create "${ORG}/${PROJECT_NAME}" ${VISIBILITY} --description "MeowCloud project: ${PROJECT_NAME}" --clone=false
    echo "   ✅ Repo 建立完成"
fi

# Step 2: Clone repo
echo "📥 Step 2: Clone repo..."
rm -rf "${CLONE_DIR}"
gh repo clone "${ORG}/${PROJECT_NAME}" "${CLONE_DIR}" 2>/dev/null || git clone "https://github.com/${ORG}/${PROJECT_NAME}.git" "${CLONE_DIR}"
cd "${CLONE_DIR}"

# Step 3: 複製模板
echo "📄 Step 3: 複製模板檔案..."

# 文件模板
mkdir -p docs
cp "${SKILL_DIR}/assets/templates/CLAUDE.md.template" CLAUDE.md
cp "${SKILL_DIR}/assets/templates/DECISIONS.md.template" DECISIONS.md
cp "${SKILL_DIR}/assets/templates/PRD.md.template" docs/PRD.md
cp "${SKILL_DIR}/assets/templates/ARCHITECTURE.md.template" docs/ARCHITECTURE.md
cp "${SKILL_DIR}/assets/templates/TASKS.md.template" docs/TASKS.md

# 替換 placeholder
sed -i "s/{{PROJECT_NAME}}/${PROJECT_NAME}/g" CLAUDE.md docs/PRD.md docs/ARCHITECTURE.md

# Agent 定義
mkdir -p .claude/agents
cp "${SKILL_DIR}/assets/agents/coder.md" .claude/agents/
cp "${SKILL_DIR}/assets/agents/reviewer.md" .claude/agents/

# GitHub 設定
mkdir -p .github/workflows .github/ISSUE_TEMPLATE
cp "${SKILL_DIR}/assets/github/ci.yml" .github/workflows/
cp "${SKILL_DIR}/assets/github/pr-template.md" .github/PULL_REQUEST_TEMPLATE.md
cp "${SKILL_DIR}/assets/github/issue-feature.md" .github/ISSUE_TEMPLATE/feature.md
cp "${SKILL_DIR}/assets/github/issue-bug.md" .github/ISSUE_TEMPLATE/bug.md

# README
cat > README.md << EOF
# 🐱 ${PROJECT_NAME}

> MeowCloud-ai project

## Development

\`\`\`bash
npm install
npm run dev
\`\`\`

## License

MIT © MeowCloud-ai
EOF

# .gitignore
cat > .gitignore << 'EOF'
node_modules/
dist/
out/
.env
.env.local
.DS_Store
EOF

# src placeholder
mkdir -p src

echo "   ✅ 模板複製完成"

# Step 4: 初始 commit
echo "🚀 Step 4: 推送到 GitHub..."
git add -A
git commit -m "chore: init project with MeowCloud SDLC templates"
git push origin main 2>/dev/null || git push origin master

echo ""
echo "✅ 專案初始化完成！"
echo "   GitHub: https://github.com/${ORG}/${PROJECT_NAME}"
echo "   本地: ${CLONE_DIR}"
echo ""
echo "📋 下一步："
echo "   1. 進入 Phase 0: 需求收集（建立 GitHub Issues）"
echo "   2. 進入 Phase 1: 填寫設計文件（CLAUDE.md, PRD, ARCHITECTURE, TASKS）"
echo "   3. 進入 Phase 2: 開始開發迭代"
