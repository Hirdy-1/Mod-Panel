const API_BASE_URL = window.location.origin;

// Auth Verification Flow
async function checkAuth() {
  const res = await fetch(`${API_BASE_URL}/api/auth/me`);
  const data = await res.json();
  if (data.authenticated) {
    document.getElementById('authScreen').classList.remove('show');
    document.getElementById('appShell').style.display = 'flex';
    document.getElementById('userTag').textContent = `@${data.user.username}`;
    initDashboard();
  } else {
    document.getElementById('authScreen').classList.add('show');
    document.getElementById('appShell').style.display = 'none';
  }
}

document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  await fetch(`${API_BASE_URL}/api/auth/logout`, { method: 'POST' });
  location.reload();
});

function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// 1. Fetch & Render Member Roster with Quick Action Buttons
async function loadMembers() {
  const table = document.getElementById('membersTable');
  if (!table) return;

  const res = await fetch(`${API_BASE_URL}/api/members`);
  if (!res.ok) return;
  const members = await res.json();

  table.innerHTML = members.map(m => `
    <tr>
      <td style="display:flex; align-items:center; gap:8px;">
        <img src="${m.avatar}" style="width:28px; height:28px; border-radius:50%;" />
        <div><b>${m.username}</b><br><small style="color:#8b94a7;">ID: ${m.id}</small></div>
      </td>
      <td>${m.roles.map(r => `<span class="pill" style="background:${r.color}22; color:${r.color};">${r.name}</span>`).join(' ')}</td>
      <td><small>${m.joinedAt}</small></td>
      <td><b>${m.warnings}</b></td>
      <td>
        <button class="secondary-btn" onclick="quickAction('Timeout member', '${m.id}')">Timeout</button>
        <button class="secondary-btn" onclick="quickAction('Kick member', '${m.id}')">Kick</button>
        <button class="danger-btn" onclick="quickAction('Ban member', '${m.id}')">Ban</button>
      </td>
    </tr>
  `).join('');
}

async function quickAction(action, userId) {
  const reason = prompt(`Reason for ${action}:`);
  if (!reason) return;

  let durationMinutes = 10;
  if (action === 'Timeout member') {
    durationMinutes = prompt('Timeout duration in minutes:', '10') || 10;
  }

  const res = await fetch(`${API_BASE_URL}/api/moderate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, userId, reason, durationMinutes }),
  });
  const data = await res.json();
  toast(res.ok ? data.message : `Error: ${data.error}`);
  loadMembers();
}

// 2. Load & Save Auto-Mod Settings
async function loadSettings() {
  const res = await fetch(`${API_BASE_URL}/api/settings`);
  if (!res.ok) return;
  const s = await res.json();

  document.getElementById('antiInviteToggle').checked = s.antiInvite;
  document.getElementById('antiSpamToggle').checked = s.antiSpam;
  document.getElementById('maxWarnsInput').value = s.maxWarningsBeforeBan;
  document.getElementById('bannedWordsInput').value = s.bannedWords.join(', ');
}

document.getElementById('saveSettingsBtn')?.addEventListener('click', async () => {
  const payload = {
    antiInvite: document.getElementById('antiInviteToggle').checked,
    antiSpam: document.getElementById('antiSpamToggle').checked,
    maxWarningsBeforeBan: document.getElementById('maxWarnsInput').value,
    bannedWords: document.getElementById('bannedWordsInput').value.split(',').map(w => w.trim()).filter(Boolean)
  };

  const res = await fetch(`${API_BASE_URL}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.ok) toast('Auto-Mod configuration saved.');
});

// 3. Broadcast Announcement
document.getElementById('sendBroadcastBtn')?.addEventListener('click', async () => {
  const channelId = document.getElementById('broadcastChannel').value.trim();
  const title = document.getElementById('broadcastTitle').value.trim();
  const message = document.getElementById('broadcastBody').value.trim();

  const res = await fetch(`${API_BASE_URL}/api/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId, title, message }),
  });
  const data = await res.json();
  toast(res.ok ? data.message : `Error: ${data.error}`);
});

// 4. Issue Direct Warning DM
document.getElementById('sendWarnBtn')?.addEventListener('click', async () => {
  const userId = document.getElementById('warnUserId').value.trim();
  const reason = document.getElementById('warnReason').value.trim();

  const res = await fetch(`${API_BASE_URL}/api/warn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, reason }),
  });
  const data = await res.json();
  toast(res.ok ? data.message : `Error: ${data.error}`);
});

// Navigation Tabs
const navItems = document.querySelectorAll('[data-section]');
navItems.forEach(item => item.addEventListener('click', e => {
  e.preventDefault();
  const target = item.dataset.section;
  document.querySelectorAll('.page-section').forEach(s => s.classList.toggle('active', s.id === target));
  navItems.forEach(n => n.classList.toggle('active', n.dataset.section === target));
}));

function initDashboard() {
  loadMembers();
  loadSettings();
}

checkAuth();
