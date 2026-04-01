# ===== GitHub Auto-Sync =====
# Auto-commits and pushes changes to GitHub

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Load .env if exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs) 2>/dev/null || true
fi

GITHUB_REPO="${GITHUB_REPO:-}"
BRANCH="main"

echo "🔄 GitHub Auto-Sync"

# ===== Init mode =====
if [ "$1" = "--init" ]; then
  echo "  📂 Initializing git repo..."
  
  if [ ! -d .git ]; then
    git init
    git branch -M "$BRANCH"
    echo "  ✅ Git initialized"
  else
    echo "  ✅ Git repo exists"
  fi

  # Create .gitignore
  cat > .gitignore << 'EOF'
node_modules/
.env
*.log
.DS_Store
brain/cache/
skills/cache/
EOF

  echo "  ✅ .gitignore created"
  
  # Initial commit
  git add -A
  git commit -m "🐾 Initial ClawBot Platform setup" 2>/dev/null || echo "  ℹ️  Nothing to commit"
  
  if [ -n "$GITHUB_REPO" ]; then
    git remote add origin "https://github.com/$GITHUB_REPO.git" 2>/dev/null || \
      git remote set-url origin "https://github.com/$GITHUB_REPO.git"
    echo "  ✅ Remote set to https://github.com/$GITHUB_REPO.git"
    echo "  ℹ️  Run 'git push -u origin main' to push"
  fi
  
  echo ""
  echo "✅ GitHub init complete!"
  exit 0
fi

# ===== Auto-sync mode =====
if [ "$1" = "--watch" ]; then
  echo "  👀 Watching for changes (Ctrl+C to stop)..."
  while true; do
    if [ -n "$(git status --porcelain)" ]; then
      echo "  📝 Changes detected, syncing..."
      git add -A
      git commit -m "🔄 Auto-sync $(date '+%Y-%m-%d %H:%M:%S')" 2>/dev/null
      git push origin "$BRANCH" 2>/dev/null || echo "  ⚠️  Push failed"
      echo "  ✅ Synced at $(date '+%H:%M:%S')"
    fi
    sleep 30
  done
  exit 0
fi

# ===== One-shot sync =====
echo "  📝 Staging changes..."
git add -A

if [ -n "$(git diff --cached --name-only)" ]; then
  COMMIT_MSG="${1:-🔄 Auto-sync $(date '+%Y-%m-%d %H:%M:%S')}"
  echo "  💾 Committing: $COMMIT_MSG"
  git commit -m "$COMMIT_MSG"
  
  echo "  ⬆️  Pushing to GitHub..."
  git push origin "$BRANCH" 2>/dev/null || echo "  ⚠️  Push failed — check GITHUB_TOKEN or remote"
  echo "  ✅ Synced!"
else
  echo "  ℹ️  No changes to sync"
fi
