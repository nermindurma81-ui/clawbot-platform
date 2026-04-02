// ===== ClawBot Platform - Frontend App =====

const API = window.location.origin;
let authToken = localStorage.getItem('clawbot_token') || null;
let currentUser = null;
let currentChatId = null;
let isStreaming = false;
let isDarkTheme = localStorage.getItem('clawbot_theme') !== 'light';

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  try {
    const isMobile = window.innerWidth <= 1024 || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (isMobile) document.body.classList.add('mobile-device');
    applyTheme();
  } catch (e) { console.error('Init error:', e); }
  
  // Auto-skip auth if no token - enter app directly
  if (!authToken) {
    setTimeout(() => enterApp(), 200);
  } else {
    // Delay auth check to not block page
    setTimeout(() => {
      try {
        checkAuth();
      } catch (e) { console.error('Auth error:', e); }
    }, 100);
  }
  
  try { refreshStatus(); } catch {}
  try { refreshModels(); } catch {}
});

// Re-check on resize
window.addEventListener('resize', () => {
  const isMobile = window.innerWidth <= 1024 || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  document.body.classList.toggle('mobile-device', isMobile);
});

// ===== Theme Toggle =====
function toggleTheme() {
  isDarkTheme = !isDarkTheme;
  localStorage.setItem('clawbot_theme', isDarkTheme ? 'dark' : 'light');
  applyTheme();
}

function applyTheme() {
  document.body.classList.toggle('light-theme', !isDarkTheme);
  document.getElementById('theme-btn').textContent = isDarkTheme ? '🌙' : '☀️';
}

// ===== Auth =====
function showAuthTab(tab, btnEl = null) {
  document.querySelectorAll('.auth-tabs .tab').forEach(t => t.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
  document.getElementById('signup-form').classList.toggle('hidden', tab !== 'signup');
  document.getElementById('auth-error').classList.add('hidden');
}

async function handleLogin(e) {
  e.preventDefault();
  e.stopPropagation();
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
  return false;
}

async function handleSignup(e) {
  e.preventDefault();
  e.stopPropagation();
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
  return false;
}

async function checkAuth() {
  try {
    if (!authToken) return;
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
  currentChatId = null;
  localStorage.removeItem('clawbot_token');
  document.getElementById('auth-screen').classList.add('active');
  document.getElementById('app').classList.remove('active');
}

function enterApp() {
  try {
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('app').classList.add('active');
    document.getElementById('user-name').textContent =
      currentUser?.email?.split('@')[0] || 'Guest';
  } catch {}
  try { refreshModels(); } catch {}
  try { refreshStatus(); } catch {}
  try { loadSettings(); } catch {}
  try { loadChatHistory(); } catch {}
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ===== Navigation =====
function showPanel(name, swipeDir) {
  document.querySelectorAll('.panel').forEach(p => {
    p.classList.remove('active', 'swipe-left', 'swipe-right');
  });
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.bottom-nav-item').forEach(n => n.classList.remove('active'));
  
  const panel = document.getElementById(`panel-${name}`);
  panel.classList.add('active');
  if (swipeDir) panel.classList.add(swipeDir === 1 ? 'swipe-left' : 'swipe-right');
  
  const sidebarItem = document.querySelector(`.nav-item[data-panel="${name}"]`);
  if (sidebarItem) sidebarItem.classList.add('active');
  const bottomItem = document.querySelector(`.bottom-nav-item[data-panel="${name}"]`);
  if (bottomItem) bottomItem.classList.add('active');

  // Load data for panels
  if (name === 'history') loadChatHistory();
  if (name === 'analytics') loadAnalytics();

  // Close sidebar on mobile
  if (window.innerWidth <= 1024) {
    document.querySelector('.sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('show');
  }
  
  // Update panel index
  const idx = PANELS.indexOf(name);
  if (idx !== -1) currentPanelIndex = idx;
}

// ===== Mobile Sidebar =====
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('show');
}

// ===== Streaming Chat =====
const PROVIDER_BADGES = {
  groq:        '⚡ GROQ',
  cerebras:    '⚡ CEREBRAS',
  llm7:        '🆓 LLM7',
  mistral:     '🌬️ MISTRAL',
  siliconflow: '🔷 SILICON',
  gemini:      '✨ GEMINI',
  huggingface: '🤗 HF',
  ollama:      '🦙 LOCAL',
};

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message || isStreaming) return;

  const modelSelect = document.getElementById('model-select');
  const model = modelSelect.value;
  const selectedOpt = modelSelect.selectedOptions[0];

  // Detektuj provider: iz data-provider atributa ili iz MODEL_PROVIDERS mape
  const provider = selectedOpt?.dataset?.provider || MODEL_PROVIDERS[model] || 'llm7';

  // Spremi zadnji model
  localStorage.setItem('clawbot_model', model);

  input.value = '';
  input.style.height = 'auto';

  addMessage('user', message);
  isStreaming = true;
  document.getElementById('send-btn').disabled = true;

  // Pokaži koji provider se koristi
  const typingId = addTypingIndicator(provider);

  const botMsgId = addMessage('bot', '');
  const botContent = document.querySelector(`#${botMsgId} .msg-content`);

  // Napravi history za context
  const chatHistory = [];
  document.querySelectorAll('.message').forEach(msg => {
    const role = msg.classList.contains('user') ? 'user' : 'assistant';
    const content = msg.querySelector('.msg-content')?.textContent || '';
    if (content && content.length > 0) chatHistory.push({ role, content });
  });

  try {
    const res = await fetch(`${API}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        message,
        model,
        provider,  // ← ovo je ključno!
        history: chatHistory.slice(-10),
      }),
    });

    removeTypingIndicator(typingId);

    if (!res.ok) {
      const errData = await res.json();
      botContent.innerHTML = `<span class="error-text">❌ ${errData.error || 'Greška'}</span>`;
      isStreaming = false;
      document.getElementById('send-btn').disabled = false;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('
');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.error) {
              botContent.innerHTML = `<span class="error-text">❌ ${data.error}</span>`;
            } else if (data.content) {
              fullResponse += data.content;
              botContent.innerHTML = formatMessage(fullResponse);
            }
            if (data.done && data.skill) {
              botContent.innerHTML += `<div class="skill-badge">⚡ ${data.skill}</div>`;
            }
            if (data.done && data.model) {
              // Pokaži koji model je odgovorio
              const modelBadge = document.querySelector(`#${botMsgId} .model-badge`);
              if (!modelBadge) {
                const badge = document.createElement('div');
                badge.className = 'model-badge';
                badge.textContent = `${PROVIDER_BADGES[provider] || provider} ${data.model}`;
                document.querySelector(`#${botMsgId} .msg-content-wrap`)?.appendChild(badge);
              }
            }
          } catch {}
        }
      }

      const container = document.getElementById('chat-messages');
      container.scrollTop = container.scrollHeight;
    }

    botContent.querySelectorAll('pre code').forEach(block => {
      if (typeof hljs !== 'undefined') hljs.highlightElement(block);
    });

    saveChatMessage('user', message);
    saveChatMessage('bot', fullResponse, model);

  } catch (err) {
    botContent.innerHTML = `<span class="error-text">❌ ${err.message}</span>`;
  }

  isStreaming = false;
  document.getElementById('send-btn').disabled = false;
  input.focus();
}

function addMessage(role, content) {
  const container = document.getElementById('chat-messages');
  const welcome = container.querySelector('.welcome-screen');
  if (welcome) welcome.remove();
  const quickActions = container.parentElement.querySelector('.quick-actions');
  if (quickActions) quickActions.style.display = 'none';

  const id = 'msg-' + Date.now();
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.id = id;
  const copyBtn = role === 'bot' ? `<button class="btn-copy" onclick="copyMessage(this)" title="Copy">📋</button>` : '';
  div.innerHTML = `
    <div class="msg-avatar">${role === 'user' ? '👤' : '🐾'}</div>
    <div class="msg-content-wrap">
      <div class="msg-content">${formatMessage(content)}</div>
      ${copyBtn}
    </div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return id;
}

function addTypingIndicator(provider = '') {
  const container = document.getElementById('chat-messages');
  const id = 'typing-' + Date.now();
  const div = document.createElement('div');
  div.className = 'message bot';
  div.id = id;
  const badge = PROVIDER_BADGES[provider] || provider;
  div.innerHTML = `
    <div class="msg-avatar">🐾</div>
    <div class="msg-content">
      <div class="typing-indicator">
        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
      </div>
      ${provider ? `<div class="provider-typing">${badge}</div>` : ''}
    </div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return id;
}

function removeTypingIndicator(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function formatMessage(text) {
  if (!text) return '';
  return text
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
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

function newChat() {
  currentChatId = null;
  const container = document.getElementById('chat-messages');
  container.innerHTML = `
    <div class="welcome-msg">
      <h3>New Chat 🐾</h3>
      <p>Start a fresh conversation</p>
      <div class="quick-prompts">
        <button class="chip" onclick="sendQuick('Objasni mi machine learning')">🤖 ML explain</button>
        <button class="chip" onclick="sendQuick('Napravi mi todo app')">🚀 Build app</button>
        <button class="chip" onclick="sendQuick('translate hello to German')">🌍 Translate</button>
        <button class="chip" onclick="sendQuick('weather in Sarajevo')">🌤️ Weather</button>
      </div>
    </div>
  `;
}

// ===== Voice Input/Output =====
let recognition = null;
let isListening = false;

function toggleVoice() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    alert('Voice not supported in this browser. Try Chrome.');
    return;
  }

  if (isListening) {
    recognition.stop();
    isListening = false;
    document.getElementById('voice-btn').classList.remove('active');
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = 'bs'; // Bosnian
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onresult = (event) => {
    const transcript = Array.from(event.results).map(r => r[0].transcript).join('');
    document.getElementById('chat-input').value = transcript;
  };

  recognition.onend = () => {
    isListening = false;
    document.getElementById('voice-btn').classList.remove('active');
  };

  recognition.onerror = () => {
    isListening = false;
    document.getElementById('voice-btn').classList.remove('active');
  };

  recognition.start();
  isListening = true;
  document.getElementById('voice-btn').classList.add('active');
}

// ===== File Upload =====
function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const content = e.target.result;
    const input = document.getElementById('chat-input');

    if (file.name.endsWith('.md')) {
      // Skill or config file
      input.value = `[Uploaded: ${file.name}]\n\n${content}`;
    } else if (file.name.match(/\.(js|py|html|css|json|txt|csv)$/)) {
      input.value = `Analyze this ${file.name}:\n\n\`\`\`\n${content}\n\`\`\``;
    } else {
      input.value = `[File uploaded: ${file.name}, ${(file.size / 1024).toFixed(1)}KB]`;
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// ===== Chat History =====
async function loadChatHistory() {
  const list = document.getElementById('history-list');

  if (!authToken) {
    list.innerHTML = '<div class="loading">Login to sync chat history</div>';
    // Load from localStorage
    const local = JSON.parse(localStorage.getItem('clawbot_chats') || '[]');
    if (local.length > 0) {
      list.innerHTML = local.map(c => `
        <div class="history-item" onclick="loadLocalChat('${c.id}')">
          <h4>${c.title || 'Chat'}</h4>
          <small>${new Date(c.created).toLocaleDateString()}</small>
        </div>
      `).join('');
    }
    return;
  }

  try {
    const res = await fetch(`${API}/chats`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await res.json();

    if (!data.chats || data.chats.length === 0) {
      list.innerHTML = '<div class="loading">No chat history yet</div>';
      return;
    }

    list.innerHTML = data.chats.map(c => `
      <div class="history-item" onclick="loadChat('${c.id}')">
        <h4>${c.title || 'Chat'}</h4>
        <small>${new Date(c.updated_at).toLocaleDateString()} • ${c.model || ''}</small>
        <button class="btn-xs btn-danger" onclick="event.stopPropagation();deleteChat('${c.id}')">🗑️</button>
      </div>
    `).join('');
  } catch {
    list.innerHTML = '<div class="loading error">Failed to load history</div>';
  }
}

async function loadChat(id) {
  try {
    const res = await fetch(`${API}/chats/${id}/messages`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await res.json();

    currentChatId = id;
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';

    data.messages.forEach(msg => {
      addMessage(msg.role, msg.content);
    });

    showPanel('chat');
  } catch {}
}

async function saveChatMessage(role, content, model) {
  // Save to localStorage
  let chats = JSON.parse(localStorage.getItem('clawbot_chats') || '[]');
  if (!currentChatId) {
    currentChatId = 'local-' + Date.now();
    chats.unshift({ id: currentChatId, title: content.substring(0, 50), created: Date.now() });
    localStorage.setItem('clawbot_chats', JSON.stringify(chats.slice(0, 20)));
  }

  // Save to Supabase if logged in
  if (authToken && currentChatId && !currentChatId.startsWith('local-')) {
    fetch(`${API}/chats/${currentChatId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ role, content, model }),
    }).catch(() => {});
  }
}

async function deleteChat(id) {
  if (!confirm('Delete this chat?')) return;
  await fetch(`${API}/chats/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${authToken}` },
  });
  loadChatHistory();
}

// ===== Model Compare =====
async function compareModels() {
  const message = document.getElementById('compare-input').value.trim();
  if (!message) return;

  const results = document.getElementById('compare-results');
  results.innerHTML = '<div class="loading">Comparing models...</div>';

  try {
    const res = await fetch(`${API}/chat/compare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();

    if (data.error) {
      results.innerHTML = `<div class="error-msg">${data.error}</div>`;
      return;
    }

    results.innerHTML = data.models.map(m => `
      <div class="compare-card">
        <h4>🧠 ${m.name} <span class="badge">${m.time}</span></h4>
        <div class="compare-response">${formatMessage(m.response)}</div>
      </div>
    `).join('');

    // Highlight code
    results.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
  } catch (err) {
    results.innerHTML = `<div class="error-msg">${err.message}</div>`;
  }
}

// ===== Analytics =====
async function loadAnalytics() {
  const grid = document.getElementById('analytics-grid');

  try {
    const res = await fetch(`${API}/analytics`);
    const data = await res.json();

    grid.innerHTML = `
      <div class="stat-card">
        <div class="stat-number">${data.messages}</div>
        <div class="stat-label">Total Messages</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${data.unique_users}</div>
        <div class="stat-label">Users</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${Math.floor(data.uptime_seconds / 60)}m</div>
        <div class="stat-label">Uptime</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${data.is_admin ? '👑' : '👤'}</div>
        <div class="stat-label">${data.is_admin ? 'Admin' : 'User'}</div>
      </div>
      ${data.top_skills.length ? `
        <div class="stat-card wide">
          <h4>Top Skills</h4>
          ${data.top_skills.map(([name, count]) => `<div class="stat-row"><span>${name}</span><span>${count}</span></div>`).join('')}
        </div>
      ` : ''}
      ${data.top_models.length ? `
        <div class="stat-card wide">
          <h4>Top Models</h4>
          ${data.top_models.map(([name, count]) => `<div class="stat-row"><span>${name}</span><span>${count}</span></div>`).join('')}
        </div>
      ` : ''}
    `;
  } catch {
    grid.innerHTML = '<div class="loading error">Failed to load analytics</div>';
  }
}

// ===== Models =====
async function refreshModels() {
  try {
    // Dohvati sve free providere
    const [provRes, ollamaRes] = await Promise.allSettled([
      fetch(`${API}/models/providers`),
      fetch(`${API}/ollama/api/tags`),
    ]);

    const select = document.getElementById('model-select');
    select.innerHTML = '';

    // Ollama lokalni modeli (Railway)
    if (ollamaRes.status === 'fulfilled' && ollamaRes.value.ok) {
      const ollamaData = await ollamaRes.value.json();
      const ollamaModels = ollamaData.models || [];
      if (ollamaModels.length > 0) {
        const grp = document.createElement('optgroup');
        grp.label = '🦙 Ollama (Railway — lokalni)';
        ollamaModels.forEach(m => {
          MODEL_PROVIDERS[m.name] = 'ollama';
          const opt = document.createElement('option');
          opt.value = m.name;
          opt.dataset.provider = 'ollama';
          const sizeGB = m.size ? (m.size / 1e9).toFixed(1) + 'GB' : '';
          opt.textContent = `${m.name} ${sizeGB}`;
          grp.appendChild(opt);
        });
        select.appendChild(grp);
      }
    }

    // Svi cloud provideri
    if (provRes.status === 'fulfilled' && provRes.value.ok) {
      const provData = await provRes.value.json();
      (provData.providers || []).forEach(provider => {
        if (provider.id === 'ollama') return; // već dodano gore
        if (!provider.models?.length) return;

        const grp = document.createElement('optgroup');
        const statusIcon = provider.configured ? '✅' : '🔑';
        grp.label = `${provider.name} ${statusIcon} — ${provider.description}`;

        provider.models.forEach(m => {
          MODEL_PROVIDERS[m.id] = provider.id;
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.dataset.provider = provider.id;
          opt.textContent = `${m.speed || ''} ${m.name} (${m.size || 'cloud'})`;
          if (!provider.configured && provider.id !== 'llm7') opt.disabled = true;
          grp.appendChild(opt);
        });

        select.appendChild(grp);
      });
    }

    // Ako je dropdown prazan, stavi fallback
    if (select.options.length === 0) {
      const opt = document.createElement('option');
      opt.value = 'deepseek-chat';
      opt.dataset.provider = 'llm7';
      opt.textContent = '🆓 DeepSeek Chat (LLM7 — bez ključa)';
      select.appendChild(opt);
    }

    // Označi trenutno odabrani model iz settingsa
    const saved = localStorage.getItem('clawbot_model');
    if (saved) {
      for (const opt of select.options) {
        if (opt.value === saved) { opt.selected = true; break; }
      }
    }

  } catch (err) {
    console.error('refreshModels failed:', err);
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
    theme: isDarkTheme ? 'dark' : 'light',
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
    .then(data => alert(data.message || 'Settings saved!'))
    .catch(err => {
      localStorage.setItem('clawbot_settings', JSON.stringify(settings));
      alert('Saved locally');
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
    }
  } catch {}
}

// ===== Skills Management =====
async function refreshSkills() {
  const list = document.getElementById('skills-list');
  list.innerHTML = '<div class="loading">Loading skills...</div>';

  try {
    const res = await fetch(`${API}/skills`);
    const data = await res.json();

    if (!data.skills || data.skills.length === 0) {
      list.innerHTML = '<div class="loading">No skills installed</div>';
      return;
    }

    list.innerHTML = data.skills.map(s => `
      <div class="skill-card">
        <span class="skill-icon">${s.icon || '🔧'}</span>
        <div class="skill-info">
          <h4>${s.name}</h4>
          <p>${s.description || ''}</p>
          ${s.triggers?.length ? `<small class="triggers">${s.triggers.slice(0, 3).join(', ')}</small>` : ''}
        </div>
        <span class="skill-status active">Active</span>
      </div>
    `).join('');

    loadConfig();
  } catch (err) {
    list.innerHTML = `<div class="loading error">${err.message}</div>`;
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

function showInstallModal() { document.getElementById('install-modal').classList.remove('hidden'); }
function hideInstallModal() { document.getElementById('install-modal').classList.add('hidden'); }

function showInstallTab(tab, btnEl = null) {
  document.querySelectorAll('.install-tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.install-tabs .tab').forEach(el => el.classList.remove('active'));
  document.getElementById(`install-${tab}`).classList.remove('hidden');
  if (btnEl) btnEl.classList.add('active');
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
    resultEl.innerHTML = data.success
      ? `<div class="success-msg">${data.message}</div>`
      : `<div class="error-msg">❌ ${data.error}</div>`;
    if (data.success) { document.getElementById('skill-md-input').value = ''; refreshSkills(); }
  } catch (err) {
    resultEl.innerHTML = `<div class="error-msg">❌ ${err.message}</div>`;
  }
}

async function installSkillFromUrl() {
  const url = document.getElementById('skill-url-input').value.trim();
  if (!url) return;

  const resultEl = document.getElementById('install-result');
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = '<div class="loading">Installing...</div>';

  try {
    const res = await fetch(`${API}/upload/url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, type: 'skill' }),
    });
    const data = await res.json();
    resultEl.innerHTML = data.success
      ? `<div class="success-msg">${data.message}</div>`
      : `<div class="error-msg">❌ ${data.error}</div>`;
    if (data.success) { document.getElementById('skill-url-input').value = ''; refreshSkills(); }
  } catch (err) {
    resultEl.innerHTML = `<div class="error-msg">❌ ${err.message}</div>`;
  }
}

async function removeSkill(id) {
  if (!confirm(`Remove '${id}'?`)) return;
  try {
    const res = await fetch(`${API}/skills/${id}`, {
      method: 'DELETE',
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Failed (${res.status})`);
    refreshSkills();
  } catch (err) {
    alert(`❌ ${err.message}`);
  }
}

async function uploadSoul() {
  const content = document.getElementById('soul-input').value.trim();
  if (!content) return;
  const res = await fetch(`${API}/settings/soul`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
    body: JSON.stringify({ content }),
  });
  const data = await res.json();
  if (data.success) { document.getElementById('soul-status').textContent = '✅ Loaded'; document.getElementById('soul-input').value = ''; alert(data.message); }
}

async function uploadMemory() {
  const content = document.getElementById('memory-input').value.trim();
  if (!content) return;
  const res = await fetch(`${API}/settings/memory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
    body: JSON.stringify({ content, append: true }),
  });
  const data = await res.json();
  if (data.success) { document.getElementById('memory-status').textContent = '✅ Loaded'; document.getElementById('memory-input').value = ''; alert(data.message); }
}

// ===== Swipe Navigation =====
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let isSwiping = false;

const PANELS = ['chat', 'history', 'skills', 'settings'];
let currentPanelIndex = 0;
let MODEL_PROVIDERS = {};

function initSwipe() {
  const main = document.querySelector('.main-content');
  if (!main) return;

  main.addEventListener('touchstart', (e) => {
    // Don't swipe if input is focused
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
    isSwiping = true;
  }, { passive: true });

  main.addEventListener('touchend', (e) => {
    if (!isSwiping) return;
    isSwiping = false;
    touchEndX = e.changedTouches[0].screenX;
    const touchEndY = e.changedTouches[0].screenY;
    
    const diffX = touchEndX - touchStartX;
    const diffY = touchEndY - touchStartY;
    
    // Only horizontal swipes (ignore vertical scrolling)
    if (Math.abs(diffX) < 60 || Math.abs(diffY) > Math.abs(diffX)) return;
    
    const threshold = 80;
    
    if (diffX < -threshold) {
      // Swipe left → next panel
      navigatePanel(1);
    } else if (diffX > threshold) {
      // Swipe right → prev panel
      navigatePanel(-1);
    }
  }, { passive: true });
}

function navigatePanel(direction) {
  // Update current index based on active panel
  const activePanel = document.querySelector('.panel.active');
  if (activePanel) {
    const panelName = activePanel.id.replace('panel-', '');
    const idx = PANELS.indexOf(panelName);
    if (idx !== -1) currentPanelIndex = idx;
  }
  
  currentPanelIndex += direction;
  if (currentPanelIndex < 0) currentPanelIndex = 0;
  if (currentPanelIndex >= PANELS.length) currentPanelIndex = PANELS.length - 1;
  
  showPanel(PANELS[currentPanelIndex], direction);
}

// Init swipe on load
document.addEventListener('DOMContentLoaded', () => {
  initSwipe();
});

// ===== Settings Bottom Sheet =====
function toggleSettingsSheet() {
  const sheet = document.getElementById('settings-sheet');
  const overlay = document.getElementById('sheet-overlay');
  sheet.classList.toggle('open');
  overlay.classList.toggle('show');
}

function saveMobileSettings() {
  const model = document.getElementById('setting-model-mobile')?.value;
  const system = document.getElementById('setting-system-mobile')?.value;
  
  if (model) document.getElementById('setting-model').value = model;
  if (system) document.getElementById('setting-system').value = system;
  
  saveSettings();
  toggleSettingsSheet();
}

// ===== Copy Button =====
function copyMessage(btn) {
  const content = btn.closest('.message').querySelector('.msg-content');
  const text = content.innerText;
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✅';
    setTimeout(() => btn.textContent = '📋', 1500);
  });
}

// ===== Share Chat =====
async function shareChat() {
  const messages = [];
  document.querySelectorAll('.message').forEach(msg => {
    const role = msg.classList.contains('user') ? 'user' : 'assistant';
    const content = msg.querySelector('.msg-content')?.innerText || '';
    if (content) messages.push({ role, content });
  });

  if (messages.length === 0) return alert('No messages to share');

  try {
    const res = await fetch(`${API}/chats/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, title: 'ClawBot Chat' }),
    });
    const data = await res.json();
    if (data.url) {
      const shareUrl = window.location.origin + data.url;
      navigator.clipboard.writeText(shareUrl);
      alert('Link copied: ' + shareUrl);
    }
  } catch (err) {
    alert('Share failed: ' + err.message);
  }
}

// ===== Skill Marketplace =====
async function loadMarketplace(query = '') {
  try {
    const url = query ? `${API}/marketplace?q=${encodeURIComponent(query)}` : `${API}/marketplace`;
    const res = await fetch(url);
    const data = await res.json();
    return data.skills || [];
  } catch {
    return [];
  }
}

async function installFromMarketplace(slug) {
  try {
    const res = await fetch(`${API}/marketplace/install/${slug}`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      alert(`✅ ${data.name || slug} installed!`);
      refreshSkills();
    } else {
      alert(`❌ ${data.error}`);
    }
  } catch (err) {
    alert(`❌ ${err.message}`);
  }
}

// ===== Custom Commands =====
async function loadCommands() {
  try {
    const res = await fetch(`${API}/commands`);
    const data = await res.json();
    return data.commands || {};
  } catch {
    return {};
  }
}

async function saveCommand(name, action) {
  try {
    const res = await fetch(`${API}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, action }),
    });
    const data = await res.json();
    return data.success;
  } catch {
    return false;
  }
}

// ===== Auto-Update Skills =====
async function updateAllSkills() {
  try {
    const res = await fetch(`${API}/skills/update-all`, { method: 'POST' });
    const data = await res.json();
    const updated = data.results?.filter(r => r.updated) || [];
    if (updated.length > 0) {
      alert(`✅ Updated ${updated.length} skills!`);
      refreshSkills();
    } else {
      alert('All skills are up to date');
    }
  } catch (err) {
    alert('Update failed: ' + err.message);
  }
}

// ===== Marketplace UI =====
async function loadMarketplaceUI() {
  const container = document.getElementById('marketplace-list');
  container.innerHTML = '<div class="loading">Loading marketplace...</div>';
  
  const skills = await loadMarketplace();
  
  if (skills.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:var(--text-secondary)">No skills found</p>';
    return;
  }
  
  container.innerHTML = skills.map(s => `
    <div class="marketplace-item">
      <div class="mi-header">
        <span class="mi-icon">${s.icon || '🔧'}</span>
        <div>
          <div class="mi-name">${s.name || s.id}</div>
          <div class="mi-desc">${s.description || ''}</div>
        </div>
      </div>
      <button class="btn-sm btn-primary" onclick="installFromMarketplace('${s.slug || s.id}')">
        ${s.installed ? '✅ Installed' : '⬇️ Install'}
      </button>
    </div>
  `).join('');
}

// ===== Helpers =====
function formatBytes(bytes) {
  if (!bytes) return 'Unknown';
  const gb = bytes / (1024 ** 3);
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 ** 2)).toFixed(0)} MB`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString();
}

// ZIP Upload
document.getElementById('zip-upload')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const status = document.getElementById('zip-status');
  if (status) status.textContent = '⏳ Uploading & installing...';
  const formData = new FormData();
  formData.append('zipfile', file);
  try {
    const res = await fetch(`${API}/upload/zip`, {
      method: 'POST',
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      body: formData,
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (status) status.innerHTML = `✅ ${data.message}<br>Skills: ${data.skills?.join(', ') || 'none'}`;
    refreshSkills();
    loadSettings();
  } catch (err) {
    if (status) status.textContent = `❌ ${err.message}`;
  } finally {
    e.target.value = '';
  }
});
