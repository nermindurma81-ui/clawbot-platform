# ===== Setup Everything =====
# Master setup script — run this first

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "╔══════════════════════════════════════════════════╗"
echo "║          🐾 ClawBot Platform Setup              ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  This will install:                            ║"
echo "║  1. Dependencies (npm)                         ║"
echo "║  2. Ollama + free models                       ║"
echo "║  3. Bot brain & skills                         ║"
echo "║  4. Supabase tables                            ║"
echo "║  5. GitHub auto-sync                           ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Step 1: npm dependencies
echo "📦 Step 1/5: Installing npm dependencies..."
cd "$PROJECT_DIR"
npm install
echo "✅ Dependencies installed"
echo ""

# Step 2: Ollama + models
echo "🧠 Step 2/5: Setting up Ollama..."
bash "$SCRIPT_DIR/install-ollama.sh"
echo ""

# Step 3: Bot brain & skills
echo "⚡ Step 3/5: Installing bot brain & skills..."
bash "$SCRIPT_DIR/install-brain.sh"
bash "$SCRIPT_DIR/install-skills.sh"
echo ""

# Step 4: Environment setup
echo "🔧 Step 4/5: Environment configuration..."
if [ ! -f "$PROJECT_DIR/.env" ]; then
  cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
  echo "⚠️  Created .env — edit with your Supabase/GitHub credentials"
else
  echo "✅ .env already exists"
fi
echo ""

# Step 5: GitHub sync setup
echo "🔄 Step 5/5: Setting up GitHub auto-sync..."
bash "$SCRIPT_DIR/sync-github.sh" --init
echo ""

echo "╔══════════════════════════════════════════════════╗"
echo "║          ✅ Setup Complete!                     ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Start server: npm start                       ║"
echo "║  Open UI:      http://localhost:3000           ║"
echo "║  Edit .env:    Supabase + GitHub creds         ║"
echo "╚══════════════════════════════════════════════════╝"
