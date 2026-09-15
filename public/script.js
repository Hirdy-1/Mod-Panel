// Set relative API route since frontend and backend are hosted together
const API_BASE_URL = window.location.origin;

let currentModmailThreads = [];
let activeUserId = null;

// Navigation Routing
const sections = document.querySelectorAll('.page-section');
const navItems = document.querySelectorAll('[data-section]');
const pageName = document.getElementById('pageName');

function showSection(id) {
  sections.forEach(s => s.classList.toggle('active', s.id === id));
  navItems.forEach(n => n.classList.toggle('active', n.dataset.section === id));
  if (pageName) pageName.textContent = id.toUpperCase();
  window.location.hash = id;
}

navItems.forEach(item => item.addEventListener('click', e => {
  e.preventDefault();
  showSection(item.dataset.section);
}));

const initialSection = window.location.hash.slice(1);
if (document.getElementById(initialSection)) showSection(initialSection);

// Modal Controls
const modal = document.getElementById('actionModal');
document.querySelectorAll('[data-open-modal="actionModal"]').forEach(b => b.addEventListener('click', () => modal.classList.add('show')));
document.querySelectorAll('.close-modal').forEach(b => b.addEventListener('click', () => modal.classList.remove('show')));

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// Check Backend Connection Status
document.getElementById('testConnection')?.addEventListener('click', async () => {
  try {
    const res = await fetch(`${API_BASE_URL}/api/status`);
    const data = await res.json();
    toast(data.online ? `Connected! Ping: ${data.ping}ms` : 'Bot offline.');
  } catch {
    toast('API connection failed.');
  }
});

// Moderation Actions (Ban/Kick)
document.getElementById('confirmAction')?.addEventListener('click', async () => {
  const userId = document.getElementById('memberInput').value.trim();
  const reason = document.getElementById('reasonInput').value.trim();
  const action = document.getElementById('actionType').value;

  if (!userId || !reason) return toast('Missing ID or reason.');

  try {
    const res = await fetch(`${API_BASE_URL}/api/moderate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, userId, reason }),
    });
    const result = await res.json();
    toast(res.ok ? result.message : `Error: ${result.error}`);
    if (res.ok) modal.classList.remove('show');
  } catch {
    toast('Network request failed.');
  }
});

// Fetch & Render Modmail Threads
async function loadModmailThreads() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/modmail`);
    if (!res.ok) return;
    currentModmailThreads = await res.json();
    renderModmailList(currentModmailThreads);
    if (activeUserId) selectThread(activeUserId);
  } catch (e) {
    console.error(e);
  }
}

function renderModmailList(threads) {
  const container = document.getElementById('modmailList');
  if (!container) return;

  if (threads.length === 0) {
    container.innerHTML = '<div style="padding: 20px; color: #8b94a7;">No active Modmail DMs</div>';
    return;
  }

  container.innerHTML = threads.map(t => `
    <div class="mail-item ${t.userId === activeUserId ? 'selected' : ''}" data-userid="${t.userId}">
      <img src="${t.avatar}" style="width:31px; height:31px; border-radius:50%;" />
      <div>
        <b>${t.username}</b>
        <p>${t.lastMessage ? t.lastMessage.content : 'No messages'}</p>
        <small>${t.lastMessage ? t.lastMessage.timestamp : ''}</small>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('.mail-item').forEach(item => {
    item.addEventListener('click', () => selectThread(item.dataset.userid));
  });
}

function selectThread(userId) {
  activeUserId = userId;
  const thread = currentModmailThreads.find(t => t.userId === userId);
  if (!thread) return;

  document.getElementById('conversationHead').innerHTML = `
    <img src="${thread.avatar}" style="width:31px; height:31px; border-radius:50%;" />
    <div>
      <h3>${thread.username}</h3>
      <span class="muted">ID: ${thread.userId}</span>
    </div>
  `;

  const msgContainer = document.getElementById('messageList');
  msgContainer.innerHTML = thread.messages.map(m => `
    <div class="message ${m.type === 'incoming' ? 'incoming' : 'outgoing'}">
      <p>${m.content}</p>
      <small>${m.sender} · ${m.timestamp}</small>
    </div>
  `).join('');

  msgContainer.scrollTop = msgContainer.scrollHeight;
}

// Send Modmail Reply
document.getElementById('sendReply')?.addEventListener('click', async () => {
  if (!activeUserId) return toast('Select a thread first.');
  const textarea = document.querySelector('.reply-box textarea');
  const message = textarea.value.trim();

  if (!message) return toast('Write a message first.');

  try {
    const res = await fetch(`${API_BASE_URL}/api/modmail/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: activeUserId, message }),
    });

    if (res.ok) {
      toast('Reply sent to Discord DM');
      textarea.value = '';
      loadModmailThreads();
    } else {
      const err = await res.json();
      toast(`Error: ${err.error}`);
    }
  } catch {
    toast('Failed to send reply.');
  }
});

// Poll for incoming messages every 4 seconds
setInterval(loadModmailThreads, 4000);
loadModmailThreads();
