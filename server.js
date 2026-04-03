// ===== ClawBot Platform - Main Server =====
// Express + Supabase Auth + Ollama Proxy + Geensee UI

require('dotenv').config();
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');
const multer = require('multer');
const AdmZip = require('adm-zip');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

// ===== Config =====
const CONFIG = {
  gateway: process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:9110',
  ollama: process.env.OLLAMA_URL || 'http://localhost:11434',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  geminiKey:    process.env.GEMINI_API_KEY       || '',
  groqKey:      process.env.GROQ_API_KEY         || '',
  hfKey:        process.env.HUGGINGFACE_TOKEN    || '',
  cerebrasKey:  process.env.CEREBRAS_API_KEY     || '',
  mistralKey:   process.env.MISTRAL_API_KEY      || '',
  siliconKey:   process.env.SILICONFLOW_API_KEY  || '',
  llm7BaseUrl: process.env.LLM7_BASE_URL || 'https://api.llm7.io/v1',
  defaultProvider: process.env.AI_PROVIDER || (
    process.env.GROQ_API_KEY        ? 'groq'        :
    process.env.CEREBRAS_API_KEY    ? 'cerebras'    :
    process.env.GEMINI_API_KEY      ? 'gemini'      :
    process.env.MISTRAL_API_KEY     ? 'mistral'     :
    process.env.SILICONFLOW_API_KEY ? 'siliconflow' :
    process.env.HUGGINGFACE_TOKEN   ? 'huggingface' :
    'llm7'
  ),
  ownerEmail: process.env.OWNER_EMAIL || 'nermindurma81@gmail.com',
};

// ===== Rate Limiting + Analytics =====
const rateLimits = new Map(); // ip -> { count, resetAt }
const analytics = { messages: 0, skills_used: {}, models_used: {}, users: new Set(), started: Date.now() };
const RATE_LIMIT = 30; // requests per minute
const RATE_WINDOW = 60000;

function checkRateLimit(userId, email) {
  // Owner has no limits
  if (email === CONFIG.ownerEmail) return { allowed: true, remaining: 999 };

  const key = userId || 'anonymous';
  const now = Date.now();
  let entry = rateLimits.get(key);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_WINDOW };
    rateLimits.set(key, entry);
  }

  entry.count++;
  const remaining = Math.max(0, RATE_LIMIT - entry.count);
  return { allowed: entry.count <= RATE_LIMIT, remaining, resetAt: entry.resetAt };
}

// ===== Admin Check =====
function isAdmin(email) {
  return email === CONFIG.ownerEmail;
}

// ===== Middleware =====
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== Supabase Auth Middleware =====
let supabase = null;
let supabaseAdmin = null;
if (CONFIG.supabaseUrl && CONFIG.supabaseKey) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
  // Admin client for auto-confirm users
  const adminKey = CONFIG.supabaseServiceKey || CONFIG.supabaseKey;
  supabaseAdmin = createClient(CONFIG.supabaseUrl, adminKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  console.log('✅ Supabase connected:', CONFIG.supabaseUrl);
}

async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return next(); // Allow unauthenticated for public routes

  // Handle local tokens
  if (token.startsWith('local-')) {
    try {
      const userData = JSON.parse(Buffer.from(token.replace('local-', ''), 'base64').toString());
      req.user = { id: userData.id, email: userData.email };
    } catch {}
    return next();
  }

  if (supabase) {
    const { data, error } = await supabase.auth.getUser(token);
    if (!error && data.user) {
      req.user = data.user;
    }
  }
  next();
}
app.use(authMiddleware);

// ===== Local Auth Fallback (when Supabase email confirmation blocks) =====
const localUsersPath = path.join(DATA_DIR, 'local-users.json');
const runtimeConfigPath = path.join(DATA_DIR, 'runtime-config.json');

function getLocalUsers() {
  if (!fs.existsSync(localUsersPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(localUsersPath));
  } catch {
    return {};
  }
}

function getRuntimeConfig() {
  const defaultProviders = {
    groq: { token: '', custom_models: [] },
    cerebras: { token: '', custom_models: [] },
    mistral: { token: '', custom_models: [] },
    siliconflow: { token: '', custom_models: [] },
    gemini: { token: '', custom_models: [] },
    huggingface: { token: '', custom_models: [] },
    llm7: { token: '', custom_models: [] },
  };
  if (!fs.existsSync(runtimeConfigPath)) {
    return { providers: defaultProviders };
  }
  try {
    const data = JSON.parse(fs.readFileSync(runtimeConfigPath, 'utf8'));
    const storedProviders = data?.providers || data || {};
    for (const id of Object.keys(defaultProviders)) {
      defaultProviders[id] = {
        token: storedProviders?.[id]?.token || '',
        custom_models: Array.isArray(storedProviders?.[id]?.custom_models) ? storedProviders[id].custom_models : [],
      };
    }
    return { providers: defaultProviders };
  } catch {
    return { providers: defaultProviders };
  }
}

function saveRuntimeConfig(nextConfig) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(runtimeConfigPath, JSON.stringify(nextConfig, null, 2));
}

function getHfToken() {
  return getProviderToken('huggingface');
}

function getHfModelCatalog() {
  const runtime = getRuntimeConfig();
  const custom = {};
  for (const raw of runtime.providers.huggingface.custom_models || []) {
    const id = String(raw || '').trim();
    if (!id) continue;
    custom[id] = { name: id, size: 'custom' };
  }
  return { ...HF_MODELS, ...custom };
}

function getProviderToken(providerId) {
  const runtime = getRuntimeConfig();
  const runtimeToken = runtime.providers?.[providerId]?.token || '';
  if (runtimeToken) return runtimeToken;

  const envMap = {
    groq: CONFIG.groqKey,
    cerebras: CONFIG.cerebrasKey,
    mistral: CONFIG.mistralKey,
    siliconflow: CONFIG.siliconKey,
    gemini: CONFIG.geminiKey,
    huggingface: CONFIG.hfKey,
    llm7: '',
  };
  return envMap[providerId] || '';
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, storedPassword) {
  if (typeof storedPassword !== 'string' || !storedPassword) return false;

  // Backward compatibility for previously saved plain-text local users
  if (!storedPassword.startsWith('scrypt$')) {
    return password === storedPassword;
  }

  const parts = storedPassword.split('$');
  if (parts.length !== 3) return false;
  const [, salt, savedHash] = parts;
  const computedHash = crypto.scryptSync(password, salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(savedHash, 'hex'), Buffer.from(computedHash, 'hex'));
  } catch {
    return false;
  }
}

function saveLocalUser(email, password) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const users = getLocalUsers();
  const normalizedEmail = normalizeEmail(email);
  if (users[normalizedEmail]) return null;
  const id = 'local-' + Date.now();
  users[normalizedEmail] = {
    id,
    email: normalizedEmail,
    password: hashPassword(password),
    created: new Date().toISOString(),
  };
  fs.writeFileSync(localUsersPath, JSON.stringify(users, null, 2));
  return { id, email: normalizedEmail };
}

function verifyLocalUser(email, password) {
  const users = getLocalUsers();
  const user = users[normalizeEmail(email)];
  if (user && verifyPassword(password, user.password)) {
    return { id: user.id, email: user.email };
  }
  return null;
}

// ===== Auth Routes =====
app.post('/auth/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return res.status(400).json({ error: 'Invalid email' });

  // Try Supabase first
  if (supabase) {
    try {
      const { data, error } = await supabase.auth.signUp({ email: normalizedEmail, password });
      if (!error && data.session) {
        return res.json({ user: data.user, session: data.session });
      }
      // If signup succeeded but no session (email confirmation), try auto-login
      if (!error && !data.session) {
        const loginResult = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
        if (loginResult.data?.session) {
          return res.json({ user: loginResult.data.user, session: loginResult.data.session });
        }
      }
    } catch {}
  }

  // Fallback: local auth (no email confirmation needed)
  const localUser = saveLocalUser(normalizedEmail, password);
  if (!localUser) {
    return res.status(409).json({ error: 'User already exists' });
  }
  const token = Buffer.from(JSON.stringify({ id: localUser.id, email: normalizedEmail })).toString('base64');
  res.json({
    user: { id: localUser.id, email: localUser.email },
    session: { access_token: 'local-' + token },
    local: true,
    message: 'Account created (local mode)',
  });
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return res.status(400).json({ error: 'Invalid email' });

  // Try Supabase first
  if (supabase) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
      if (!error && data.session) {
        return res.json({ user: data.user, session: data.session });
      }
    } catch {}
  }

  // Fallback: local auth
  const user = verifyLocalUser(email, password);
  if (user) {
    const token = Buffer.from(JSON.stringify({ id: user.id, email: user.email })).toString('base64');
    return res.json({
      user: { id: user.id, email: user.email },
      session: { access_token: 'local-' + token },
      local: true,
    });
  }

  res.status(401).json({ error: 'Invalid email or password' });
});

app.post('/auth/logout', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token && token.startsWith('local-')) {
    return res.json({ success: true });
  }
  if (supabase && token) {
    try { await supabase.auth.admin.signOut(token); } catch {}
  }
  res.json({ success: true });
});

app.get('/auth/me', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: req.user });
});

// ===== Settings Sync (Supabase) =====
// Get user settings
app.get('/settings', async (req, res) => {
  if (!supabase) return res.json({ settings: getLocalSettings() });
  if (!req.user) return res.json({ settings: getLocalSettings() });

  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', req.user.id)
      .single();

    if (error || !data) return res.json({ settings: getDefaultSettings() });
    res.json({ settings: data.settings || getDefaultSettings() });
  } catch {
    res.json({ settings: getLocalSettings() });
  }
});

// Save user settings
app.post('/settings', async (req, res) => {
  const incoming = req.body;
  if (!incoming) return res.status(400).json({ error: 'No settings provided' });
  const settings = { ...getDefaultSettings(), ...getLocalSettings(), ...incoming };

  // Always save locally
  saveLocalSettings(settings);

  // Sync to Supabase if authenticated
  if (supabase && req.user) {
    try {
      const { error } = await supabase
        .from('user_settings')
        .upsert({
          user_id: req.user.id,
          settings,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      if (error) {
        console.error('Supabase settings sync error:', error.message);
        return res.json({ success: true, synced: false, message: 'Saved locally, Supabase sync failed' });
      }
      res.json({ success: true, synced: true, message: 'Settings saved & synced!' });
    } catch (err) {
      res.json({ success: true, synced: false, message: 'Saved locally, sync error: ' + err.message });
    }
  } else {
    res.json({ success: true, synced: false, message: 'Saved locally (login to sync)' });
  }
});

app.get('/settings/providers', (req, res) => {
  const runtime = getRuntimeConfig();
  const providers = {};
  for (const id of Object.keys(runtime.providers || {})) {
    providers[id] = {
      configured: !!getProviderToken(id),
      has_runtime_token: !!runtime.providers[id]?.token,
      custom_models: runtime.providers[id]?.custom_models || [],
    };
  }
  res.json({
    providers,
  });
});

app.post('/settings/providers/:providerId', (req, res) => {
  const providerId = req.params.providerId;
  const runtime = getRuntimeConfig();
  if (!runtime.providers?.[providerId]) {
    return res.status(400).json({ error: 'Unsupported provider: ' + providerId });
  }

  const { token, custom_models } = req.body || {};

  const normalizedModels = Array.isArray(custom_models)
    ? custom_models.map(v => String(v || '').trim()).filter(Boolean)
    : [];

  runtime.providers[providerId] = {
    token: typeof token === 'string' ? token.trim() : (runtime.providers[providerId].token || ''),
    custom_models: [...new Set(normalizedModels)],
  };

  saveRuntimeConfig(runtime);

  const providers = {};
  for (const id of Object.keys(runtime.providers || {})) {
    providers[id] = {
      configured: !!getProviderToken(id),
      has_runtime_token: !!runtime.providers[id]?.token,
      custom_models: runtime.providers[id]?.custom_models || [],
    };
  }

  res.json({
    success: true,
    message: `${providerId} settings saved`,
    providers,
  });
});

// Sync SOUL to Supabase
app.post('/settings/soul', async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'No content' });

  // Save locally
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'soul.md'), content);
  soulCache = content;

  const merged = mergeAndSaveLocalSettings({ soul: content });

  // Sync to Supabase
  if (supabase && req.user) {
    try {
      await (supabaseAdmin || supabase).from('user_settings').upsert({
        user_id: req.user.id,
        settings: merged,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    } catch {}
  }

  res.json({ success: true, message: '✅ SOUL saved!' });
});

// Sync MEMORY to Supabase
app.post('/settings/memory', async (req, res) => {
  const { content, append = true } = req.body;
  if (!content) return res.status(400).json({ error: 'No content' });

  // Save locally
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const memoryPath = path.join(DATA_DIR, 'memory.md');
  if (append && fs.existsSync(memoryPath)) {
    fs.appendFileSync(memoryPath, '\n\n---\n\n' + content);
  } else {
    fs.writeFileSync(memoryPath, content);
  }
  memoryCache = fs.readFileSync(memoryPath, 'utf8');
  const merged = mergeAndSaveLocalSettings({ memory: memoryCache });

  // Sync to Supabase
  if (supabase && req.user) {
    try {
      await (supabaseAdmin || supabase).from('user_settings').upsert({
        user_id: req.user.id,
        settings: merged,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    } catch {}
  }

  res.json({ success: true, message: '✅ Memory saved & synced!' });
});

app.post('/settings/agent', async (req, res) => {
  const { content } = req.body || {};
  if (!content || typeof content !== 'string') return res.status(400).json({ error: 'No agent content' });
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'agent.md'), content.trim());
  agentCache = content.trim();
  const merged = mergeAndSaveLocalSettings({ agent_profile: agentCache });
  if (supabase && req.user) {
    try {
      await (supabaseAdmin || supabase).from('user_settings').upsert({
        user_id: req.user.id,
        settings: merged,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    } catch {}
  }
  res.json({ success: true, message: '✅ Agent profile saved' });
});

app.post('/settings/tools', async (req, res) => {
  const { content } = req.body || {};
  if (!content || typeof content !== 'string') return res.status(400).json({ error: 'No tools content' });
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'tools.md'), content.trim());
  toolsCache = content.trim();
  const merged = mergeAndSaveLocalSettings({ tools_profile: toolsCache });
  if (supabase && req.user) {
    try {
      await (supabaseAdmin || supabase).from('user_settings').upsert({
        user_id: req.user.id,
        settings: merged,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    } catch {}
  }
  res.json({ success: true, message: '✅ Tools profile saved' });
});

// Helper functions
function getDefaultSettings() {
  return {
    model: 'llama-3.1-8b-instant',
    provider: CONFIG.defaultProvider,
    theme: 'dark',
    ollama_url: CONFIG.ollama,
    gateway_url: CONFIG.gateway,
    system_prompt: '',
    soul: '',
    memory: '',
    agent_profile: '',
    tools_profile: '',
    enabled_skills: [],
    strict_skill_mode: true,
    skill_instructions: '',
  };
}

function getLocalSettings() {
  const settingsPath = path.join(DATA_DIR, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    return JSON.parse(fs.readFileSync(settingsPath));
  }
  return getDefaultSettings();
}

function saveLocalSettings(settings) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'settings.json'), JSON.stringify(settings, null, 2));
}

function mergeAndSaveLocalSettings(partial) {
  const current = getLocalSettings();
  const merged = { ...current, ...(partial || {}) };
  saveLocalSettings(merged);
  return merged;
}

async function getEffectiveSettings(req) {
  const local = getLocalSettings();
  if (!supabase || !req?.user?.id) return local;
  try {
    const { data, error } = await (supabaseAdmin || supabase)
      .from('user_settings')
      .select('settings')
      .eq('user_id', req.user.id)
      .single();
    if (error || !data?.settings) return local;
    return { ...local, ...data.settings };
  } catch {
    return local;
  }
}

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

// ===== Groq Chat Helper =====
async function chatGroq(message, model, system) {
  const groqToken = getProviderToken('groq');
  if (!groqToken) throw new Error('GROQ token nije postavljen');
  const groqModel = model && model.startsWith('llama') ? model : 'llama-3.1-8b-instant';

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: message });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${groqToken}`,
    },
    body: JSON.stringify({ model: groqModel, messages, max_tokens: 1024 }),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Groq error');

  const text = data.choices?.[0]?.message?.content || 'No response';
  return { response: text, model: groqModel, provider: 'groq' };
}

// ===== Gemini Chat Helper =====
async function chatGemini(message, model, system) {
  const geminiToken = getProviderToken('gemini');
  if (!geminiToken) throw new Error('Gemini token nije postavljen');
  const geminiModel = model && model.startsWith('gemini') ? model : 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiToken}`;

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

// ===== HuggingFace Chat Helper =====
// Modeli dostupni besplatno na HF Inference API (bez storage-a na Railway)
const HF_MODELS = {
  // Llama
  'meta-llama/Llama-3.2-3B-Instruct':      { name: 'Llama 3.2 3B',       size: '3B'  },
  'meta-llama/Llama-3.1-8B-Instruct':      { name: 'Llama 3.1 8B',       size: '8B'  },
  'meta-llama/Llama-3.1-70B-Instruct':     { name: 'Llama 3.1 70B',      size: '70B' },
  // Mistral
  'mistralai/Mistral-7B-Instruct-v0.3':    { name: 'Mistral 7B',         size: '7B'  },
  'mistralai/Mixtral-8x7B-Instruct-v0.1':  { name: 'Mixtral 8x7B',       size: '47B' },
  // Phi
  'microsoft/Phi-3.5-mini-instruct':       { name: 'Phi 3.5 Mini',       size: '3.8B'},
  'microsoft/Phi-3-medium-4k-instruct':    { name: 'Phi 3 Medium',       size: '14B' },
  // Google
  'google/gemma-2-9b-it':                  { name: 'Gemma 2 9B',         size: '9B'  },
  'google/gemma-2-27b-it':                 { name: 'Gemma 2 27B',        size: '27B' },
  // Qwen
  'Qwen/Qwen2.5-7B-Instruct':             { name: 'Qwen 2.5 7B',        size: '7B'  },
  'Qwen/Qwen2.5-72B-Instruct':            { name: 'Qwen 2.5 72B',       size: '72B' },
  // Code
  'Qwen/Qwen2.5-Coder-32B-Instruct':      { name: 'Qwen Coder 32B',     size: '32B' },
  // Zephyr
  'HuggingFaceH4/zephyr-7b-beta':          { name: 'Zephyr 7B',          size: '7B'  },
};

const HF_DEFAULT_MODEL = 'mistralai/Mistral-7B-Instruct-v0.3';

async function chatHuggingFace(message, model, system) {
  const hfToken = getHfToken();
  if (!hfToken) throw new Error('HUGGINGFACE_TOKEN nije postavljen u Railway Variables');
  const hfCatalog = getHfModelCatalog();

  // Prihvatamo i kratka imena (npr. "Qwen2.5-7B") i puna HF ID-a
  let hfModel = model;
  if (!model || (!model.includes('/') && !hfCatalog[model])) {
    hfModel = HF_DEFAULT_MODEL;
  }

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: message });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  const res = await fetch(
    `https://router.huggingface.co/hf-inference/models/${hfModel}/v1/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${hfToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model: hfModel,
        messages,
        max_tokens: 1024,
        temperature: 0.7,
        stream: false,
      }),
      signal: controller.signal,
    }
  );
  clearTimeout(timeout);

  if (!res.ok) {
    const errText = await res.text();
    // Model se učitava — čest slučaj za rijetko korištene modele
    if (res.status === 503) throw new Error(`HF model se učitava, pokušaj za 20s. (${hfModel})`);
    throw new Error(`HuggingFace greška ${res.status}: ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || 'Nema odgovora';
  return { response: text, model: hfModel, provider: 'huggingface' };
}

async function streamHuggingFace(message, model, system, res, history) {
  const hfToken = getHfToken();
  if (!hfToken) throw new Error('HUGGINGFACE_TOKEN nije postavljen');
  const hfCatalog = getHfModelCatalog();

  let hfModel = model;
  if (!model || (!model.includes('/') && !hfCatalog[model])) hfModel = HF_DEFAULT_MODEL;

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  if (history && Array.isArray(history)) {
    const recent = history.slice(-10);
    for (const h of recent) {
      if (h.role && h.content) messages.push({ role: h.role, content: h.content.substring(0, 500) });
    }
  }
  messages.push({ role: 'user', content: message });

  const hfRes = await fetch(
    `https://router.huggingface.co/hf-inference/models/${hfModel}/v1/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${hfToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model: hfModel,
        messages,
        max_tokens: 2048,
        temperature: 0.7,
        stream: true,
      }),
    }
  );

  if (!hfRes.ok) {
    const errText = await hfRes.text();
    if (hfRes.status === 503) throw new Error(`HF model se učitava (${hfModel}), pokušaj za 20s`);
    throw new Error(`HuggingFace greška ${hfRes.status}: ${errText.substring(0, 200)}`);
  }

  const reader = hfRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') {
        res.write(`data: ${JSON.stringify({ done: true, model: hfModel, provider: 'huggingface' })}\n\n`);
        return;
      }
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
      } catch {}
    }
  }

  res.write(`data: ${JSON.stringify({ done: true, model: hfModel, provider: 'huggingface' })}\n\n`);
}


// ===== FREE PROVIDERS — Besplatni i Brzi 2026 =====

// ── Groq model lista (700+ tok/sec, besplatno, 14.400/dan) ────
const GROQ_MODELS = {
  'llama-3.3-70b-versatile':   { name: 'Llama 3.3 70B',        speed: '⚡⚡⚡', size: '70B' },
  'llama-3.1-8b-instant':      { name: 'Llama 3.1 8B Instant', speed: '⚡⚡⚡', size: '8B'  },
  'llama-3.2-3b-preview':      { name: 'Llama 3.2 3B',         speed: '⚡⚡⚡', size: '3B'  },
  'mixtral-8x7b-32768':        { name: 'Mixtral 8x7B',         speed: '⚡⚡',  size: '47B' },
  'gemma2-9b-it':              { name: 'Gemma 2 9B',           speed: '⚡⚡⚡', size: '9B'  },
  'deepseek-r1-distill-llama-70b': { name: 'DeepSeek R1 70B', speed: '⚡⚡',  size: '70B' },
};

// ── Cerebras (hardware LPU, brz kao Groq, besplatno) ─────────
const CEREBRAS_MODELS = {
  'llama-3.3-70b':  { name: 'Llama 3.3 70B',  speed: '⚡⚡⚡', size: '70B'  },
  'llama3.1-8b':    { name: 'Llama 3.1 8B',   speed: '⚡⚡⚡', size: '8B'   },
  'qwen-3-32b':     { name: 'Qwen 3 32B',     speed: '⚡⚡',  size: '32B'  },
};

// ── LLM7 (BEZ API KLJUČA — radi odmah!) ───────────────────────
const LLM7_MODELS = {
  'deepseek-r1':               { name: 'DeepSeek R1',           speed: '⚡⚡',  size: '671B' },
  'deepseek-chat':             { name: 'DeepSeek V3',           speed: '⚡⚡⚡', size: '671B' },
  'qwen/qwen2.5-72b-instruct': { name: 'Qwen 2.5 72B',         speed: '⚡⚡',  size: '72B'  },
  'qwen/qwen2.5-coder-32b-instruct': { name: 'Qwen Coder 32B', speed: '⚡⚡',  size: '32B'  },
  'microsoft/phi-4':           { name: 'Phi 4',                 speed: '⚡⚡⚡', size: '14B'  },
  'mistralai/mistral-small-3.1-24b-instruct': { name: 'Mistral Small 3.1', speed: '⚡⚡', size: '24B' },
};

// ── Mistral AI (besplatno, 1B tok/mj) ────────────────────────
const MISTRAL_MODELS = {
  'mistral-small-latest':   { name: 'Mistral Small 3.1', speed: '⚡⚡⚡', size: '24B'  },
  'mistral-large-latest':   { name: 'Mistral Large 3',   speed: '⚡⚡',  size: '123B' },
  'open-mistral-nemo':      { name: 'Mistral Nemo',      speed: '⚡⚡⚡', size: '12B'  },
  'codestral-latest':       { name: 'Codestral',         speed: '⚡⚡',  size: '22B'  },
};

// ── SiliconFlow (1000 RPM, 50K TPM — najveći besplatni limiti) ─
const SILICON_MODELS = {
  'Qwen/Qwen3-8B':                    { name: 'Qwen 3 8B',          speed: '⚡⚡⚡', size: '8B'  },
  'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B': { name: 'DeepSeek R1 7B', speed: '⚡⚡⚡', size: '7B' },
  'THUDM/glm-4-9b-chat':             { name: 'GLM 4 9B',            speed: '⚡⚡⚡', size: '9B'  },
  'internlm/internlm2_5-7b-chat':    { name: 'InternLM 2.5 7B',     speed: '⚡⚡⚡', size: '7B'  },
};

function getProviderModelCatalog(provider) {
  const runtime = getRuntimeConfig();
  const customList = runtime.providers?.[provider]?.custom_models || [];
  const custom = {};
  for (const raw of customList) {
    const id = String(raw || '').trim();
    if (!id) continue;
    custom[id] = { name: id, size: 'custom', speed: '⚡' };
  }

  if (provider === 'groq') return { ...GROQ_MODELS, ...custom };
  if (provider === 'cerebras') return { ...CEREBRAS_MODELS, ...custom };
  if (provider === 'llm7') return { ...LLM7_MODELS, ...custom };
  if (provider === 'mistral') return { ...MISTRAL_MODELS, ...custom };
  if (provider === 'siliconflow') return { ...SILICON_MODELS, ...custom };
  if (provider === 'huggingface') return getHfModelCatalog();
  if (provider === 'gemini') {
    const base = {
      'gemini-2.0-flash': { name: 'Gemini 2.0 Flash', speed: '⚡⚡⚡', size: 'cloud' },
      'gemini-1.5-flash': { name: 'Gemini 1.5 Flash', speed: '⚡⚡⚡', size: 'cloud' },
      'gemini-1.5-pro': { name: 'Gemini 1.5 Pro', speed: '⚡⚡', size: 'cloud' },
    };
    return { ...base, ...custom };
  }
  return custom;
}

function resolveProviderModel(provider, requestedModel) {
  const requested = String(requestedModel || '').trim();
  const catalog = getProviderModelCatalog(provider);
  const hasRequested = requested && Object.prototype.hasOwnProperty.call(catalog, requested);

  if (provider === 'groq')       return hasRequested ? requested : 'llama-3.1-8b-instant';
  if (provider === 'cerebras')   return hasRequested ? requested : 'llama-3.3-70b';
  if (provider === 'llm7')       return hasRequested ? requested : 'deepseek-chat';
  if (provider === 'mistral')    return hasRequested ? requested : 'mistral-small-latest';
  if (provider === 'siliconflow')return hasRequested ? requested : 'Qwen/Qwen3-8B';
  if (provider === 'huggingface')return hasRequested ? requested : (requested || HF_DEFAULT_MODEL);
  if (provider === 'gemini')     return hasRequested ? requested : (requested || 'gemini-1.5-flash');
  return requested || 'llama-3.1-8b-instant';
}

// ── Generička OpenAI-compatible chat funkcija ─────────────────
async function chatOpenAICompat({ baseUrl, apiKey, model, message, system, maxTokens = 1024 }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: message });

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: false }),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${baseUrl} greška ${res.status}: ${errText.substring(0, 150)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || 'Nema odgovora';
}

// ── Generička streaming funkcija za sve OpenAI-compat providere ─
async function streamOpenAICompat({ baseUrl, apiKey, model, provider, message, system, res: httpRes, history = [] }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  if (history?.length) {
    history.slice(-10).forEach(h => {
      if (h.role && h.content) messages.push({ role: h.role, content: h.content.substring(0, 500) });
    });
  }
  messages.push({ role: 'user', content: message });

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const apiRes = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages, max_tokens: 2048, stream: true }),
  });

  if (!apiRes.ok) {
    const errText = await apiRes.text();
    throw new Error(`${baseUrl} greška ${apiRes.status}: ${errText.substring(0, 150)}`);
  }

  const reader = apiRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') { httpRes.write(`data: ${JSON.stringify({ done: true, model, provider })}

`); return; }
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) httpRes.write(`data: ${JSON.stringify({ content })}

`);
      } catch {}
    }
  }

  httpRes.write(`data: ${JSON.stringify({ done: true, model, provider })}\n\n`);
}

// ── Provider dispatch funkcije ────────────────────────────────
async function chatCerebras(message, model, system) {
  const text = await chatOpenAICompat({
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKey: getProviderToken('cerebras'),
    model: model || 'llama-3.3-70b',
    message, system,
  });
  return { response: text, model: model || 'llama-3.3-70b', provider: 'cerebras' };
}

async function chatLLM7(message, model, system) {
  const text = await chatOpenAICompat({
    baseUrl: CONFIG.llm7BaseUrl,
    apiKey: null,  // BEZ API KLJUČA
    model: model || 'deepseek-chat',
    message, system,
  });
  return { response: text, model: model || 'deepseek-chat', provider: 'llm7' };
}

async function chatMistralAI(message, model, system) {
  const text = await chatOpenAICompat({
    baseUrl: 'https://api.mistral.ai/v1',
    apiKey: getProviderToken('mistral'),
    model: model || 'mistral-small-latest',
    message, system,
  });
  return { response: text, model: model || 'mistral-small-latest', provider: 'mistral' };
}

async function chatSiliconFlow(message, model, system) {
  const text = await chatOpenAICompat({
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKey: getProviderToken('siliconflow'),
    model: model || 'Qwen/Qwen3-8B',
    message, system,
  });
  return { response: text, model: model || 'Qwen/Qwen3-8B', provider: 'siliconflow' };
}

// ===== Skill Auto-Detection =====
function detectSkill(message) {
  const lower = message.toLowerCase().trim();

  // === Smart install/search detection for upload skill ===
  const installPatterns = [
    /(?:install|instaliraj|dodaj|setup)\s+(?:skill|skillo?)?\s*(.+)/i,
    /(?:nađi|nadji|find|search|traži|trazi)\s+(?:skill|skillo?)?\s*(.+)/i,
    /(?:želim|hocu|hoću|want)\s+(?:skill|skillo?)?\s*(.+)/i,
  ];

  for (const pattern of installPatterns) {
    const match = message.match(pattern);
    if (match) {
      const query = match[1]?.trim() || '';
      const skillManagerId = loadedSkills.skills && isSkillActive('skills') ? 'skills' : 'upload';
      if (lower.includes('install') || lower.includes('instaliraj') || lower.includes('dodaj') || lower.includes('želim') || lower.includes('hocu') || lower.includes('hoću') || lower.includes('want')) {
        return {
          id: skillManagerId,
          params: { task: message, action: 'install', slug: query || message }
        };
      }
      return {
        id: skillManagerId,
        params: { task: message, action: 'search', query: query || message }
      };
    }
  }

  // === General trigger matching ===
  for (const [id, skill] of Object.entries(loadedSkills)) {
    if (!isSkillActive(id)) continue;
    if (!skill.triggers || skill.triggers.length === 0) continue;

    for (const trigger of skill.triggers) {
      if (lower.includes(trigger.toLowerCase())) {
        // Extract params from message
        const params = { task: message, action: 'default' };

        // Parse common patterns
        if (lower.includes('install')) params.action = 'install';
        if (lower.includes('search')) params.action = 'search';
        if (lower.includes('list')) params.action = 'list';
        if (lower.includes('remove') || lower.includes('delete')) params.action = 'remove';
        if (lower.includes('translate')) {
          params.action = 'default';
          const langMatch = lower.match(/(?:to|na|u|in)\s+(\w+)/);
          if (langMatch) params.to = langMatch[1];
          params.text = message.replace(/translate|prevedi|to|na|u|in/gi, '').trim();
        }
        if (lower.includes('weather')) {
          const cityMatch = lower.match(/(?:weather|forecast|temperatura).*?(?:in|u|for)\s+(\w+)/);
          if (cityMatch) params.city = cityMatch[1];
        }

        // Extract skill name for install actions
        if (id === 'upload' && params.action === 'install') {
          const nameMatch = message.match(/(?:install|instaliraj|dodaj)\s+(?:skill\s+)?(.+)/i);
          if (nameMatch) params.slug = nameMatch[1].trim();
        }

        return { id, params };
      }
    }
  }

  return null;
}

function buildSelectedSkillsContext(skillIds = []) {
  const ids = Array.isArray(skillIds) ? skillIds : [];
  if (!ids.length) return '';
  const lines = [];
  for (const id of ids) {
    const skill = loadedSkills[id];
    if (!skill || !isSkillActive(id)) continue;
    lines.push(`- ${id}: ${skill.description || 'No description'}${Array.isArray(skill.triggers) && skill.triggers.length ? ` (triggers: ${skill.triggers.join(', ')})` : ''}`);
  }
  if (!lines.length) return '';
  return `[Enabled Skills Knowledge]\nUse these installed skills as authoritative context when relevant:\n${lines.join('\n')}`;
}

// ===== Bot Chat Endpoint (auto-select provider + skill routing) =====
app.post('/chat', async (req, res) => {
  const { message, model, system } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  const provider = req.body.provider || CONFIG.defaultProvider;

  try {
    const effectiveSettings = await getEffectiveSettings(req);
    const allowedSkills = Array.isArray(effectiveSettings.enabled_skills)
      ? effectiveSettings.enabled_skills.map(v => String(v || '').trim()).filter(Boolean)
      : [];
    const strictSkillMode = effectiveSettings.strict_skill_mode !== false;
    const skillInstructions = String(effectiveSettings.skill_instructions || '').trim();

    // Build enhanced system prompt with SOUL + MEMORY
    let enhancedSystem = system || '';
    if (soulCache) {
      enhancedSystem = `[Bot Personality - SOUL]\n${soulCache}\n\n${enhancedSystem}`;
    }
    if (memoryCache) {
      enhancedSystem = `${enhancedSystem}\n\n[Memory - Context]\n${memoryCache.substring(0, 2000)}`;
    }
    if (agentCache) enhancedSystem = `${enhancedSystem}\n\n[Agent Profile]\n${agentCache.substring(0, 2000)}`;
    if (toolsCache) enhancedSystem = `${enhancedSystem}\n\n[Tools]\n${toolsCache.substring(0, 2000)}`;
    const selectedSkillsContext = buildSelectedSkillsContext(allowedSkills);
    if (selectedSkillsContext) enhancedSystem = `${enhancedSystem}\n\n${selectedSkillsContext}`;

    // Auto-detect skill triggers
    let matchedSkill = detectSkill(message);
    if (matchedSkill && allowedSkills.length && !allowedSkills.includes(matchedSkill.id)) {
      matchedSkill = null;
    }
    let skillResult = null;

    if (matchedSkill) {
      const skill = loadedSkills[matchedSkill.id];
      if (skill && skill.handler && skill.handler.run) {
        try {
          skillResult = await skill.handler.run(matchedSkill.params);
          if (skillResult.instructions) {
            // Skill wants LLM to process — add context to system prompt
            enhancedSystem = `${enhancedSystem}\n\n[Skill: ${matchedSkill.id}]\n${skillResult.systemPrompt || ''}\n\nTask: ${skillResult.instructions}\n${skillResult.context ? 'Context: ' + skillResult.context : ''}`;
            if (strictSkillMode) {
              enhancedSystem += `\n\n[MANDATORY SKILL EXECUTION]\nYou MUST prioritize and follow the active skill instructions before any other reasoning.`;
            }
          } else if (skillResult.response || skillResult.output || skillResult.translated) {
            // Skill has direct answer — return it
            return res.json({
              response: skillResult.response || skillResult.output || skillResult.translated || JSON.stringify(skillResult, null, 2),
              model: 'skill:' + matchedSkill.id,
              provider: 'skill',
              skill: matchedSkill.id,
            });
          }
        } catch (skillErr) {
          console.error(`Skill ${matchedSkill.id} error:`, skillErr.message);
        }
      }
    }

    let result;
    const chatMessage = skillResult?.instructions ? skillResult.instructions : message;
    if (!matchedSkill && strictSkillMode && skillInstructions) {
      enhancedSystem = `${enhancedSystem}\n\n[Skill manager default instructions]\n${skillInstructions}`;
    }

    // Skill can override model (e.g. knowledge uses 70B)
    const chatModel = skillResult?.model || model;

    if (provider === 'groq' && getProviderToken('groq')) {
      result = await chatGroq(chatMessage, resolveProviderModel('groq', chatModel), enhancedSystem);
    } else if (provider === 'cerebras' && getProviderToken('cerebras')) {
      result = await chatCerebras(chatMessage, resolveProviderModel('cerebras', chatModel), enhancedSystem);
    } else if (provider === 'gemini' && getProviderToken('gemini')) {
      result = await chatGemini(chatMessage, resolveProviderModel('gemini', chatModel), enhancedSystem);
    } else if (provider === 'mistral' && getProviderToken('mistral')) {
      result = await chatMistralAI(chatMessage, resolveProviderModel('mistral', chatModel), enhancedSystem);
    } else if (provider === 'siliconflow' && getProviderToken('siliconflow')) {
      result = await chatSiliconFlow(chatMessage, resolveProviderModel('siliconflow', chatModel), enhancedSystem);
    } else if (provider === 'huggingface' && getHfToken()) {
      result = await chatHuggingFace(chatMessage, resolveProviderModel('huggingface', chatModel), enhancedSystem);
    } else if (provider === 'llm7') {
      result = await chatLLM7(chatMessage, resolveProviderModel('llm7', chatModel), enhancedSystem);
    } else {
      // Fallback chain: Ollama → Groq → Cerebras → LLM7 (uvijek dostupan)
      try {
        result = await chatOllama(chatMessage, chatModel, enhancedSystem);
      } catch (ollamaErr) {
        console.log('Ollama failed, trying fallbacks...', ollamaErr.message);
        try {
          if (getProviderToken('groq'))      result = await chatGroq(chatMessage, chatModel, enhancedSystem);
          else if (getProviderToken('cerebras')) result = await chatCerebras(chatMessage, chatModel, enhancedSystem);
          else if (getProviderToken('gemini'))   result = await chatGemini(chatMessage, chatModel, enhancedSystem);
          else if (getProviderToken('mistral'))  result = await chatMistralAI(chatMessage, chatModel, enhancedSystem);
          else if (getHfToken())       result = await chatHuggingFace(chatMessage, chatModel, enhancedSystem);
          else                         result = await chatLLM7(chatMessage, chatModel, enhancedSystem);
        } catch (fallbackErr) {
          // LLM7 je uvijek zadnji resort — bez ključa
          result = await chatLLM7(chatMessage, null, enhancedSystem);
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

// ===== Streaming Chat (SSE) =====
app.post('/chat/stream', async (req, res) => {
  const { message, model, system, history } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  // Rate limit check
  const userId = req.user?.id || req.ip;
  const userEmail = req.user?.email || '';
  const rateCheck = checkRateLimit(userId, userEmail);
  if (!rateCheck.allowed) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again in a minute.', remaining: 0 });
  }

  // Analytics
  analytics.messages++;
  if (userEmail) analytics.users.add(userEmail);

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-RateLimit-Remaining', rateCheck.remaining);

  const provider = req.body.provider || CONFIG.defaultProvider;

  try {
    const effectiveSettings = await getEffectiveSettings(req);
    const allowedSkills = Array.isArray(effectiveSettings.enabled_skills)
      ? effectiveSettings.enabled_skills.map(v => String(v || '').trim()).filter(Boolean)
      : [];
    const strictSkillMode = effectiveSettings.strict_skill_mode !== false;
    const skillInstructions = String(effectiveSettings.skill_instructions || '').trim();

    // Build enhanced system prompt with SOUL + MEMORY
    let enhancedSystem = system || '';
    if (soulCache) enhancedSystem = `[Bot Personality]\n${soulCache}\n\n${enhancedSystem}`;
    if (memoryCache) enhancedSystem = `${enhancedSystem}\n\n[Memory]\n${memoryCache.substring(0, 2000)}`;
    if (agentCache) enhancedSystem = `${enhancedSystem}\n\n[Agent Profile]\n${agentCache.substring(0, 2000)}`;
    if (toolsCache) enhancedSystem = `${enhancedSystem}\n\n[Tools]\n${toolsCache.substring(0, 2000)}`;
    const selectedSkillsContext = buildSelectedSkillsContext(allowedSkills);
    if (selectedSkillsContext) enhancedSystem = `${enhancedSystem}\n\n${selectedSkillsContext}`;

    // Skill detection
    let matchedSkill = detectSkill(message);
    if (matchedSkill && allowedSkills.length && !allowedSkills.includes(matchedSkill.id)) {
      matchedSkill = null;
    }
    let skillResult = null;
    let chatMessage = message;
    let chatModel = model;

    if (matchedSkill) {
      const skill = loadedSkills[matchedSkill.id];
      if (skill?.handler?.run) {
        try {
          skillResult = await skill.handler.run(matchedSkill.params);
          if (skillResult.instructions) {
            enhancedSystem = `${enhancedSystem}\n\n[Skill: ${matchedSkill.id}]\n${skillResult.systemPrompt || ''}\nTask: ${skillResult.instructions}`;
            if (strictSkillMode) {
              enhancedSystem += `\n\n[MANDATORY SKILL EXECUTION]\nYou MUST prioritize and follow the active skill instructions before any other reasoning.`;
            }
            chatMessage = skillResult.instructions;
          } else if (skillResult.response || skillResult.output || skillResult.translated) {
            res.write(`data: ${JSON.stringify({ content: skillResult.response || skillResult.output || skillResult.translated, done: true, skill: matchedSkill.id })}\n\n`);
            res.end();
            return;
          }
          if (skillResult.model) chatModel = skillResult.model;
        } catch {}
      }
    }

    // Track model usage
    const usedModel = chatModel || (provider === 'groq' ? 'llama-3.1-8b-instant' : 'default');
    analytics.models_used[usedModel] = (analytics.models_used[usedModel] || 0) + 1;
    if (matchedSkill) analytics.skills_used[matchedSkill.id] = (analytics.skills_used[matchedSkill.id] || 0) + 1;

    // Stream from Groq
    if (provider === 'groq' && getProviderToken('groq')) {
      const groqModel = resolveProviderModel('groq', chatModel);
      const messages = [];
      if (enhancedSystem) messages.push({ role: 'system', content: enhancedSystem });
      
      // Add chat history (last 10 messages for context)
      if (history && Array.isArray(history)) {
        const recentHistory = history.slice(-10);
        for (const h of recentHistory) {
          if (h.role && h.content) {
            messages.push({ role: h.role, content: h.content.substring(0, 500) });
          }
        }
      }
      
      messages.push({ role: 'user', content: chatMessage });

      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getProviderToken('groq')}`,
        },
        body: JSON.stringify({ model: groqModel, messages, max_tokens: 2048, stream: true }),
      });

      const reader = groqRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              res.write(`data: ${JSON.stringify({ done: true, model: groqModel, provider: 'groq' })}\n\n`);
            } else {
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  res.write(`data: ${JSON.stringify({ content })}\n\n`);
                }
              } catch {}
            }
          }
        }
      }
    } else if (provider === 'cerebras' && getProviderToken('cerebras')) {
      const modelToUse = resolveProviderModel('cerebras', chatModel);
      await streamOpenAICompat({ baseUrl: 'https://api.cerebras.ai/v1', apiKey: getProviderToken('cerebras'), model: modelToUse, provider: 'cerebras', message: chatMessage, system: enhancedSystem, res, history });
    } else if (provider === 'mistral' && getProviderToken('mistral')) {
      const modelToUse = resolveProviderModel('mistral', chatModel);
      await streamOpenAICompat({ baseUrl: 'https://api.mistral.ai/v1', apiKey: getProviderToken('mistral'), model: modelToUse, provider: 'mistral', message: chatMessage, system: enhancedSystem, res, history });
    } else if (provider === 'siliconflow' && getProviderToken('siliconflow')) {
      const modelToUse = resolveProviderModel('siliconflow', chatModel);
      await streamOpenAICompat({ baseUrl: 'https://api.siliconflow.cn/v1', apiKey: getProviderToken('siliconflow'), model: modelToUse, provider: 'siliconflow', message: chatMessage, system: enhancedSystem, res, history });
    } else if (provider === 'huggingface' && getHfToken()) {
      await streamHuggingFace(chatMessage, chatModel, enhancedSystem, res, history);
    } else if (provider === 'llm7') {
      const modelToUse = resolveProviderModel('llm7', chatModel);
      const result = await chatLLM7(chatMessage, modelToUse, enhancedSystem);
      res.write(`data: ${JSON.stringify({ content: result.response, done: true, model: result.model, provider: 'llm7' })}\n\n`);
    } else {
      // Non-streaming fallback → uvijek završi na LLM7
      let result;
      try {
        if (provider === 'gemini' && getProviderToken('gemini')) result = await chatGemini(chatMessage, chatModel, enhancedSystem);
        else result = await chatOllama(chatMessage, chatModel, enhancedSystem);
      } catch {
        try {
          if (getProviderToken('groq'))    result = await chatGroq(chatMessage, chatModel, enhancedSystem);
          else if (getHfToken()) result = await chatHuggingFace(chatMessage, chatModel, enhancedSystem);
          else                   result = await chatLLM7(chatMessage, chatModel, enhancedSystem);
        } catch { result = await chatLLM7(chatMessage, 'deepseek-chat', enhancedSystem); }
      }
      res.write(`data: ${JSON.stringify({ content: result.response, done: true, model: result.model, provider: result.provider || provider })}\n\n`);
    }

    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message, done: true })}\n\n`);
    res.end();
  }
});

// ===== Providers + Models Endpoint =====
// Vraća sve providere i modele za UI dropdown
app.get('/models/providers', (req, res) => {
  const providers = [
    {
      id: 'groq',
      name: '⚡ Groq',
      badge: 'GROQ',
      description: '700+ tok/sec — najbrži API',
      configured: !!getProviderToken('groq'),
      key_url: 'https://console.groq.com',
      models: Object.entries(getProviderModelCatalog('groq')).map(([id, m]) => ({ id, ...m, provider: 'groq' })),
    },
    {
      id: 'cerebras',
      name: '⚡ Cerebras',
      badge: 'CEREBRAS',
      description: 'LPU inference — brz kao Groq',
      configured: !!getProviderToken('cerebras'),
      key_url: 'https://cloud.cerebras.ai',
      models: Object.entries(getProviderModelCatalog('cerebras')).map(([id, m]) => ({ id, ...m, provider: 'cerebras' })),
    },
    {
      id: 'llm7',
      name: '🆓 LLM7',
      badge: 'FREE',
      description: 'Bez API ključa — radi odmah',
      configured: true,  // uvijek dostupan
      key_url: null,
      models: Object.entries(getProviderModelCatalog('llm7')).map(([id, m]) => ({ id, ...m, provider: 'llm7' })),
    },
    {
      id: 'mistral',
      name: '🌬️ Mistral AI',
      badge: 'MISTRAL',
      description: '1B tokena/mj besplatno',
      configured: !!getProviderToken('mistral'),
      key_url: 'https://console.mistral.ai',
      models: Object.entries(getProviderModelCatalog('mistral')).map(([id, m]) => ({ id, ...m, provider: 'mistral' })),
    },
    {
      id: 'siliconflow',
      name: '🔷 SiliconFlow',
      badge: 'SILICON',
      description: '1000 RPM besplatno',
      configured: !!getProviderToken('siliconflow'),
      key_url: 'https://siliconflow.cn',
      models: Object.entries(getProviderModelCatalog('siliconflow')).map(([id, m]) => ({ id, ...m, provider: 'siliconflow' })),
    },
    {
      id: 'gemini',
      name: '✨ Google Gemini',
      badge: 'GEMINI',
      description: '1M token context besplatno',
      configured: !!getProviderToken('gemini'),
      key_url: 'https://aistudio.google.com',
      models: Object.entries(getProviderModelCatalog('gemini')).map(([id, m]) => ({ id, ...m, provider: 'gemini' })),
    },
    {
      id: 'huggingface',
      name: '🤗 HuggingFace',
      badge: 'HF',
      description: '50GB storage, cloud inference',
      configured: !!getHfToken(),
      key_url: 'https://huggingface.co/settings/tokens',
      models: Object.entries(getHfModelCatalog()).map(([id, m]) => ({ id, ...m, provider: 'huggingface' })),
    },
    {
      id: 'ollama',
      name: '🦙 Ollama',
      badge: 'LOCAL',
      description: 'Lokalni modeli na Railway',
      configured: true,
      key_url: null,
      models: [],  // dinamički sa /ollama/api/tags
    },
  ];
  res.json({ providers });
});

// ===== HuggingFace Models List (backwards compat) =====
app.get('/models/huggingface', (req, res) => {
  const models = Object.entries(getHfModelCatalog()).map(([id, info]) => ({
    id, name: info.name, size: info.size, source: 'huggingface', available: !!getHfToken(),
  }));
  res.json({ models, configured: !!getHfToken() });
});

// ===== Analytics Endpoint =====
app.get('/analytics', (req, res) => {
  const uptime = Math.floor((Date.now() - analytics.started) / 1000);
  res.json({
    messages: analytics.messages,
    unique_users: analytics.users.size,
    top_skills: Object.entries(analytics.skills_used).sort((a, b) => b[1] - a[1]).slice(0, 10),
    top_models: Object.entries(analytics.models_used).sort((a, b) => b[1] - a[1]).slice(0, 10),
    uptime_seconds: uptime,
    is_admin: isAdmin(req.user?.email),
  });
});

// ===== Admin Endpoint =====
app.get('/admin', (req, res) => {
  if (!isAdmin(req.user?.email)) return res.status(403).json({ error: 'Admin only' });

  res.json({
    owner: CONFIG.ownerEmail,
    rate_limits: Object.fromEntries(rateLimits),
    analytics: {
      messages: analytics.messages,
      users: Array.from(analytics.users),
      skills: analytics.skills_used,
      models: analytics.models_used,
    },
    skills_loaded: Object.keys(loadedSkills),
    config: {
      provider: CONFIG.defaultProvider,
      groq: !!getProviderToken('groq'),
      gemini: !!getProviderToken('gemini'),
    },
  });
});

// ===== Compare Models =====
app.post('/chat/compare', async (req, res) => {
  const { message, system } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  if (!isAdmin(req.user?.email) && !checkRateLimit(req.user?.id || req.ip, req.user?.email).allowed) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  try {
    let enhancedSystem = system || '';
    if (soulCache) enhancedSystem = `[Bot Personality]\n${soulCache}\n\n${enhancedSystem}`;

    const results = await Promise.allSettled([
      chatGroq(message, 'llama-3.1-8b-instant', enhancedSystem),
      chatGroq(message, 'llama-3.1-70b-versatile', enhancedSystem),
    ]);

    res.json({
      models: [
        { name: 'llama-3.1-8b-instant', response: results[0].status === 'fulfilled' ? results[0].value.response : results[0].reason.message, time: 'fast' },
        { name: 'llama-3.1-70b-versatile', response: results[1].status === 'fulfilled' ? results[1].value.response : results[1].reason.message, time: 'slow' },
      ],
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ===== Chat History (Supabase) =====
app.get('/chats', async (req, res) => {
  if (!supabase || !req.user) return res.json({ chats: [] });

  try {
    const { data } = await supabase
      .from('chat_sessions')
      .select('id, title, model, created_at, updated_at')
      .eq('user_id', req.user.id)
      .order('updated_at', { ascending: false })
      .limit(50);
    res.json({ chats: data || [] });
  } catch { res.json({ chats: [] }); }
});

app.post('/chats', async (req, res) => {
  if (!supabase || !req.user) return res.json({ id: 'local-' + Date.now() });

  try {
    const { data } = await supabase
      .from('chat_sessions')
      .insert({ user_id: req.user.id, title: req.body.title || 'New Chat', model: req.body.model })
      .select()
      .single();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/chats/:id/messages', async (req, res) => {
  if (!supabase || !req.user) return res.json({ messages: [] });

  try {
    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('session_id', req.params.id)
      .order('created_at', { ascending: true })
      .limit(100);
    res.json({ messages: data || [] });
  } catch { res.json({ messages: [] }); }
});

app.post('/chats/:id/messages', async (req, res) => {
  if (!supabase || !req.user) return res.json({ success: true, local: true });

  try {
    await supabase.from('chat_messages').insert({
      session_id: req.params.id,
      role: req.body.role,
      content: req.body.content,
      model: req.body.model,
    });
    await supabase.from('chat_sessions').update({ updated_at: new Date().toISOString() }).eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/chats/:id', async (req, res) => {
  if (!supabase || !req.user) return res.json({ success: true });

  try {
    await supabase.from('chat_sessions').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== Shared Skills =====
app.get('/skills/shared', async (req, res) => {
  if (!supabase) return res.json({ skills: [] });

  try {
    const { data } = await supabase
      .from('shared_skills')
      .select('*')
      .order('downloads', { ascending: false })
      .limit(50);
    res.json({ skills: data || [] });
  } catch { res.json({ skills: [] }); }
});

app.post('/skills/share', async (req, res) => {
  if (!supabase || !req.user) return res.status(401).json({ error: 'Login required' });

  try {
    const { data } = await supabase
      .from('shared_skills')
      .insert({
        user_id: req.user.id,
        author: req.user.email?.split('@')[0],
        name: req.body.name,
        description: req.body.description,
        content: req.body.content,
        triggers: req.body.triggers || [],
      })
      .select()
      .single();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== Models Endpoint =====
app.get('/models', async (req, res) => {
  const models = [];
  const catalogProviders = ['groq', 'cerebras', 'mistral', 'siliconflow', 'gemini', 'huggingface', 'llm7'];
  for (const providerId of catalogProviders) {
    const catalog = getProviderModelCatalog(providerId);
    for (const [id, info] of Object.entries(catalog)) {
      models.push({ name: id, model: id, provider: providerId, size: info.size || 0 });
    }
  }

  try {
    const ollamaRes = await fetch(`${CONFIG.ollama}/api/tags`, { signal: AbortSignal.timeout(5000) });
    const data = await ollamaRes.json();
    if (Array.isArray(data.models)) {
      for (const m of data.models) {
        models.push({ name: m.name, model: m.name, provider: 'ollama', size: m.size || 0 });
      }
    }
  } catch {}

  const dedup = [];
  const seen = new Set();
  for (const m of models) {
    const key = `${m.provider}:${m.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(m);
  }
  res.json({ models: dedup });
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
  checks.gemini = getProviderToken('gemini') ? 'configured' : 'not configured';
  checks.groq = getProviderToken('groq') ? 'configured' : 'not configured';
  checks.provider = CONFIG.defaultProvider;

  res.json({
    name: 'ClawBot Platform',
    version: '1.0.0',
    uptime: process.uptime(),
    checks,
    timestamp: new Date().toISOString(),
  });
});

// ===== Dynamic Skills Loader =====
const SKILLS_DIR = path.join(__dirname, 'skills');
const loadedSkills = {};
const skillsStatePath = path.join(DATA_DIR, 'skills-state.json');
const disabledSkills = new Set();

function loadSkillsState() {
  try {
    if (!fs.existsSync(skillsStatePath)) return;
    const state = JSON.parse(fs.readFileSync(skillsStatePath, 'utf8'));
    const disabled = Array.isArray(state.disabled) ? state.disabled : [];
    disabledSkills.clear();
    disabled.forEach(id => disabledSkills.add(String(id)));
  } catch (err) {
    console.error('Failed to load skills state:', err.message);
  }
}

function saveSkillsState() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(skillsStatePath, JSON.stringify({ disabled: [...disabledSkills] }, null, 2));
  } catch (err) {
    console.error('Failed to save skills state:', err.message);
  }
}

function isSkillActive(skillId) {
  return !disabledSkills.has(skillId);
}

function getSkillsSnapshot() {
  return Object.entries(loadedSkills).map(([id, s]) => ({
    skill_id: id,
    skill_name: s.name || id,
    enabled: isSkillActive(id),
    config: {
      description: s.description || '',
      triggers: s.triggers || [],
      version: s.version || '1.0.0',
    },
  }));
}

async function syncSkillsToSupabase(userId) {
  if (!supabase || !userId) return;
  const client = supabaseAdmin || supabase;
  const snapshot = getSkillsSnapshot();
  try {
    await client.from('user_skills').delete().eq('user_id', userId);
    if (snapshot.length) {
      await client.from('user_skills').upsert(
        snapshot.map(s => ({ user_id: userId, ...s })),
        { onConflict: 'user_id,skill_id' }
      );
    }
    const merged = mergeAndSaveLocalSettings({ enabled_skills: snapshot.filter(s => s.enabled).map(s => s.skill_id) });
    await client.from('user_settings').upsert({
      user_id: userId,
      settings: merged,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  } catch (err) {
    console.error('Skills sync error:', err.message);
  }
}

function loadSingleSkill(dirName) {
  const skillPath = path.join(SKILLS_DIR, dirName, 'index.js');
  const metaPath = path.join(SKILLS_DIR, dirName, 'skill.json');
  if (!fs.existsSync(skillPath)) return false;

  try {
    // Clear require cache for hot-reload
    delete require.cache[require.resolve(skillPath)];
    const skill = require(skillPath);
    const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath)) : {};
    loadedSkills[dirName] = { ...meta, handler: skill };
    console.log(`  ✅ Skill loaded: ${meta.name || dirName}`);
    return true;
  } catch (err) {
    console.error(`  ❌ Skill failed: ${dirName} - ${err.message}`);
    return false;
  }
}

function loadSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return;
  const dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const dir of dirs) {
    loadSingleSkill(dir.name);
  }
}

loadSkills();
loadSkillsState();

// Hot-reload endpoint — install + activate without restart
app.post('/skills/reload/:id', (req, res) => {
  const success = loadSingleSkill(req.params.id);
  if (success) {
    res.json({ success: true, loaded: req.params.id, skill: loadedSkills[req.params.id] ? {
      name: loadedSkills[req.params.id].name,
      description: loadedSkills[req.params.id].description,
    } : null });
  } else {
    res.status(404).json({ error: `Failed to load skill '${req.params.id}'` });
  }
});

// Reload all skills
app.post('/skills/reload', (req, res) => {
  const before = Object.keys(loadedSkills).length;
  // Clear all from loadedSkills
  Object.keys(loadedSkills).forEach(k => delete loadedSkills[k]);
  // Clear require cache for all skills
  Object.keys(require.cache).forEach(key => {
    if (key.includes(SKILLS_DIR)) delete require.cache[key];
  });
  loadSkills();
  const after = Object.keys(loadedSkills).length;
  res.json({ success: true, before, after, skills: Object.keys(loadedSkills) });
});

// List all skills
app.get('/skills', (req, res) => {
  const skills = Object.entries(loadedSkills).map(([id, s]) => ({
    id,
    name: s.name || id,
    description: s.description || '',
    icon: s.icon || '🔧',
    triggers: s.triggers || [],
    active: isSkillActive(id),
    core: id === 'skills' || id === 'upload',
  }));
  res.json({ skills });
});

app.post('/skills/:id/enable', (req, res) => {
  const id = req.params.id;
  if (!loadedSkills[id]) return res.status(404).json({ error: `Skill '${id}' not found` });
  disabledSkills.delete(id);
  saveSkillsState();
  syncSkillsToSupabase(req.user?.id);
  res.json({ success: true, id, active: true });
});

app.post('/skills/:id/disable', (req, res) => {
  const id = req.params.id;
  if (!loadedSkills[id]) return res.status(404).json({ error: `Skill '${id}' not found` });
  if (id === 'skills' || id === 'upload') return res.status(403).json({ error: `'${id}' is a core skill and cannot be disabled` });
  disabledSkills.add(id);
  saveSkillsState();
  syncSkillsToSupabase(req.user?.id);
  res.json({ success: true, id, active: false });
});

// ===== Skill Marketplace (ClawHub) =====
const CLAWHUB_API_BASE = process.env.CLAWHUB_API_BASE || 'https://registry.clawhub.com/api';

function normalizeMarketplaceSkill(raw = {}) {
  const slug = raw.slug || raw.id || raw.name || raw.skill_id || '';
  const name = raw.name || raw.title || raw.slug || raw.id || '';
  return {
    id: raw.id || slug,
    slug,
    name,
    description: raw.description || raw.summary || '',
    icon: raw.icon || '🔧',
    content: raw.content || raw.skill_md || null,
    download_url: raw.download_url || raw.url || raw.raw_url || null,
    installed: !!loadedSkills[slug],
  };
}

async function fetchMarketplaceList(query = '', limit = 20) {
  const endpoints = [
    query
      ? `${CLAWHUB_API_BASE}/skills/search?q=${encodeURIComponent(query)}&limit=${limit}`
      : `${CLAWHUB_API_BASE}/skills?limit=${limit}`,
    query
      ? `https://clawhub.com/api/skills?q=${encodeURIComponent(query)}&limit=${limit}`
      : `https://clawhub.com/api/skills?limit=${limit}`,
  ];

  for (const url of endpoints) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) continue;
      const data = await response.json();
      const list = Array.isArray(data.skills) ? data.skills : Array.isArray(data.results) ? data.results : [];
      if (!list.length) continue;
      return list.map(normalizeMarketplaceSkill);
    } catch {}
  }
  return [];
}

async function fetchMarketplaceSkillBySlug(slug) {
  const safe = encodeURIComponent(slug);
  const endpoints = [
    `${CLAWHUB_API_BASE}/skills/${safe}`,
    `https://clawhub.com/api/skills/${safe}`,
  ];

  for (const url of endpoints) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) continue;
      const data = await response.json();
      const raw = data.skill || data;
      const normalized = normalizeMarketplaceSkill(raw);
      if (normalized.slug || normalized.name || normalized.content || normalized.download_url) return normalized;
    } catch {}
  }
  return null;
}

const AWESOME_CATEGORIES = [
  'ai-and-llms.md', 'apple-apps-and-services.md', 'browser-and-automation.md', 'calendar-and-scheduling.md',
  'clawdbot-tools.md', 'cli-utilities.md', 'coding-agents-and-ides.md', 'communication.md',
  'data-and-analytics.md', 'devops-and-cloud.md', 'gaming.md', 'git-and-github.md',
  'health-and-fitness.md', 'image-and-video-generation.md', 'ios-and-macos-development.md',
  'marketing-and-sales.md', 'media-and-streaming.md', 'moltbook.md', 'notes-and-pkm.md',
  'pdf-and-documents.md', 'personal-development.md', 'productivity-and-tasks.md', 'search-and-research.md',
  'security-and-passwords.md', 'self-hosted-and-automation.md', 'shopping-and-e-commerce.md',
  'smart-home-and-iot.md', 'speech-and-transcription.md', 'transportation.md', 'web-and-frontend-development.md',
];

function parseAwesomeCategorySkills(markdown = '') {
  const out = [];
  const seen = new Set();
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    const name = String(m[1] || '').trim();
    const url = String(m[2] || '').trim();
    if (!name || name.toLowerCase().includes('back to main list')) continue;
    if (url.includes('../README') || url.includes('#table-of-contents')) continue;
    const key = `${name}::${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, url });
  }
  return out;
}

async function installSkillByAnyMethod(skillRef) {
  const slug = skillRef.name;
  const skillsManager = loadedSkills['skills'];
  if (skillsManager?.handler?.install) {
    try {
      const result = await skillsManager.handler.install(slug, 'clawhub');
      if (result?.success) return { success: true, method: 'skills-manager', slug, result };
    } catch {}
  }

  try {
    const market = await fetchMarketplaceSkillBySlug(slug);
    if (market) {
      let content = market.content;
      if (!content && market.download_url) {
        const dl = await fetch(market.download_url, { signal: AbortSignal.timeout(10000) });
        if (dl.ok) content = await dl.text();
      }
      if (content && loadedSkills.upload?.handler?.installSkillMd) {
        const result = await loadedSkills.upload.handler.installSkillMd(content, 'skill.md');
        if (result?.success) return { success: true, method: 'market-fallback', slug, result };
      }
    }
  } catch {}

  return { success: false, slug, error: `Failed to install '${slug}'` };
}

app.get('/marketplace', async (req, res) => {
  const query = req.query.q || '';
  const limit = parseInt(req.query.limit) || 20;
  
  try {
    const skills = await fetchMarketplaceList(query, limit);
    if (skills.length) {
      return res.json({ skills, source: 'clawhub' });
    }
    throw new Error('Marketplace unavailable or empty response');
  } catch (err) {
    // Transparent fallback: return local skills but mark response as degraded
    const skills = Object.entries(loadedSkills).map(([id, s]) => ({
      id, name: s.name || id, description: s.description || '',
      slug: id,
      icon: s.icon || '🔧', triggers: s.triggers || [], installed: true,
    }));
    res.status(502).json({
      error: 'Marketplace temporarily unavailable',
      details: err.message,
      source: 'local-fallback',
      skills,
    });
  }
});

// Install from marketplace
app.post('/marketplace/install/:slug', async (req, res) => {
  try {
    const skillsManager = loadedSkills['skills'];
    if (skillsManager?.handler?.install) {
      const managerResult = await skillsManager.handler.install(req.params.slug, 'clawhub');
      if (managerResult?.success) return res.json(managerResult);
    }

    const skill = await fetchMarketplaceSkillBySlug(req.params.slug);
    if (!skill) return res.status(404).json({ error: `Skill '${req.params.slug}' not found on marketplace` });
    let content = skill.content;
    if (!content && skill.download_url) {
      const dl = await fetch(skill.download_url, { signal: AbortSignal.timeout(10000) });
      if (dl.ok) content = await dl.text();
    }
    if (!content) return res.status(404).json({ error: 'Skill content not found for selected marketplace skill' });
    
    const uploadSkill = loadedSkills['upload'];
    if (!uploadSkill) return res.status(500).json({ error: 'Upload skill not loaded' });
    
    const result = await uploadSkill.handler.installSkillMd(content, 'skill.md');
    await syncSkillsToSupabase(req.user?.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/skills/bootstrap-awesome', async (req, res) => {
  const perCategory = Math.max(1, Math.min(5, parseInt(req.body?.perCategory ?? 5, 10) || 5));
  const maxCategories = Math.max(1, Math.min(AWESOME_CATEGORIES.length, parseInt(req.body?.maxCategories ?? AWESOME_CATEGORIES.length, 10) || AWESOME_CATEGORIES.length));
  const selectedCategories = AWESOME_CATEGORIES.slice(0, maxCategories);
  const report = { perCategory, categories: [], installed: [], failed: [] };

  for (const categoryFile of selectedCategories) {
    const rawUrl = `https://raw.githubusercontent.com/VoltAgent/awesome-openclaw-skills/main/categories/${categoryFile}`;
    let markdown = '';
    try {
      const r = await fetch(rawUrl, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      markdown = await r.text();
    } catch (err) {
      report.categories.push({ category: categoryFile, picked: 0, error: err.message });
      continue;
    }

    const parsed = parseAwesomeCategorySkills(markdown).slice(0, perCategory);
    report.categories.push({ category: categoryFile, picked: parsed.length });
    for (const skillRef of parsed) {
      const result = await installSkillByAnyMethod(skillRef);
      if (result.success) report.installed.push({ category: categoryFile, slug: skillRef.name, method: result.method });
      else report.failed.push({ category: categoryFile, slug: skillRef.name, error: result.error });
    }
  }

  const success = report.installed.length > 0 && report.failed.length === 0 && report.categories.every(c => !c.error);
  const partial = report.installed.length > 0 && !success;
  const statusCode = success ? 200 : (partial ? 207 : 502);

  res.status(statusCode).json({
    success,
    partial,
    message: `Bootstrap complete. Installed: ${report.installed.length}, failed: ${report.failed.length}`,
    ...report,
  });
});

// ===== Auto-Update Skills =====
app.post('/skills/update-all', async (req, res) => {
  const results = [];
  
  for (const [id, skill] of Object.entries(loadedSkills)) {
    if (id === 'upload' || id === 'skills') continue; // Skip core skills
    
    try {
      // Check ClawHub for newer version
      const response = await fetch(`${CLAWHUB_API_BASE}/skills/${id}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const remotePayload = await response.json();
        const remote = remotePayload.skill || remotePayload;
        const localVersion = skill.version || '1.0.0';
        const remoteVersion = remote.version || '1.0.0';
        
        if (remoteVersion !== localVersion && (remote.content || remote.skill_md)) {
          const uploadSkill = loadedSkills['upload'];
          await uploadSkill.handler.installSkillMd(remote.content || remote.skill_md, 'skill.md');
          results.push({ id, updated: true, from: localVersion, to: remoteVersion });
        } else {
          results.push({ id, updated: false, version: localVersion });
        }
      }
    } catch {
      results.push({ id, updated: false, error: 'check failed' });
    }
  }
  
  await syncSkillsToSupabase(req.user?.id);
  res.json({ success: true, results });
});

// ===== Custom Commands =====
const customCommandsPath = path.join(DATA_DIR, 'commands.json');

app.get('/commands', (req, res) => {
  if (!fs.existsSync(customCommandsPath)) return res.json({ commands: {} });
  res.json({ commands: JSON.parse(fs.readFileSync(customCommandsPath)) });
});

app.post('/commands', (req, res) => {
  const { name, action } = req.body;
  if (!name || !action) return res.status(400).json({ error: 'Name and action required' });
  
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  let commands = {};
  if (fs.existsSync(customCommandsPath)) {
    commands = JSON.parse(fs.readFileSync(customCommandsPath));
  }
  commands[name.toLowerCase()] = action;
  fs.writeFileSync(customCommandsPath, JSON.stringify(commands, null, 2));
  res.json({ success: true, command: name, action });
});

app.delete('/commands/:name', (req, res) => {
  if (!fs.existsSync(customCommandsPath)) return res.json({ success: true });
  const commands = JSON.parse(fs.readFileSync(customCommandsPath));
  delete commands[req.params.name.toLowerCase()];
  fs.writeFileSync(customCommandsPath, JSON.stringify(commands, null, 2));
  res.json({ success: true });
});

// ===== Share Chat =====
const sharedChatsPath = path.join(DATA_DIR, 'shared-chats.json');

app.post('/chats/share', (req, res) => {
  const { messages, title } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Messages required' });
  
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  let shared = {};
  if (fs.existsSync(sharedChatsPath)) {
    shared = JSON.parse(fs.readFileSync(sharedChatsPath));
  }
  shared[id] = { title: title || 'Shared Chat', messages, created: new Date().toISOString() };
  
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(sharedChatsPath, JSON.stringify(shared, null, 2));
  
  res.json({ success: true, id, url: `/shared/${id}` });
});

app.get('/shared/:id', (req, res) => {
  if (!fs.existsSync(sharedChatsPath)) return res.status(404).json({ error: 'Not found' });
  const shared = JSON.parse(fs.readFileSync(sharedChatsPath));
  const chat = shared[req.params.id];
  if (!chat) return res.status(404).json({ error: 'Not found' });
  res.json(chat);
});

// Run a skill
app.post('/skills/:id', async (req, res) => {
  const skill = loadedSkills[req.params.id];
  if (!skill) return res.status(404).json({ error: `Skill '${req.params.id}' not found` });
  if (!isSkillActive(req.params.id)) return res.status(403).json({ error: `Skill '${req.params.id}' is disabled` });

  try {
    const result = await skill.handler.run(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a skill
app.delete('/skills/:id', (req, res) => {
  const id = req.params.id;
  const protectedSkills = ['skills', 'upload'];
  if (protectedSkills.includes(id)) {
    return res.status(403).json({ error: `'${id}' is a core skill. Cannot remove.` });
  }

  const targetDir = path.join(SKILLS_DIR, id);
  if (!fs.existsSync(targetDir)) {
    return res.status(404).json({ error: `Skill '${id}' not found` });
  }

  fs.rmSync(targetDir, { recursive: true });
  delete loadedSkills[id];
  disabledSkills.delete(id);
  saveSkillsState();

  // Remove from registry
  const registryPath = path.join(__dirname, 'brain', 'skills-registry.json');
  if (fs.existsSync(registryPath)) {
    try {
      const registry = JSON.parse(fs.readFileSync(registryPath));
      if (registry.skills) {
        delete registry.skills[id];
        fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
      }
    } catch {}
  }

  syncSkillsToSupabase(req.user?.id);
  res.json({ success: true, removed: id });
});

// ===== File Upload Endpoints =====

// ZIP Upload (Full Package)
const zipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function isSafeRelativePath(inputPath) {
  const normalized = String(inputPath || '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) return false;
  const clean = path.posix.normalize(normalized);
  return clean && clean !== '.' && !clean.startsWith('../');
}

function isValidSkillId(skillId) {
  const id = String(skillId || '').trim();
  if (!id || id === '.' || id === '..') return false;
  return /^[a-zA-Z0-9._-]+$/.test(id);
}

app.post('/upload/zip', zipUpload.single('zipfile'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No ZIP file uploaded' });

  try {
    const zip = new AdmZip(req.file.buffer);
    const entries = zip.getEntries();
    const results = { skills: [], soul: null, memory: null, errors: [] };

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const entryName = String(entry.entryName || '').replace(/\\/g, '/');
      if (!isSafeRelativePath(entryName)) {
        results.errors.push(`Skipped unsafe entry path: ${entry.entryName}`);
        continue;
      }
      const contentBuffer = entry.getData();
      const content = contentBuffer.toString('utf8');
      const parts = entryName.split('/').filter(Boolean);
      const filename = parts[parts.length - 1];

      if (filename.toLowerCase() === 'soul.md' && !entryName.includes('skills/')) {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(path.join(DATA_DIR, 'soul.md'), content);
        soulCache = content;
        results.soul = '✅ SOUL.md installed';
        continue;
      }

      if (filename.toLowerCase() === 'memory.md' && !entryName.includes('skills/')) {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(path.join(DATA_DIR, 'memory.md'), content);
        memoryCache = content;
        results.memory = '✅ MEMORY.md installed';
        continue;
      }

      if (entryName.startsWith('skills/') && parts.length >= 3) {
        const skillId = parts[1];
        if (!isValidSkillId(skillId)) {
          results.errors.push(`Skipped invalid skill id: ${skillId}`);
          continue;
        }
        const targetDir = path.resolve(SKILLS_DIR, skillId);
        const skillsRoot = path.resolve(SKILLS_DIR) + path.sep;
        if (!targetDir.startsWith(skillsRoot)) {
          results.errors.push(`Skipped unsafe target path for skill: ${skillId}`);
          continue;
        }
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        const fileRelativePath = parts.slice(2).join('/');
        if (!isSafeRelativePath(fileRelativePath)) {
          results.errors.push(`Skipped unsafe skill file path: ${entry.entryName}`);
          continue;
        }
        const targetFile = path.join(targetDir, fileRelativePath);
        fs.mkdirSync(path.dirname(targetFile), { recursive: true });
        fs.writeFileSync(targetFile, contentBuffer);
        if (!results.skills.includes(skillId)) results.skills.push(skillId);
      }
    }

    for (const skillId of results.skills) {
      try {
        // Clear require cache first
        const skillPath = path.join(SKILLS_DIR, skillId, 'index.js');
        if (require.cache[require.resolve(skillPath)]) {
          delete require.cache[require.resolve(skillPath)];
        }
        loadSingleSkill(skillId);
      } catch (err) {
        results.errors.push(`Failed to load '${skillId}': ${err.message}`);
      }
    }

    // Force reload all skills to pick up new ones
    try {
      Object.keys(loadedSkills).forEach(k => delete loadedSkills[k]);
      Object.keys(require.cache).forEach(key => {
        if (key.includes(SKILLS_DIR)) delete require.cache[key];
      });
      loadSkills();
    } catch (err) {
      results.errors.push(`Reload error: ${err.message}`);
    }

    await syncSkillsToSupabase(req.user?.id);
    res.json({
      success: true,
      message: `📦 Package installed! Skills: ${results.skills.length}, SOUL: ${results.soul ? '✅' : '❌'}, Memory: ${results.memory ? '✅' : '❌'}`,
      loaded: Object.keys(loadedSkills),
      ...results,
    });
  } catch (err) {
    res.status(500).json({ error: `ZIP processing failed: ${err.message}` });
  }
});

// Upload skill.md via raw text body
app.post('/upload/skill', (req, res) => {
  const { content, filename } = req.body;
  if (!content) return res.status(400).json({ error: 'No content provided' });

  const uploadSkill = loadedSkills['upload'];
  if (!uploadSkill) return res.status(500).json({ error: 'Upload skill not loaded' });

  uploadSkill.handler.installSkillMd(content, filename || 'skill.md')
    .then(async (result) => {
      await syncSkillsToSupabase(req.user?.id);
      res.json(result);
    })
    .catch(err => res.status(500).json({ error: err.message }));
});

// Upload SOUL.md
app.post('/upload/soul', (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'No content provided' });

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'soul.md'), content);
  soulCache = content; // Update in-memory cache

  res.json({ success: true, message: '✅ SOUL.md installed — bot personality updated!' });
});

// Upload MEMORY.md
app.post('/upload/memory', (req, res) => {
  const { content, append = true } = req.body;
  if (!content) return res.status(400).json({ error: 'No content provided' });

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const memoryPath = path.join(DATA_DIR, 'memory.md');

  if (append && fs.existsSync(memoryPath)) {
    fs.appendFileSync(memoryPath, '\n\n---\n\n' + content);
  } else {
    fs.writeFileSync(memoryPath, content);
  }

  memoryCache = fs.readFileSync(memoryPath, 'utf8'); // Update cache

  res.json({ success: true, message: '✅ Memory updated!' });
});

app.post('/upload/agent', (req, res) => {
  const { content } = req.body || {};
  if (!content || typeof content !== 'string') return res.status(400).json({ error: 'No AGENT content provided' });
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'agent.md'), content.trim());
  agentCache = content.trim();
  res.json({ success: true, message: '✅ AGENT profile installed' });
});

app.post('/upload/tools', (req, res) => {
  const { content } = req.body || {};
  if (!content || typeof content !== 'string') return res.status(400).json({ error: 'No TOOLS content provided' });
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'tools.md'), content.trim());
  toolsCache = content.trim();
  res.json({ success: true, message: '✅ TOOLS profile installed' });
});

// Get current config
app.get('/config', (req, res) => {
  const soul = soulCache ? soulCache.substring(0, 300) : null;
  const memory = memoryCache ? memoryCache.substring(0, 300) : null;
  const agent = agentCache ? agentCache.substring(0, 300) : null;
  const tools = toolsCache ? toolsCache.substring(0, 300) : null;
  const skillCount = Object.keys(loadedSkills).length;

  res.json({
    soul: soul ? { loaded: true, preview: soul + '...' } : { loaded: false },
    memory: memory ? { loaded: true, preview: memory + '...' } : { loaded: false },
    agent: agent ? { loaded: true, preview: agent + '...' } : { loaded: false },
    tools: tools ? { loaded: true, preview: tools + '...' } : { loaded: false },
    skills: { loaded: skillCount, names: Object.keys(loadedSkills) },
    provider: CONFIG.defaultProvider,
    groq: !!getProviderToken('groq'),
    gemini: !!getProviderToken('gemini'),
    huggingface: !!getHfToken(),
    hf_models: Object.keys(getHfModelCatalog()).length,
  });
});

// Install from URL
app.post('/upload/url', async (req, res) => {
  const { url, type } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const content = await response.text();

    let detectedType = type;
    if (!detectedType) {
      if (url.includes('SOUL') || url.includes('soul')) detectedType = 'soul';
      else if (url.includes('MEMORY') || url.includes('memory')) detectedType = 'memory';
      else if (url.includes('AGENT') || url.includes('agent')) detectedType = 'agent';
      else if (url.includes('TOOLS') || url.includes('tools')) detectedType = 'tools';
      else detectedType = 'skill';
    }

    if (detectedType === 'soul') {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(path.join(DATA_DIR, 'soul.md'), content);
      soulCache = content;
      res.json({ success: true, type: 'soul', message: '✅ SOUL installed from URL!' });
    } else if (detectedType === 'memory') {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const memoryPath = path.join(DATA_DIR, 'memory.md');
      if (fs.existsSync(memoryPath)) {
        fs.appendFileSync(memoryPath, '\n\n---\n\n' + content);
      } else {
        fs.writeFileSync(memoryPath, content);
      }
      memoryCache = fs.readFileSync(memoryPath, 'utf8');
      res.json({ success: true, type: 'memory', message: '✅ Memory updated from URL!' });
    } else if (detectedType === 'agent') {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(path.join(DATA_DIR, 'agent.md'), content.trim());
      agentCache = content.trim();
      res.json({ success: true, type: 'agent', message: '✅ Agent profile updated from URL!' });
    } else if (detectedType === 'tools') {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(path.join(DATA_DIR, 'tools.md'), content.trim());
      toolsCache = content.trim();
      res.json({ success: true, type: 'tools', message: '✅ Tools profile updated from URL!' });
    } else {
      const uploadSkill = loadedSkills['upload'];
      if (!uploadSkill) return res.status(500).json({ error: 'Upload skill not loaded' });
      const result = await uploadSkill.handler.installSkillMd(content, 'skill.md');
      await syncSkillsToSupabase(req.user?.id);
      res.json(result);
    }
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch URL: ${err.message}` });
  }
});

// ===== SOUL & MEMORY Loading =====
let soulCache = null;
let memoryCache = null;
let agentCache = null;
let toolsCache = null;

// Load on startup
const soulPath = path.join(DATA_DIR, 'soul.md');
const memoryPath = path.join(DATA_DIR, 'memory.md');
const agentPath = path.join(DATA_DIR, 'agent.md');
const toolsPath = path.join(DATA_DIR, 'tools.md');
if (fs.existsSync(soulPath)) {
  soulCache = fs.readFileSync(soulPath, 'utf8');
  console.log('  💫 SOUL loaded:', soulCache.substring(0, 50) + '...');
}
if (fs.existsSync(memoryPath)) {
  memoryCache = fs.readFileSync(memoryPath, 'utf8');
  console.log('  🧠 Memory loaded:', memoryCache.length, 'chars');
}
if (fs.existsSync(agentPath)) {
  agentCache = fs.readFileSync(agentPath, 'utf8');
  console.log('  🤖 Agent profile loaded');
}
if (fs.existsSync(toolsPath)) {
  toolsCache = fs.readFileSync(toolsPath, 'utf8');
  console.log('  🧰 Tools profile loaded');
}

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
║  Groq:     ${(getProviderToken('groq') ? '✅ configured' : '❌ not set').padEnd(37)}║
║  Gemini:   ${(getProviderToken('gemini') ? '✅ configured' : '❌ not set').padEnd(37)}║
║  HuggFace: ${(getHfToken() ? '✅ ' + Object.keys(getHfModelCatalog()).length + ' models available' : '❌ not set').padEnd(37)}║
║  Health:   http://localhost:${PORT}/status          ║
╚══════════════════════════════════════════════════╝
  `);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});
    if (!matchedSkill && strictSkillMode && skillInstructions) {
      enhancedSystem = `${enhancedSystem}\n\n[Skill manager default instructions]\n${skillInstructions}`;
    }
