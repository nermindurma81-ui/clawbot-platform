// ===== ClawBot Platform - Main Server =====
// Express + Supabase Auth + Ollama Proxy + Geensee UI

require('dotenv').config();
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const http = require('http');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Config =====
const CONFIG = {
  gateway: process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:9110',
  ollama: process.env.OLLAMA_URL || 'http://localhost:11434',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_ANON_KEY || '',
  geminiKey: process.env.GEMINI_API_KEY || '',
  defaultProvider: process.env.AI_PROVIDER || (process.env.GEMINI_API_KEY ? 'gemini' : 'ollama'),
};

// ===== Middleware =====
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== Supabase Auth Middleware =====
let supabase = null;
if (CONFIG.supabaseUrl && CONFIG.supabaseKey) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
  console.log('✅ Supabase connected:', CONFIG.supabaseUrl);
}

async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return next(); // Allow unauthenticated for public routes

  if (supabase) {
    const { data, error } = await supabase.auth.getUser(token);
    if (!error && data.user) {
      req.user = data.user;
    }
  }
  next();
}
app.use(authMiddleware);

// ===== Auth Routes =====
app.post('/auth/signup', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ user: data.user, session: data.session });
});

app.post('/auth/login', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: error.message });
  res.json({ user: data.user, session: data.session });
});

app.post('/auth/logout', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    await supabase.auth.admin.signOut(token);
  }
  res.json({ success: true });
});

app.get('/auth/me', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: req.user });
});

// ===== Ollama Proxy =====
const ollamaProxy = createProxyMiddleware({
  target: CONFIG.ollama,
  changeOrigin: true,
  pathRewrite: { '^/ollama': '' },
  logLevel: 'warn',
  onProxyRes: (proxyRes, req, res) => {
    proxyRes.headers['x-powered-by'] = 'clawbot-ollama';
  },
  onError: (err, req, res) => {
    console.error('Ollama proxy error:', err.message);
    if (res.writeHead) {
      res.status(502).json({ error: 'Ollama unavailable', message: err.message });
    }
  },
});
app.use('/ollama', ollamaProxy);

// ===== OpenClaw Gateway Proxy =====
const gatewayProxy = createProxyMiddleware({
  target: CONFIG.gateway,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },
  ws: true,
  logLevel: 'warn',
  onProxyReq: (proxyReq, req) => {
    if (req.headers.authorization) {
      proxyReq.setHeader('Authorization', req.headers.authorization);
    }
    if (req.user?.id) {
      proxyReq.setHeader('X-User-Id', req.user.id);
    }
  },
  onError: (err, req, res) => {
    console.error('Gateway proxy error:', err.message);
    if (res.writeHead) {
      res.status(502).json({ error: 'Gateway unavailable', message: err.message });
    }
  },
});
app.use('/api', gatewayProxy);

// ===== Gemini Chat Helper =====
async function chatGemini(message, model, system) {
  const geminiModel = model && model.startsWith('gemini') ? model : 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${CONFIG.geminiKey}`;

  const contents = [];
  if (system) contents.push({ role: 'user', parts: [{ text: system }] });
  contents.push({ role: 'user', parts: [{ text: message }] });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents }),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Gemini error');

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
  return { response: text, model: geminiModel, provider: 'gemini' };
}

// ===== Ollama Chat Helper =====
async function chatOllama(message, model, system) {
  const ollamaModel = model || 'tinyllama';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  const ollamaRes = await fetch(`${CONFIG.ollama}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel,
      prompt: system ? `System: ${system}\n\nUser: ${message}\nAssistant:` : message,
      stream: false,
      options: { num_predict: 512 },
    }),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  const data = await ollamaRes.json();
  if (data.error) throw new Error(data.error);

  return {
    response: data.response || 'No response',
    model: data.model,
    provider: 'ollama',
    stats: { eval_count: data.eval_count, eval_duration: data.eval_duration },
  };
}

// ===== Bot Chat Endpoint (auto-select provider) =====
app.post('/chat', async (req, res) => {
  const { message, model, system } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  const provider = req.body.provider || CONFIG.defaultProvider;

  try {
    let result;

    if (provider === 'gemini' && CONFIG.geminiKey) {
      result = await chatGemini(message, model, system);
    } else {
      // Try Ollama first, fall back to Gemini
      try {
        result = await chatOllama(message, model, system);
      } catch (ollamaErr) {
        console.log('Ollama failed, trying Gemini:', ollamaErr.message);
        if (CONFIG.geminiKey) {
          result = await chatGemini(message, model, system);
        } else {
          throw ollamaErr;
        }
      }
    }

    res.json(result);
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Request timed out' });
    }
    res.status(502).json({ error: 'Chat failed', message: err.message });
  }
});

// ===== Models Endpoint =====
app.get('/models', async (req, res) => {
  const models = [];

  // Ollama models
  try {
    const ollamaRes = await fetch(`${CONFIG.ollama}/api/tags`, { signal: AbortSignal.timeout(5000) });
    const data = await ollamaRes.json();
    if (data.models) models.push(...data.models);
  } catch { /* Ollama offline */ }

  // Gemini models (if configured)
  if (CONFIG.geminiKey) {
    models.push(
      { name: 'gemini-1.5-flash', model: 'gemini-1.5-flash', provider: 'gemini', size: 0 },
      { name: 'gemini-1.5-pro', model: 'gemini-1.5-pro', provider: 'gemini', size: 0 },
    );
  }

  res.json({ models });
});

// ===== Status =====
app.get('/status', async (req, res) => {
  const checks = {};

  // Check Ollama
  try {
    const r = await fetch(`${CONFIG.ollama}/api/tags`, { signal: AbortSignal.timeout(3000) });
    checks.ollama = r.ok ? 'online' : 'error';
  } catch { checks.ollama = 'offline'; }

  // Check Gateway
  try {
    const r = await fetch(`${CONFIG.gateway}/status`, { signal: AbortSignal.timeout(3000) });
    checks.gateway = r.ok ? 'online' : 'error';
  } catch { checks.gateway = 'offline'; }

  // Check Supabase
  checks.supabase = supabase ? 'configured' : 'not configured';

  // Check Gemini
  checks.gemini = CONFIG.geminiKey ? 'configured' : 'not configured';
  checks.provider = CONFIG.defaultProvider;

  res.json({
    name: 'ClawBot Platform',
    version: '1.0.0',
    uptime: process.uptime(),
    checks,
    timestamp: new Date().toISOString(),
  });
});

// ===== SPA Fallback =====
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== Start =====
const server = http.createServer(app);

server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/ws')) {
    gatewayProxy.upgrade(req, socket, head);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║          🐾 ClawBot Platform v1.0.0             ║
╠══════════════════════════════════════════════════╣
║  UI:       http://localhost:${PORT}                ║
║  Gateway:  ${CONFIG.gateway.padEnd(37)}║
║  Ollama:   ${CONFIG.ollama.padEnd(37)}║
║  Supabase: ${(supabase ? '✅ connected' : '❌ not set').padEnd(37)}║
║  Health:   http://localhost:${PORT}/status          ║
╚══════════════════════════════════════════════════╝
  `);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});
