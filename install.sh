#!/usr/bin/env bash
# =============================================================================
# openclaw-extensions install.sh
# 用途：在新機器上安裝 openclaw + 所有自訂 extensions
# 使用方式：bash install.sh
# =============================================================================

set -e
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCLAW_DIR="$HOME/.openclaw"
EXTENSIONS_DIR="$OPENCLAW_DIR/extensions"
NVM_DIR="$HOME/.nvm"

echo "================================================"
echo " openclaw-extensions 安裝腳本"
echo " Repo: $REPO_DIR"
echo "================================================"

# ---------- 1. Node.js ----------
echo ""
echo "[1/7] 確認 Node.js 環境..."
if [ ! -d "$NVM_DIR" ]; then
    echo "  安裝 nvm..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
else
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
fi
nvm install 22 --lts 2>/dev/null || true
nvm use 22
echo "  Node: $(node -v)"

# ---------- 2. openclaw ----------
echo ""
echo "[2/7] 安裝 openclaw..."
npm install -g openclaw 2>/dev/null || npm install -g openclaw --force
echo "  openclaw: $(openclaw --version 2>/dev/null || echo 'installed')"

# ---------- 3. 建立目錄 ----------
echo ""
echo "[3/7] 建立目錄結構..."
mkdir -p "$EXTENSIONS_DIR"
mkdir -p "$OPENCLAW_DIR/cron"
mkdir -p "$OPENCLAW_DIR/logs/conversations"
mkdir -p "$OPENCLAW_DIR/stm"
mkdir -p "$OPENCLAW_DIR/workspace/memory/channels"
mkdir -p "$OPENCLAW_DIR/workspace/skills"

# ---------- 4. 安裝 extensions ----------
echo ""
echo "[4/7] 安裝 extensions..."

# memory-lancedb-pro（外部 repo）
if [ ! -d "$EXTENSIONS_DIR/memory-lancedb-pro" ]; then
    git clone https://github.com/CortexReach/memory-lancedb-pro "$EXTENSIONS_DIR/memory-lancedb-pro"
    echo "  ✅ memory-lancedb-pro 安裝完成"
else
    cd "$EXTENSIONS_DIR/memory-lancedb-pro" && git pull && cd - > /dev/null
    echo "  ✅ memory-lancedb-pro 已更新"
fi

# 自訂 extensions（本 repo）
for ext in smart-router conversation-logger; do
    SRC="$REPO_DIR/extensions/$ext"
    DST="$EXTENSIONS_DIR/$ext"
    if [ -d "$SRC" ]; then
        mkdir -p "$DST"
        cp -f "$SRC"/*.ts "$DST/" 2>/dev/null || true
        cp -f "$SRC"/*.json "$DST/" 2>/dev/null || true
        echo "  ✅ $ext 已複製"
    fi
done

# ---------- 5. 複製 workspace 範本 ----------
echo ""
echo "[5/7] 複製 workspace 範本與 skills..."
WORKSPACE="$OPENCLAW_DIR/workspace"

for tmpl in SOUL.md AGENTS.md HEARTBEAT.md IDENTITY.md USER.md; do
    SRC="$REPO_DIR/templates/workspace/$tmpl"
    DST="$WORKSPACE/$tmpl"
    if [ ! -f "$DST" ] && [ -f "$SRC" ]; then
        cp "$SRC" "$DST"
        echo "  ✅ $tmpl 已複製"
    else
        echo "  $tmpl 已存在，跳過"
    fi
done

# 頻道 MD 範本
cp "$REPO_DIR/templates/workspace/memory/channels/_TEMPLATE.md" \
   "$WORKSPACE/memory/channels/_TEMPLATE.md" 2>/dev/null || true
echo "  ✅ 頻道 MD 範本已複製"

# Skills
for skill in meowcloud-sdlc skill-vetting three-brain strategy-meeting; do
    SRC="$REPO_DIR/skills/$skill"
    DST="$WORKSPACE/skills/$skill"
    if [ -d "$SRC" ] && [ ! -d "$DST" ]; then
        cp -r "$SRC" "$DST"
        echo "  ✅ skill: $skill 已複製"
    elif [ -d "$DST" ]; then
        echo "  skill: $skill 已存在，跳過"
    fi
done

# ---------- 6. 設定檔 ----------
echo ""
echo "[6/7] 設定 openclaw.json 與 cron jobs..."

# openclaw.json
if [ ! -f "$OPENCLAW_DIR/openclaw.json" ]; then
    sed "s|__HOME__|$HOME|g" \
        "$REPO_DIR/config/openclaw.json.template" \
        > "$OPENCLAW_DIR/openclaw.json"
    echo "  ⚠️  openclaw.json 已複製，請填入必要資訊（見後續步驟）"
else
    echo "  openclaw.json 已存在，跳過"
fi

# cron-config.json（若不存在則複製範本）
CRON_CONFIG="$OPENCLAW_DIR/cron/cron-config.json"
if [ ! -f "$CRON_CONFIG" ]; then
    cp "$REPO_DIR/config/cron/cron-config.json" "$CRON_CONFIG"
    echo "  ⚠️  cron-config.json 已複製，請填入 Discord ID（見後續步驟）"
else
    echo "  cron-config.json 已存在，跳過"
fi

# 從 cron-config.json 讀取值並替換 jobs.json 佔位符
if command -v python3 &>/dev/null && [ -f "$CRON_CONFIG" ]; then
    python3 - << PYEOF
import json, re

with open("$CRON_CONFIG") as f:
    cfg = json.load(f)

d = cfg.get("delivery", {})
with open("$REPO_DIR/config/cron/jobs.json") as f:
    jobs = f.read()

jobs = jobs.replace("{{OWNER_USER_ID}}",         d.get("ownerUserId", "YOUR_DISCORD_USER_ID"))
jobs = jobs.replace("{{MAIN_CHANNEL_ID}}",        d.get("mainChannelId", "YOUR_MAIN_CHANNEL_ID"))
jobs = jobs.replace("{{MEMORY_CHANNEL_ID}}",      d.get("memoryChannelId", "YOUR_MEMORY_CHANNEL_ID"))
jobs = jobs.replace("{{GYM_BOOKING_CHANNEL_ID}}", d.get("gymBookingChannelId", "YOUR_GYM_BOOKING_CHANNEL_ID"))

with open("$OPENCLAW_DIR/cron/jobs.json", "w") as f:
    f.write(jobs)
print("  ✅ cron/jobs.json 已生成（delivery 已替換）")
PYEOF
else
    cp "$REPO_DIR/config/cron/jobs.json" "$OPENCLAW_DIR/cron/jobs.json"
    echo "  ✅ cron/jobs.json 已複製（含佔位符，需手動替換）"
fi

# ---------- 7. systemd service ----------
echo ""
echo "[7/7] 設定 systemd service..."
SERVICE_DIR="$HOME/.config/systemd/user"
mkdir -p "$SERVICE_DIR"

NODE_BIN="$(which node)"
NODE_DIR="$(dirname "$NODE_BIN")"
OPENCLAW_BIN="$(npm root -g)/openclaw/dist/index.js"

sed "s|__NODE_BIN__|$NODE_BIN|g;
     s|__OPENCLAW_BIN__|$OPENCLAW_BIN|g;
     s|__HOME__|$HOME|g;
     s|__NODE_DIR__|$NODE_DIR|g" \
    "$REPO_DIR/config/openclaw-gateway.service.template" \
    > "$SERVICE_DIR/openclaw-gateway.service"

systemctl --user daemon-reload
systemctl --user enable openclaw-gateway.service
echo "  ✅ systemd service 已設定"

# ---------- 完成 ----------
echo ""
echo "================================================"
echo " 安裝完成！請依序完成以下設定："
echo "================================================"
echo ""
echo "【必填】"
echo "  1. 編輯 ~/.openclaw/openclaw.json"
echo "     YOUR_DISCORD_BOT_TOKEN   → Discord Bot Token"
echo "     YOUR_GATEWAY_AUTH_TOKEN  → openssl rand -hex 24"
echo "     YOUR_OLLAMA_HOST         → ollama 主機 IP"
echo ""
echo "  2. 編輯 ~/.openclaw/cron/cron-config.json"
echo "     YOUR_DISCORD_USER_ID     → 你的 Discord User ID"
echo "     YOUR_MAIN_CHANNEL_ID     → 主要通知頻道 ID"
echo "     其他頻道 ID（視需要）"
echo "     填完後重新執行 bash install.sh 以套用到 jobs.json"
echo ""
echo "  3. 設定 Anthropic API Key："
echo "     openclaw auth add --provider anthropic --token YOUR_ANTHROPIC_API_KEY"
echo ""
echo "【LanceDB 記憶系統（重要）】"
echo "  4. 在 ollama 主機安裝 embedding 模型："
echo "     ollama pull nomic-embed-text"
echo ""
echo "  5. 確認 LanceDB 磁碟空間（建議預留 2GB+）："
echo "     df -h ~/.openclaw/memory/ 2>/dev/null || df -h ~"
echo ""
echo "  6. 確認 embedding 服務可連線（替換為實際 IP）："
echo "     curl http://YOUR_OLLAMA_HOST:11434/v1/models | grep nomic"
echo ""
echo "【啟動】"
echo "  7. systemctl --user start openclaw-gateway"
echo "     systemctl --user status openclaw-gateway"
echo ""
echo "  詳細說明見 docs/ 目錄"
