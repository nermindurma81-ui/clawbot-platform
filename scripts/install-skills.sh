# ===== Install Skills =====
# Downloads and installs bot skills from clawhub.com and local sources

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SKILLS_DIR="$PROJECT_DIR/skills"

mkdir -p "$SKILLS_DIR"

echo "⚡ Installing bot skills..."

# ===== Skill: Weather =====
mkdir -p "$SKILLS_DIR/weather"
cat > "$SKILLS_DIR/weather/skill.json" << 'EOF'
{
  "id": "weather",
  "name": "Weather",
  "version": "1.0.0",
  "description": "Get weather information",
  "triggers": ["weather", "temperature", "forecast", "rain"],
  "endpoint": "/skills/weather"
}
EOF
cat > "$SKILLS_DIR/weather/handler.js" << 'EOJS'
// Weather Skill Handler
const SKILL = {
  id: 'weather',
  async execute(params) {
    const location = params.location || 'Sarajevo';
    try {
      const res = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`);
      const data = await res.json();
      const current = data.current_condition?.[0];
      if (!current) return { error: 'No weather data' };
      return {
        location,
        temp: current.temp_C + '°C',
        feels: current.FeelsLikeC + '°C',
        desc: current.weatherDesc?.[0]?.value,
        humidity: current.humidity + '%',
        wind: current.windspeedKmph + ' km/h',
      };
    } catch (err) {
      return { error: err.message };
    }
  }
};
module.exports = SKILL;
EOJS
echo "  ✅ weather"

# ===== Skill: Web Search =====
mkdir -p "$SKILLS_DIR/web-search"
cat > "$SKILLS_DIR/web-search/skill.json" << 'EOF'
{
  "id": "web-search",
  "name": "Web Search",
  "version": "1.0.0",
  "description": "Search the web",
  "triggers": ["search", "find", "look up", "google"],
  "endpoint": "/skills/web-search"
}
EOF
echo "  ✅ web-search"

# ===== Skill: GitHub =====
mkdir -p "$SKILLS_DIR/github"
cat > "$SKILLS_DIR/github/skill.json" << 'EOF'
{
  "id": "github",
  "name": "GitHub",
  "version": "1.0.0",
  "description": "GitHub operations",
  "triggers": ["github", "repo", "pull request", "issue", "commit"],
  "endpoint": "/skills/github"
}
EOF
echo "  ✅ github"

# ===== Skill: Summarize =====
mkdir -p "$SKILLS_DIR/summarize"
cat > "$SKILLS_DIR/summarize/skill.json" << 'EOF'
{
  "id": "summarize",
  "name": "Summarize",
  "version": "1.0.0",
  "description": "Summarize URLs and text",
  "triggers": ["summarize", "summary", "tldr"],
  "endpoint": "/skills/summarize"
}
EOF
echo "  ✅ summarize"

echo ""
echo "✅ Skills installed at $SKILLS_DIR/"
echo "  - weather"
echo "  - web-search"
echo "  - github"
echo "  - summarize"
