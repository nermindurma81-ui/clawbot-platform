# 🐾 ClawBot Platform

**AI Assistant Platform** — OpenClaw + Ollama + Geensee UI + Supabase + Railway

## What's Inside

```
clawbot-platform/
├── server.js              # Express backend (proxy + auth + chat)
├── package.json           # Dependencies
├── Dockerfile             # Container build
├── railway.json           # Railway deployment config
├── .env.example           # Environment template
│
├── public/                # Frontend (Geensee-style UI)
│   ├── index.html         # Single page app
│   ├── css/style.css      # Dark theme styling
│   └── js/app.js          # Frontend logic
│
├── brain/                 # Bot brain (auto-generated)
│   ├── config.json        # Bot configuration
│   ├── system-prompts.json # Prompt templates
│   └── skills-registry.json # Skills registry
│
├── skills/                # Bot skills (auto-generated)
│   ├── weather/           # Weather skill
│   ├── web-search/        # Web search skill
│   ├── github/            # GitHub skill
│   └── summarize/         # Summarize skill
│
├── supabase/
│   └── schema.sql         # Database schema + RLS
│
├── scripts/
│   ├── setup-all.sh       # Master setup (run first!)
│   ├── install-ollama.sh  # Install Ollama + models
│   ├── install-brain.sh   # Install bot brain
│   ├── install-skills.sh  # Install bot skills
│   ├── fetch-models.sh    # Fetch updates
│   ├── sync-github.sh     # GitHub auto-sync
│   └── deploy-railway.sh  # Railway deployment
│
└── .github/workflows/
    └── deploy.yml         # CI/CD pipeline
```

## Quick Start

### 1. Clone & Setup
```bash
git clone https://github.com/YOUR_USERNAME/clawbot-platform.git
cd clawbot-platform
bash scripts/setup-all.sh
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your credentials:
# - SUPABASE_URL + SUPABASE_ANON_KEY (from supabase.com)
# - GITHUB_TOKEN (from github.com/settings/tokens)
```

### 3. Setup Supabase
1. Go to [supabase.com](https://supabase.com) → New Project
2. Open SQL Editor → Paste `supabase/schema.sql` → Run
3. Copy URL + anon key to `.env`

### 4. Start
```bash
npm start
# Open http://localhost:3000
```

## Features

| Feature | Description |
|---------|-------------|
| 💬 **Chat** | Talk to Ollama models directly from the UI |
| 🔐 **Auth** | Supabase-powered login/signup with RLS |
| 🧠 **Models** | Browse and switch between Ollama models |
| ⚡ **Skills** | Weather, Web Search, GitHub, Summarize |
| 📊 **Status** | Real-time system health monitoring |
| 🔄 **Sync** | Auto-sync chats and settings to Supabase |
| 🚂 **Deploy** | One-command Railway deployment |
| 🐙 **GitHub** | Auto-commit and push changes |

## Ollama Models (Free)

| Model | Size | Best For |
|-------|------|----------|
| llama3 | 4.7GB | General chat |
| mistral | 4.1GB | Fast responses |
| phi3 | 2.2GB | Lightweight |
| gemma:2b | 1.7GB | Ultra-fast |

```bash
# Pull a model
ollama pull llama3

# List installed
ollama list
```

## Railway Deployment

```bash
# Login
railway login

# Deploy
railway init
railway up
```

Or use the script:
```bash
npm run deploy:railway
```

## GitHub Auto-Sync

```bash
# One-shot sync
bash scripts/sync-github.sh "your commit message"

# Watch mode (auto-push every 30s)
bash scripts/sync-github.sh --watch
```

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Browser    │────▶│  ClawBot     │────▶│   Ollama     │
│  (Geensee UI)│     │  Server.js   │     │  (localhost)  │
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
                    ┌───────┴───────┐
                    │               │
              ┌─────▼─────┐  ┌─────▼─────┐
              │ Supabase   │  │ OpenClaw  │
              │ (Auth+DB)  │  │ Gateway   │
              └───────────┘  └───────────┘
```

## License

MIT
