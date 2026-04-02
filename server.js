// ===== ClawBot Platform - Main Server =====
// Express + Supabase Auth + Ollama Proxy + Geensee UI

require('dotenv').config();
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const http = require('http');
const fs = require('fs');
const path = require('path');
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
  geminiKey: process.env.GEMINI_API_KEY || '',
  groqKey: process.env.GROQ_API_KEY || '',
  defaultProvider: process.env.AI_PROVIDER || (process.env.GROQ_API_KEY ? 'groq' : process.env.GEMINI_API_KEY ? 'gemini' : 'ollama'),
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

function getLocalUsers() {
  if (!fs.existsSync(localUsersPath)) return {};
  return JSON.parse(fs.readFileSync(localUsersPath));
}

function saveLocalUser(email, password) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const users = getLocalUsers();
  const id = 'local-' + Date.now();
  users[email] = { id, email, password, created: new Date().toISOString() };
  fs.writeFileSync(localUsersPath, JSON.stringify(users, null, 2));
  return { id, email };
}

function verifyLocalUser(email, password) {
  const users = getLocalUsers();
  const user = users[email];
  if (user && user.password === password) {
    return { id: user.id, email: user.email };
  }
  return null;
}

// ===== Auth Routes =====
app.post('/auth/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  // Try Supabase first
  if (supabase) {
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (!error && data.session) {
        return res.json({ user: data.user, session: data.session });
      }
      // If signup succeeded but no session (email confirmation), try auto-login
      if (!error && !data.session) {
        const loginResult = await supabase.auth.signInWithPassword({ email, password });
        if (loginResult.data?.session) {
          return res.json({ user: loginResult.data.user, session: loginResult.data.session });
        }
      }
    } catch {}
  }

  // Fallback: local auth (no email confirmation needed)
  const localUser = saveLocalUser(email, password);
  const token = Buffer.from(JSON.stringify({ id: localUser.id, email })).toString('base64');
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

  // Try Supabase first
  if (supabase) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (!error && data.session) {
        return res.json({ user: data.user, session: data.session });
      }
    } catch {}
  }

  // Fallback: local auth
  const user = verifyLocalUser(email, password);
  if (user) {
    const token = Buffer.from(JSON.stringify({ id: user.id, email })).toString('base64');
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
  const settings = req.body;
  if (!settings) return res.status(400).json({ error: 'No settings provided' });

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

// Sync SOUL to Supabase
app.post('/settings/soul', async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'No content' });

  // Save locally
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'soul.md'), content);
  soulCache = content;

  // Sync to Supabase
  if (supabase && req.user) {
    try {
      await supabase.from('user_settings').upsert({
        user_id: req.user.id,
        settings: { soul: content },
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

  // Sync to Supabase
  if (supabase && req.user) {
    try {
      await supabase.from('user_settings').upsert({
        user_id: req.user.id,
        settings: { memory: memoryCache },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    } catch {}
  }

  res.json({ success: true, message: '✅ Memory saved & synced!' });
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
      'Authorization': `Bearer ${CONFIG.groqKey}`,
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
      if (lower.includes('install') || lower.includes('instaliraj') || lower.includes('dodaj') || lower.includes('želim') || lower.includes('hocu') || lower.includes('hoću') || lower.includes('want')) {
        return {
          id: 'upload',
          params: { task: message, action: 'install', slug: query || message }
        };
      }
      return {
        id: 'upload',
        params: { task: message, action: 'search', query: query || message }
      };
    }
  }

  // === General trigger matching ===
  for (const [id, skill] of Object.entries(loadedSkills)) {
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

// ===== Bot Chat Endpoint (auto-select provider + skill routing) =====
app.post('/chat', async (req, res) => {
  const { message, model, system } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  const provider = req.body.provider || CONFIG.defaultProvider;

  try {
    // Build enhanced system prompt with SOUL + MEMORY
    let enhancedSystem = system || '';
    if (soulCache) {
      enhancedSystem = `[Bot Personality - SOUL]\n${soulCache}\n\n${enhancedSystem}`;
    }
    if (memoryCache) {
      enhancedSystem = `${enhancedSystem}\n\n[Memory - Context]\n${memoryCache.substring(0, 2000)}`;
    }

    // Auto-detect skill triggers
    const matchedSkill = detectSkill(message);
    let skillResult = null;

    if (matchedSkill) {
      const skill = loadedSkills[matchedSkill.id];
      if (skill && skill.handler && skill.handler.run) {
        try {
          skillResult = await skill.handler.run(matchedSkill.params);
          if (skillResult.instructions) {
            // Skill wants LLM to process — add context to system prompt
            enhancedSystem = `${enhancedSystem}\n\n[Skill: ${matchedSkill.id}]\n${skillResult.systemPrompt || ''}\n\nTask: ${skillResult.instructions}\n${skillResult.context ? 'Context: ' + skillResult.context : ''}`;
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

    // Skill can override model (e.g. knowledge uses 70B)
    const chatModel = skillResult?.model || model;

    if (provider === 'groq' && CONFIG.groqKey) {
      result = await chatGroq(chatMessage, chatModel, enhancedSystem);
    } else if (provider === 'gemini' && CONFIG.geminiKey) {
      result = await chatGemini(chatMessage, chatModel, enhancedSystem);
    } else {
      // Try Ollama first, fall back to Groq then Gemini
      try {
        result = await chatOllama(chatMessage, chatModel, enhancedSystem);
      } catch (ollamaErr) {
        console.log('Ollama failed:', ollamaErr.message);
        if (CONFIG.groqKey) {
          result = await chatGroq(chatMessage, chatModel, enhancedSystem);
        } else if (CONFIG.geminiKey) {
          result = await chatGemini(chatMessage, chatModel, enhancedSystem);
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
    // Build enhanced system prompt with SOUL + MEMORY
    let enhancedSystem = system || '';
    if (soulCache) enhancedSystem = `[Bot Personality]\n${soulCache}\n\n${enhancedSystem}`;
    if (memoryCache) enhancedSystem = `${enhancedSystem}\n\n[Memory]\n${memoryCache.substring(0, 2000)}`;

    // Skill detection
    const matchedSkill = detectSkill(message);
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
            chatMessage = skillResult.instructions;
          } else if (skillResult.response || skillResult.output) {
            res.write(`data: ${JSON.stringify({ content: skillResult.response || skillResult.output, done: true, skill: matchedSkill.id })}\n\n`);
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
    if (provider === 'groq' && CONFIG.groqKey) {
      const groqModel = chatModel && chatModel.startsWith('llama') ? chatModel : 'llama-3.1-8b-instant';
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
          'Authorization': `Bearer ${CONFIG.groqKey}`,
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
              res.write(`data: ${JSON.stringify({ done: true, model: groqModel })}\n\n`);
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
    } else {
      // Non-streaming fallback
      let result;
      try {
        if (provider === 'gemini' && CONFIG.geminiKey) {
          result = await chatGemini(chatMessage, chatModel, enhancedSystem);
        } else {
          result = await chatOllama(chatMessage, chatModel, enhancedSystem);
        }
      } catch {
        if (CONFIG.groqKey) result = await chatGroq(chatMessage, chatModel, enhancedSystem);
      }
      res.write(`data: ${JSON.stringify({ content: result.response, done: true, model: result.model })}\n\n`);
    }

    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message, done: true })}\n\n`);
    res.end();
  }
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
      groq: !!CONFIG.groqKey,
      gemini: !!CONFIG.geminiKey,
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

  // Ollama models
  try {
    const ollamaRes = await fetch(`${CONFIG.ollama}/api/tags`, { signal: AbortSignal.timeout(5000) });
    const data = await ollamaRes.json();
    if (data.models) models.push(...data.models);
  } catch { /* Ollama offline */ }

  // Groq models (if configured)
  if (CONFIG.groqKey) {
    models.push(
      { name: 'llama-3.1-8b-instant', model: 'llama-3.1-8b-instant', provider: 'groq', size: 0 },
      { name: 'llama-3.1-70b-versatile', model: 'llama-3.1-70b-versatile', provider: 'groq', size: 0 },
      { name: 'mixtral-8x7b-32768', model: 'mixtral-8x7b-32768', provider: 'groq', size: 0 },
    );
  }

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
  checks.groq = CONFIG.groqKey ? 'configured' : 'not configured';
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
  }));
  res.json({ skills });
});

// ===== Skill Marketplace (ClawHub) =====
app.get('/marketplace', async (req, res) => {
  const query = req.query.q || '';
  const limit = parseInt(req.query.limit) || 20;
  
  try {
    const url = query 
      ? `https://clawhub.com/api/skills?q=${encodeURIComponent(query)}&limit=${limit}`
      : `https://clawhub.com/api/skills?limit=${limit}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    res.json({ skills: data.skills || [], source: 'clawhub' });
  } catch {
    // Fallback: return installed skills
    const skills = Object.entries(loadedSkills).map(([id, s]) => ({
      id, name: s.name || id, description: s.description || '',
      icon: s.icon || '🔧', triggers: s.triggers || [], installed: true,
    }));
    res.json({ skills, source: 'local' });
  }
});

// Install from marketplace
app.post('/marketplace/install/:slug', async (req, res) => {
  try {
    const response = await fetch(`https://clawhub.com/api/skills/${encodeURIComponent(req.params.slug)}`, {
      signal: AbortSignal.timeout(10000),
    });
    const skill = await response.json();
    const content = skill.content || skill.skill_md;
    if (!content) return res.status(404).json({ error: 'Skill content not found' });
    
    const uploadSkill = loadedSkills['upload'];
    if (!uploadSkill) return res.status(500).json({ error: 'Upload skill not loaded' });
    
    const result = await uploadSkill.handler.installSkillMd(content, 'skill.md');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Auto-Update Skills =====
app.post('/skills/update-all', async (req, res) => {
  const results = [];
  
  for (const [id, skill] of Object.entries(loadedSkills)) {
    if (id === 'upload' || id === 'skills') continue; // Skip core skills
    
    try {
      // Check ClawHub for newer version
      const response = await fetch(`https://clawhub.com/api/skills/${id}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const remote = await response.json();
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

  // Remove from registry
  const registryPath = path.join(SKILLS_DIR, 'brain', 'skills-registry.json');
  if (fs.existsSync(registryPath)) {
    try {
      const registry = JSON.parse(fs.readFileSync(registryPath));
      if (registry.skills) {
        delete registry.skills[id];
        fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
      }
    } catch {}
  }

  res.json({ success: true, removed: id });
});

// ===== File Upload Endpoints =====

// ZIP Upload (Full Package)
const zipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.post('/upload/zip', zipUpload.single('zipfile'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No ZIP file uploaded' });

  try {
    const zip = new AdmZip(req.file.buffer);
    const entries = zip.getEntries();
    const results = { skills: [], soul: null, memory: null, errors: [] };

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const content = entry.getData().toString('utf8');
      const parts = entry.entryName.split('/');
      const filename = parts[parts.length - 1];

      if (filename.toLowerCase() === 'soul.md' && !entry.entryName.includes('skills/')) {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(path.join(DATA_DIR, 'soul.md'), content);
        soulCache = content;
        results.soul = '✅ SOUL.md installed';
        continue;
      }

      if (filename.toLowerCase() === 'memory.md' && !entry.entryName.includes('skills/')) {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(path.join(DATA_DIR, 'memory.md'), content);
        memoryCache = content;
        results.memory = '✅ MEMORY.md installed';
        continue;
      }

      if (entry.entryName.startsWith('skills/') && parts.length >= 3) {
        const skillId = parts[1];
        const targetDir = path.join(SKILLS_DIR, skillId);
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        const fileRelativePath = parts.slice(2).join('/');
        fs.writeFileSync(path.join(targetDir, fileRelativePath), content);
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
    .then(result => res.json(result))
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

// Get current config
app.get('/config', (req, res) => {
  const soul = soulCache ? soulCache.substring(0, 300) : null;
  const memory = memoryCache ? memoryCache.substring(0, 300) : null;
  const skillCount = Object.keys(loadedSkills).length;

  res.json({
    soul: soul ? { loaded: true, preview: soul + '...' } : { loaded: false },
    memory: memory ? { loaded: true, preview: memory + '...' } : { loaded: false },
    skills: { loaded: skillCount, names: Object.keys(loadedSkills) },
    provider: CONFIG.defaultProvider,
    groq: !!CONFIG.groqKey,
    gemini: !!CONFIG.geminiKey,
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
    } else {
      const uploadSkill = loadedSkills['upload'];
      if (!uploadSkill) return res.status(500).json({ error: 'Upload skill not loaded' });
      const result = await uploadSkill.handler.installSkillMd(content, 'skill.md');
      res.json(result);
    }
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch URL: ${err.message}` });
  }
});

// ===== SOUL & MEMORY Loading =====
let soulCache = null;
let memoryCache = null;

// Load on startup
const soulPath = path.join(DATA_DIR, 'soul.md');
const memoryPath = path.join(DATA_DIR, 'memory.md');
if (fs.existsSync(soulPath)) {
  soulCache = fs.readFileSync(soulPath, 'utf8');
  console.log('  💫 SOUL loaded:', soulCache.substring(0, 50) + '...');
}
if (fs.existsSync(memoryPath)) {
  memoryCache = fs.readFileSync(memoryPath, 'utf8');
  console.log('  🧠 Memory loaded:', memoryCache.length, 'chars');
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
║  Health:   http://localhost:${PORT}/status          ║
╚══════════════════════════════════════════════════╝
  `);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});
