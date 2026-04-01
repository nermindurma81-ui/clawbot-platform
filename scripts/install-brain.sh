# ===== Install Bot Brain =====
# Downloads and configures the bot's core brain/skills from GitHub

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BRAIN_DIR="$PROJECT_DIR/brain"

mkdir -p "$BRAIN_DIR"

echo "🧠 Installing bot brain..."

# ===== Brain Config =====
cat > "$BRAIN_DIR/config.json" << 'EOF'
{
  "name": "ClawBot",
  "version": "1.0.0",
  "personality": {
    "tone": "friendly, concise, slightly witty",
    "language": "matches user's language",
    "emoji": "occasional, not excessive"
  },
  "capabilities": {
    "chat": true,
    "code": true,
    "web_search": true,
    "file_ops": true,
    "web_fetch": true
  },
  "models": {
    "default": "llama3",
    "fallback": ["mistral", "phi3"],
    "code": "codellama"
  },
  "limits": {
    "max_context": 4096,
    "max_response": 2048,
    "timeout_seconds": 120
  }
}
EOF

# ===== System Prompts =====
cat > "$BRAIN_DIR/system-prompts.json" << 'EOF'
{
  "default": "You are ClawBot, a helpful AI assistant. Be concise, accurate, and have a bit of personality. Match the user's language.",
  "code": "You are ClawBot, a coding assistant. Write clean, well-commented code. Explain your decisions. Use best practices.",
  "creative": "You are ClawBot, a creative assistant. Be imaginative, expressive, and engaging. Think outside the box.",
  "analyst": "You are ClawBot, a data analyst. Be precise, methodical, and cite your reasoning. Present findings clearly."
}
EOF

# ===== Skills Registry =====
cat > "$BRAIN_DIR/skills-registry.json" << 'EOF'
{
  "skills": [
    {
      "id": "weather",
      "name": "Weather",
      "icon": "🌤️",
      "enabled": true,
      "source": "builtin",
      "description": "Get current weather and forecasts"
    },
    {
      "id": "web-search",
      "name": "Web Search",
      "icon": "🔍",
      "enabled": true,
      "source": "builtin",
      "description": "Search the web using Brave API"
    },
    {
      "id": "email",
      "name": "Email",
      "icon": "📧",
      "enabled": false,
      "source": "builtin",
      "description": "Read and send emails"
    },
    {
      "id": "calendar",
      "name": "Calendar",
      "icon": "📅",
      "enabled": false,
      "source": "builtin",
      "description": "Manage calendar events"
    },
    {
      "id": "github",
      "name": "GitHub",
      "icon": "🐙",
      "enabled": true,
      "source": "builtin",
      "description": "GitHub operations via gh CLI"
    }
  ]
}
EOF

echo "✅ Brain installed at $BRAIN_DIR/"
echo "  - config.json"
echo "  - system-prompts.json"
echo "  - skills-registry.json"
