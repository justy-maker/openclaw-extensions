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
echo "[1/6] 確認 Node.js 環境..."
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
echo "[2/6] 安裝 openclaw..."
npm install -g openclaw 2>/dev/null || npm install -g openclaw --force
echo "  openclaw: $(openclaw --version 2>/dev/null || echo 'installed')"

# ---------- 3. 建立目錄 ----------
echo ""
echo "[3/6] 建立目錄結構..."
mkdir -p "$EXTENSIONS_DIR"
mkdir -p "$OPENCLAW_DIR/cron"
mkdir -p "$OPENCLAW_DIR/logs/conversations"
mkdir -p "$OPENCLAW_DIR/stm"

# ---------- 4. 安裝 extensions ----------
echo ""
echo "[4/6] 安裝 extensions..."

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

# ---------- 5. 設定檔 ----------
echo ""
echo "[5/6] 設定 openclaw.json 與 cron jobs..."

if [ ! -f "$OPENCLAW_DIR/openclaw.json" ]; then
    cp "$REPO_DIR/config/openclaw.json.template" "$OPENCLAW_DIR/openclaw.json"
    echo "  ⚠️  openclaw.json 已複製，請填入以下必要資訊："
    echo "      - YOUR_DISCORD_BOT_TOKEN"
    echo "      - YOUR_GATEWAY_AUTH_TOKEN（可用 openssl rand -hex 24 產生）"
    echo "      - 修改 ollama/llama-server baseUrl 為你的 AI 主機 IP"
else
    echo "  openclaw.json 已存在，跳過（如需更新請手動合併 config/openclaw.json.template）"
fi

# cron jobs
cp "$REPO_DIR/config/cron/jobs.json" "$OPENCLAW_DIR/cron/jobs.json"
echo "  ✅ cron/jobs.json 已複製"

# ---------- 6. systemd service ----------
echo ""
echo "[6/6] 設定 systemd service..."
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
echo " 安裝完成！"
echo "================================================"
echo ""
echo "後續步驟："
echo ""
echo "  1. 編輯 ~/.openclaw/openclaw.json"
echo "     填入 YOUR_DISCORD_BOT_TOKEN"
echo "     填入 YOUR_GATEWAY_AUTH_TOKEN"
echo "     確認 ollama baseUrl（AI 主機 IP）"
echo ""
echo "  2. 設定 Anthropic API Key："
echo "     openclaw auth add --provider anthropic --token YOUR_ANTHROPIC_API_KEY"
echo ""
echo "  3. 確認 ollama 主機已有 embedding 模型："
echo "     ollama pull nomic-embed-text"
echo ""
echo "  4. 啟動 gateway："
echo "     systemctl --user start openclaw-gateway"
echo "     systemctl --user status openclaw-gateway"
echo ""
echo "  5. 確認 plugins 載入（看 log 是否有 smart-router/conversation-logger registered）"
