# ===== Fetch & Install External Resources =====
# Downloads additional models, skills, and updates

set -e

echo "📥 Fetching external resources..."

# ===== Fetch latest skills from clawhub =====
if command -v npx &> /dev/null; then
  echo "  🔍 Checking clawhub.com for skill updates..."
  # npx clawhub sync 2>/dev/null || echo "  ⚠️  clawhub not available, skipping"
  echo "  ℹ️  clawhub sync available when clawhub CLI is installed"
fi

# ===== Fetch Ollama models list =====
echo "  📋 Available Ollama models:"
if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
  curl -s http://localhost:11434/api/tags | \
    python3 -c "import sys,json; data=json.load(sys.stdin); [print(f'    - {m[\"name\"]} ({m[\"size\"]//(1024**3)}GB)') for m in data.get('models',[])]" 2>/dev/null || \
    echo "    (could not parse model list)"
else
  echo "    ⚠️  Ollama not running"
fi

# ===== Fetch latest brain updates =====
echo "  🧠 Checking brain updates..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -d "$PROJECT_DIR/.git" ]; then
  cd "$PROJECT_DIR"
  git fetch origin main 2>/dev/null && echo "  ✅ Fetched latest from origin" || echo "  ⚠️  Could not fetch from origin"
fi

echo ""
echo "✅ Fetch complete!"
