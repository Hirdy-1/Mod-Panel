const API_BASE_URL = window.location.origin;

let currentModmailThreads = [];
let activeUserId = null;

// Routing logic
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

// Toast Notification
function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// Modal controls
const modal = document.getElementById('actionModal');
document.querySelectorAll('[data-open-modal="actionModal"]').forEach(b => b.addEventListener('click', () => modal.classList.add('show')));
document.querySelectorAll('.close-modal').forEach(b => b.addEventListener('click', () => modal.classList.remove('show')));

// --- 1. MODERATION ACTIONS (BAN / KICK) ---
document.getElementById('confirmAction')?.addEventListener('click', async () => {
  const userId = document.getElementById('memberInput').value.trim();
  const reason = document.getElementById('reasonInput').value.trim();
  const action = document.getElementById('actionType').value;

  if (!userId || !reason) return toast('Please enter a User ID and Reason.');

  try {
    const res = await fetch(`${API_BASE_URL}/api/moderate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, userId, reason }),
    });
    const result = await res.json();
    
    if (res.ok) {
      toast(result.message);
      modal.classList.remove('show');
      document.getElementById('memberInput').value = '';
      document.getElementById('reasonInput').value = '';
    } else {
      toast(`Error: ${result.error}`);
    }
  } catch {
    toast('Network error executing moderation action.');
  }
});

// --- 2. LIVE CHAT LOGS ---
async function loadChatLogs() {
  const tableBody = document.getElementById('logsTable');
  if (!tableBody) return;

  try {
    const res = await fetch(`${API_BASE_URL}/api/logs`);
    if (!res.ok) return;
    const logs = await res.json();

    if (logs.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#8b94a7;">No recent messages logged yet. Send a message in Discord!</td></tr>';
      return;
    }

    const searchVal = (document.getElementById('logSearch')?.value || '').toLowerCase();
    const filtered = logs.filter(l => l.user.toLowerCase().includes(searchVal) || l.content.toLowerCase().includes(searchVal));

    tableBody.innerHTML = filtered.map(log => `
      <tr>
        <td style="display:flex; align-items:center; gap:8px;">
          <img src="${log.avatar}" style="width:24px; height:24px; border-radius:50%;" />
          <b>${log.user}</b>
        </td>
        <td class="channel">${log.channel}</td>
        <td>${log.content}</td>
        <td><small>${log.timestamp}</small></td>
      </tr>
    `).join('');
  } catch (e) {
    console.error('Error fetching logs:', e);
  }
}

document.getElementById('logSearch')?.addEventListener('input', loadChatLogs);

// --- 3. DISCORD MODMAIL SYSTEM ---
async function loadModmailThreads() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/modmail`);
    if (!res.ok) return;
    currentModmailThreads = await res.json();
    renderModmailList(currentModmailThreads);
    if (activeUserId) selectThread(activeUserId);
  } catch (e) {
    console.error('Error loading modmail:', e);
  }
}

function renderModmailList(threads) {
  const container = document.getElementById('modmailList');
  if (!container) return;

  if (threads.length === 0) {
    container.innerHTML = '<div style="padding: 20px; color: #8b94a7; text-align:center;">No active DM threads</div>';
    return;
  }

  container.innerHTML = threads.map(t => `
    <div class="mail-item ${t.userId === activeUserId ? 'selected' : ''}" data-userid="${t.userId}">
      <img src="${t.avatar}" style="width:31px; height:31px; border-radius:50%;" />
      <div>
        <b>${t.username}</b>
        <p>${t.lastMessage ? t.lastMessage.content : ''}</p>
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
      <span class="muted">User ID: ${thread.userId}</span>
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
  if (!activeUserId) return toast('Select a thread to reply.');
  const textarea = document.querySelector('.reply-box textarea');
  const message = textarea.value.trim();

  if (!message) return toast('Enter a message first.');

  try {
    const res = await fetch(`${API_BASE_URL}/api/modmail/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: activeUserId, message }),
    });

    const data = await res.json();
    if (res.ok) {
      toast('Reply delivered to user DM');
      textarea.value = '';
      loadModmailThreads();
    } else {
      toast(`Error: ${data.error}`);
    }
  } catch {
    toast('Failed to send reply.');
  }
});

// Setup Polling (Updates chat & modmail every 3 seconds)
setInterval(() => {
  loadModmailThreads();
  loadChatLogs();
}, 3000);

// Initial Load
loadModmailThreads();
loadChatLogs();
