# ===== Install Ollama + Free Models =====
# Installs Ollama and pulls free models

set -e

echo "🧠 Installing Ollama..."

# Check if already installed
if command -v ollama &> /dev/null; then
  echo "✅ Ollama already installed: $(ollama --version)"
else
  echo "⬇️  Downloading Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh
  echo "✅ Ollama installed"
fi

# Start Ollama if not running
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo "🚀 Starting Ollama..."
  if command -v systemctl &> /dev/null; then
    systemctl start ollama 2>/dev/null || ollama serve &
  else
    ollama serve &
  fi
  sleep 3
fi

echo "📥 Pulling free models..."

MODELS=("llama3" "mistral" "phi3" "gemma:2b")

for model in "${MODELS[@]}"; do
  echo "  ⬇️  Pulling $model..."
  ollama pull "$model" || echo "  ⚠️  Failed to pull $model (skipping)"
done

echo ""
echo "✅ Ollama setup complete!"
echo "📋 Installed models:"
ollama list 2>/dev/null || echo "  (run 'ollama list' to see models)"
