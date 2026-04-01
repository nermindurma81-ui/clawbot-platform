// ===== ClawBot Platform - Frontend App =====

const API = window.location.origin;
let authToken = localStorage.getItem('clawbot_token') || null;
let currentUser = null;

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  if (authToken) {
    checkAuth();
  }
  refreshStatus();
});

// ===== Auth =====
function showAuthTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
  document.getElementById('signup-form').classList.toggle('hidden', tab !== 'signup');
  document.getElementById('auth-error').classList.add('hidden');
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    authToken = data.session?.access_token;
    if (authToken) localStorage.setItem('clawbot_token', authToken);
    currentUser = data.user;
    enterApp();
  } catch (err) {
    showAuthError(err.message);
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const email = document.getElementById('signup-email').value;
  const password = document.getElementById('signup-password').value;
  try {
    const res = await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    authToken = data.session?.access_token;
    if (authToken) localStorage.setItem('clawbot_token', authToken);
    currentUser = data.user;
    enterApp();
  } catch (err) {
    showAuthError(err.message);
  }
}

async function checkAuth() {
  try {
    const res = await fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await res.json();
    if (data.user) {
      currentUser = data.user;
      enterApp();
    }
  } catch { /* stay on auth screen */ }
}

function skipAuth() {
  enterApp();
}

function logout() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('clawbot_token');
  document.getElementById('auth-screen').classList.add('active');
  document.getElementById('app').classList.remove('active');
}

function enterApp() {
  document.getElementById('auth-screen').classList.remove('active');
  document.getElementById('app').classList.add('active');
  document.getElementById('user-name').textContent =
    currentUser?.email?.split('@')[0] || 'Guest';
  refreshModels();
  refreshStatus();
  loadSettings();
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ===== Navigation =====
function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`panel-${name}`).classList.add('active');
  document.querySelector(`[data-panel="${name}"]`).classList.add('active');
}

// ===== Chat =====
async function sendMessage() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  const model = document.getElementById('model-select').value;
  input.value = '';
  input.style.height = 'auto';

  addMessage('user', message);

  const btn = document.getElementById('send-btn');
  btn.disabled = true;

  // Show typing
  const typingId = addTyping();

  try {
    const res = await fetch(`${API}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ message, model }),
    });
    const data = await res.json();
    removeTyping(typingId);

    if (data.error) {
      addMessage('bot', `❌ Error: ${data.error}`);
    } else {
      addMessage('bot', data.response);
    }
  } catch (err) {
    removeTyping(typingId);
    addMessage('bot', `❌ Connection error: ${err.message}`);
  }

  btn.disabled = false;
  input.focus();
}

function addMessage(role, content) {
  const container = document.getElementById('chat-messages');
  // Remove welcome message if present
  const welcome = container.querySelector('.welcome-msg');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.innerHTML = `
    <div class="msg-avatar">${role === 'user' ? '👤' : '🐾'}</div>
    <div class="msg-content">${formatMessage(content)}</div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function formatMessage(text) {
  // Basic markdown-like formatting
  return text
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function addTyping() {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  const id = 'typing-' + Date.now();
  div.id = id;
  div.className = 'message bot';
  div.innerHTML = `
    <div class="msg-avatar">🐾</div>
    <div class="msg-content">
      <div class="typing-indicator"><span></span><span></span><span></span></div>
    </div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return id;
}

function removeTyping(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function sendQuick(text) {
  document.getElementById('chat-input').value = text;
  sendMessage();
}

// ===== Models =====
async function refreshModels() {
  const grid = document.getElementById('models-grid');
  grid.innerHTML = '<div class="loading">Loading models...</div>';

  try {
    const res = await fetch(`${API}/models`);
    const data = await res.json();

    if (!data.models?.length) {
      grid.innerHTML = '<div class="loading">No models found. Run: ollama pull llama3</div>';
      return;
    }

    grid.innerHTML = data.models.map(m => `
      <div class="model-card">
        <h4>${m.name}</h4>
        <p class="model-size">${formatSize(m.size)}</p>
        <div class="model-meta">
          <span>📅 ${formatDate(m.modified_at)}</span>
          <span>🏷️ ${m.digest?.slice(0, 8) || '—'}</span>
        </div>
      </div>
    `).join('');

    // Update dropdown
    const select = document.getElementById('model-select');
    select.innerHTML = data.models.map(m =>
      `<option value="${m.name}">${m.name}</option>`
    ).join('');
  } catch (err) {
    grid.innerHTML = `<div class="loading">Error: ${err.message}</div>`;
  }
}

// ===== Status =====
async function refreshStatus() {
  try {
    const res = await fetch(`${API}/status`);
    const data = await res.json();

    updateStatusIndicator('status-ollama', data.checks.ollama);
    updateStatusIndicator('status-gateway', data.checks.gateway);
    updateStatusIndicator('status-supabase', data.checks.supabase === 'configured' ? 'online' : 'warning');

    const uptime = Math.floor(data.uptime);
    const mins = Math.floor(uptime / 60);
    const hrs = Math.floor(mins / 60);
    document.getElementById('uptime-display').textContent =
      hrs > 0 ? `Uptime: ${hrs}h ${mins % 60}m` : `Uptime: ${mins}m ${uptime % 60}s`;
  } catch {
    updateStatusIndicator('status-ollama', 'offline');
    updateStatusIndicator('status-gateway', 'offline');
    updateStatusIndicator('status-supabase', 'offline');
  }
}

function updateStatusIndicator(id, status) {
  const el = document.getElementById(id);
  el.className = 'status-indicator ' + (status === 'online' ? 'online' : status === 'offline' ? 'offline' : 'warning');
}

// ===== Settings =====
function saveSettings() {
  const settings = {
    ollama_url: document.getElementById('setting-ollama').value,
    gateway_url: document.getElementById('setting-gateway').value,
    model: document.getElementById('setting-model').value,
    system_prompt: document.getElementById('setting-system').value,
    provider: document.getElementById('setting-provider')?.value || 'groq',
    theme: 'dark',
  };

  fetch(`${API}/settings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify(settings),
  })
    .then(res => res.json())
    .then(data => {
      alert(data.message || 'Settings saved!');
    })
    .catch(err => {
      // Fallback to localStorage
      localStorage.setItem('clawbot_settings', JSON.stringify(settings));
      alert('Saved locally (server error)');
    });
}

async function loadSettings() {
  try {
    const res = await fetch(`${API}/settings`, {
      headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
    });
    const data = await res.json();
    const s = data.settings;

    if (s) {
      document.getElementById('setting-ollama').value = s.ollama_url || '';
      document.getElementById('setting-gateway').value = s.gateway_url || '';
      document.getElementById('setting-system').value = s.system_prompt || '';

      // Set model if in dropdown
      const modelSelect = document.getElementById('setting-model');
      if (modelSelect && s.model) {
        for (let opt of modelSelect.options) {
          if (opt.value === s.model) { opt.selected = true; break; }
        }
      }
    }
  } catch {
    // Fallback to localStorage
    const saved = localStorage.getItem('clawbot_settings');
    if (saved) {
      const s = JSON.parse(saved);
      document.getElementById('setting-ollama').value = s.ollama || s.ollama_url || '';
      document.getElementById('setting-gateway').value = s.gateway || s.gateway_url || '';
      document.getElementById('setting-system').value = s.system || s.system_prompt || '';
    }
  }
}

// ===== Helpers =====
function formatSize(bytes) {
  if (!bytes) return 'Unknown';
  const gb = bytes / (1024 ** 3);
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 ** 2)).toFixed(0)} MB`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString();
}

// ===== Skills Management =====
async function refreshSkills() {
  const list = document.getElementById('skills-list');
  list.innerHTML = '<div class="loading">Loading skills...</div>';

  try {
    const res = await fetch(`${API}/skills`);
    const data = await res.json();

    if (!data.skills || data.skills.length === 0) {
      list.innerHTML = '<div class="loading">No skills installed. Click + Install to add one.</div>';
      return;
    }

    list.innerHTML = data.skills.map(s => `
      <div class="skill-card">
        <span class="skill-icon">${s.icon || '🔧'}</span>
        <div class="skill-info">
          <h4>${s.name}</h4>
          <p>${s.description || 'No description'}</p>
          ${s.triggers && s.triggers.length ? `<small class="triggers">Triggers: ${s.triggers.slice(0, 3).join(', ')}</small>` : ''}
        </div>
        <div class="skill-actions">
          <span class="skill-status active">Active</span>
          ${s.id !== 'skills' && s.id !== 'upload' ? `<button class="btn-xs btn-danger" onclick="removeSkill('${s.id}')">🗑️</button>` : ''}
        </div>
      </div>
    `).join('');

    // Also load config
    loadConfig();
  } catch (err) {
    list.innerHTML = `<div class="loading">Error: ${err.message}</div>`;
  }
}

async function loadConfig() {
  try {
    const res = await fetch(`${API}/config`);
    const data = await res.json();

    document.getElementById('soul-status').textContent = data.soul?.loaded ? '✅ Loaded' : '❌ Not loaded';
    document.getElementById('memory-status').textContent = data.memory?.loaded ? '✅ Loaded' : '❌ Not loaded';
  } catch {}
}

// Install modal
function showInstallModal() {
  document.getElementById('install-modal').classList.remove('hidden');
  document.getElementById('install-result').classList.add('hidden');
}

function hideInstallModal() {
  document.getElementById('install-modal').classList.add('hidden');
}

function showInstallTab(tab) {
  document.querySelectorAll('.install-tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.install-tabs .tab').forEach(el => el.classList.remove('active'));
  document.getElementById(`install-${tab}`).classList.remove('hidden');
  event.target.classList.add('active');
}

async function installSkillMd() {
  const content = document.getElementById('skill-md-input').value.trim();
  if (!content) return alert('Paste skill.md content first');

  const resultEl = document.getElementById('install-result');
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = '<div class="loading">Installing...</div>';

  try {
    const res = await fetch(`${API}/upload/skill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, filename: 'skill.md' }),
    });
    const data = await res.json();

    if (data.success) {
      resultEl.innerHTML = `<div class="success-msg">${data.message}</div>`;
      document.getElementById('skill-md-input').value = '';
      refreshSkills();
    } else {
      resultEl.innerHTML = `<div class="error-msg">❌ ${data.error}</div>`;
    }
  } catch (err) {
    resultEl.innerHTML = `<div class="error-msg">❌ ${err.message}</div>`;
  }
}

async function installSkillFromUrl() {
  const url = document.getElementById('skill-url-input').value.trim();
  if (!url) return alert('Enter a URL first');

  const resultEl = document.getElementById('install-result');
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = '<div class="loading">Installing from URL...</div>';

  try {
    const res = await fetch(`${API}/upload/url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, type: 'skill' }),
    });
    const data = await res.json();

    if (data.success) {
      resultEl.innerHTML = `<div class="success-msg">${data.message}</div>`;
      document.getElementById('skill-url-input').value = '';
      refreshSkills();
    } else {
      resultEl.innerHTML = `<div class="error-msg">❌ ${data.error}</div>`;
    }
  } catch (err) {
    resultEl.innerHTML = `<div class="error-msg">❌ ${err.message}</div>`;
  }
}

async function searchSkills() {
  const query = document.getElementById('skill-search-input').value.trim();
  if (!query) return;

  const resultsEl = document.getElementById('search-results');
  resultsEl.innerHTML = '<div class="loading">Searching...</div>';

  try {
    const res = await fetch(`${API}/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'search', query }),
    });
    const skillRes = await fetch(`${API}/skills/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'search', query }) });

    // Use the skills endpoint directly
    const data = await res.json();
    resultsEl.innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
  } catch (err) {
    resultsEl.innerHTML = `<div class="error-msg">${err.message}</div>`;
  }
}

async function removeSkill(id) {
  if (!confirm(`Remove skill '${id}'?`)) return;

  try {
    const res = await fetch(`${API}/skills/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.error) alert(data.error);
    refreshSkills();
  } catch (err) {
    alert(err.message);
  }
}

async function uploadSoul() {
  const content = document.getElementById('soul-input').value.trim();
  if (!content) return alert('Write something first');

  try {
    const res = await fetch(`${API}/settings/soul`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ content }),
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('soul-status').textContent = '✅ Loaded';
      document.getElementById('soul-input').value = '';
      alert(data.message);
    }
  } catch (err) {
    alert(err.message);
  }
}

async function uploadMemory() {
  const content = document.getElementById('memory-input').value.trim();
  if (!content) return alert('Write something first');

  try {
    const res = await fetch(`${API}/settings/memory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ content, append: true }),
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('memory-status').textContent = '✅ Loaded';
      document.getElementById('memory-input').value = '';
      alert(data.message);
    }
  } catch (err) {
    alert(err.message);
  }
}

// Auto-load skills when panel opens
document.addEventListener('DOMContentLoaded', () => {
  // Override showPanel to load skills
  const origShowPanel = window.showPanel;
  window.showPanel = function(name) {
    origShowPanel(name);
    if (name === 'skills') refreshSkills();
  };
});
