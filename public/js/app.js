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
    ollama: document.getElementById('setting-ollama').value,
    gateway: document.getElementById('setting-gateway').value,
    model: document.getElementById('setting-model').value,
    system: document.getElementById('setting-system').value,
  };
  localStorage.setItem('clawbot_settings', JSON.stringify(settings));
  alert('Settings saved! (Applied on next restart)');
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
