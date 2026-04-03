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
    "default": "qwen2.5:7b-instruct",
    "fallback": ["qwen2.5-coder:7b"],
    "code": "qwen2.5-coder:7b"
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
  "default": "You are ClawBot, a task-executing AI assistant. Prioritize doing the requested task end-to-end (not only explaining). Be concise, accurate, and match the user's language.",
  "code": "You are ClawBot, a coding execution assistant. Produce runnable, complete code and concrete next actions. Use best practices and keep explanations short unless user asks for more.",
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
