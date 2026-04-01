# ===== Deploy to Railway =====
# Deploys ClawBot Platform to Railway

set -e

echo "🚂 Railway Deployment"

# Check for Railway CLI
if ! command -v railway &> /dev/null; then
  echo "📥 Installing Railway CLI..."
  npm install -g @railway/cli
fi

# Load .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs) 2>/dev/null || true
fi

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║         🚂 Railway Deployment Steps             ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║                                                  ║"
echo "║  1. Login:    railway login                     ║"
echo "║  2. Init:     railway init                      ║"
echo "║  3. Set vars: railway variables set \\           ║"
echo "║               SUPABASE_URL=... \\               ║"
echo "║               SUPABASE_ANON_KEY=... \\          ║"
echo "║               OLLAMA_URL=...                    ║"
echo "║  4. Deploy:   railway up                        ║"
echo "║                                                  ║"
echo "║  Or use 'npm run deploy:railway' for auto       ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Auto-deploy if token is set
if [ -n "$RAILWAY_TOKEN" ]; then
  echo "🚀 Auto-deploying with Railway token..."
  railway login --token "$RAILWAY_TOKEN"
  railway up
  echo "✅ Deployed!"
else
  echo "ℹ️  Set RAILWAY_TOKEN in .env for auto-deploy"
  echo "   Or follow manual steps above"
fi
