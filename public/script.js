const API_BASE_URL = '';

document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  setupNavigation();
  initDashboard();
  setupEventListeners();
});

// --- AUTHENTICATION STATE ---
async function checkAuth() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/me`);
    const data = await res.json();
    
    if (data.authenticated) {
      document.getElementById('authScreen').classList.remove('show');
      document.getElementById('appShell').style.display = 'flex';
      document.getElementById('userTag').textContent = `@${data.user.username}`;
    } else {
      document.getElementById('authScreen').classList.add('show');
      document.getElementById('appShell').style.display = 'none';
    }
  } catch (err) {
    console.error('Auth check failed:', err);
  }
}

// --- NAVIGATION ROUTING ---
function setupNavigation() {
  const links = document.querySelectorAll('sidebar nav a');
  links.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      links.forEach(l => l.classList.remove('active'));
      link.classList.add('active');

      const targetId = link.getAttribute('data-section');
      document.querySelectorAll('.page-section').forEach(sec => sec.classList.remove('active'));
      document.getElementById(targetId).classList.add('active');
      document.getElementById('pageName').textContent = link.textContent;
    });
  });
}

// --- DATA FETCHING & INITIALIZATION ---
function initDashboard() {
  loadStats();
  loadMembers();
  loadBans();
  loadSettings();
  loadLogs();

  // Auto-refresh bans, stats, and logs every 10 seconds
  setInterval(() => {
    loadStats();
    loadBans();
    loadLogs();
  }, 10000);
}

async function loadStats() {
  const res = await fetch(`${API_BASE_URL}/api/stats`);
  if (!res.ok) return;
  const data = await res.json();

  document.getElementById('statTotalMembers').textContent = data.totalMembers;
  document.getElementById('statOnlineMembers').textContent = data.onlineMembers;
  document.getElementById('statTotalBans').textContent = data.totalBans;
}

async function loadMembers() {
  const res = await fetch(`${API_BASE_URL}/api/members`);
  if (!res.ok) return;
  const members = await res.json();

  const table = document.getElementById('membersTable');
  table.innerHTML = members.map(m => `
    <tr>
      <td style="display:flex; align-items:center; gap:10px;">
        <img src="${m.avatar}" style="width:32px; height:32px; border-radius:50%;" />
        <div>
          <b>${m.username}</b><br>
          <small style="color:var(--muted)">ID: ${m.id}</small>
        </div>
      </td>
      <td>
        ${m.roles.map(r => `<span class="pill" style="border: 1px solid ${r.color || '#444'}; color:${r.color || '#ccc'}">${r.name}</span>`).join(' ')}
      </td>
      <td>${m.joinedAt}</td>
      <td><span class="pill" style="background:${m.warnings > 0 ? 'var(--danger)' : '#2b3040'}">${m.warnings} Warns</span></td>
      <td>
        <button class="secondary-btn" onclick="moderateUser('${m.id}', 'Timeout member')">Timeout</button>
        <button class="secondary-btn" onclick="moderateUser('${m.id}', 'Kick member')">Kick</button>
        <button class="danger-btn" onclick="moderateUser('${m.id}', 'Ban member')">Ban</button>
      </td>
    </tr>
  `).join('');
}

// --- LIVE DISCORD BAN LIST & UNBAN HANDLERS ---
async function loadBans() {
  const table = document.getElementById('bansTable');
  if (!table) return;

  const res = await fetch(`${API_BASE_URL}/api/bans`);
  if (!res.ok) return;
  const bans = await res.json();

  if (bans.length === 0) {
    table.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--muted);">No active bans found on Discord.</td></tr>`;
    return;
  }

  table.innerHTML = bans.map(b => `
    <tr>
      <td style="display:flex; align-items:center; gap:8px;">
        <img src="${b.avatar}" style="width:28px; height:28px; border-radius:50%;" />
        <div><b>${b.username}</b><br><small style="color:var(--muted);">ID: ${b.id}</small></div>
      </td>
      <td>${b.reason}</td>
      <td>
        <button class="secondary-btn" onclick="unbanUser('${b.id}')">Unban User</button>
      </td>
    </tr>
  `).join('');
}

async function unbanUser(userId) {
  const reason = prompt('Reason for unbanning this user:');
  if (!reason) return;

  const res = await fetch(`${API_BASE_URL}/api/unban`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, reason }),
  });

  const data = await res.json();
  toast(res.ok ? data.message : `Error: ${data.error}`);
  
  loadBans();
  loadStats();
}

async function moderateUser(userId, action) {
  let reason = prompt(`Enter reason for action (${action}):`);
  if (!reason) return;

  let durationMinutes = 10;
  if (action === 'Timeout member') {
    let durInput = prompt('Enter timeout duration in minutes:', '10');
    if (!durInput) return;
    durationMinutes = parseInt(durInput, 10);
  }

  const res = await fetch(`${API_BASE_URL}/api/moderate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, userId, reason, durationMinutes })
  });

  const data = await res.json();
  toast(res.ok ? data.message : `Error: ${data.error}`);
  loadMembers();
  loadBans();
  loadStats();
}

async function loadSettings() {
  const res = await fetch(`${API_BASE_URL}/api/settings`);
  if (!res.ok) return;
  const s = await res.json();

  document.getElementById('antiInviteToggle').checked = s.antiInvite;
  document.getElementById('antiSpamToggle').checked = s.antiSpam;
  document.getElementById('maxWarnsInput').value = s.maxWarningsBeforeBan;
  document.getElementById('bannedWordsInput').value = s.bannedWords.join(', ');
}

async function loadLogs() {
  const actRes = await fetch(`${API_BASE_URL}/api/action-history`);
  if (actRes.ok) {
    const actions = await actRes.json();
    document.getElementById('actionLogsTable').innerHTML = actions.map(a => `
      <tr>
        <td>${a.timestamp}</td>
        <td><span class="pill" style="background:var(--accent);">${a.type}</span></td>
        <td>${a.target}</td>
        <td>${a.reason}</td>
      </tr>
    `).join('');
  }

  const chatRes = await fetch(`${API_BASE_URL}/api/logs`);
  if (chatRes.ok) {
    const chats = await chatRes.json();
    document.getElementById('logsTable').innerHTML = chats.map(c => `
      <tr>
        <td>${c.timestamp}</td>
        <td><b>${c.user}</b></td>
        <td style="color:var(--muted);">${c.channel}</td>
        <td>${c.content}</td>
      </tr>
    `).join('');
  }
}

// --- EVENT LISTENERS & UI HELPERS ---
function setupEventListeners() {
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch(`${API_BASE_URL}/api/auth/logout`, { method: 'POST' });
    window.location.href = '/';
  });

  document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    const payload = {
      antiInvite: document.getElementById('antiInviteToggle').checked,
      antiSpam: document.getElementById('antiSpamToggle').checked,
      maxWarningsBeforeBan: parseInt(document.getElementById('maxWarnsInput').value, 10),
      bannedWords: document.getElementById('bannedWordsInput').value.split(',').map(w => w.trim()).filter(Boolean)
    };

    const res = await fetch(`${API_BASE_URL}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    toast(res.ok ? 'Settings saved successfully!' : 'Failed to save settings.');
  });

  document.getElementById('sendBroadcastBtn').addEventListener('click', async () => {
    const channelId = document.getElementById('broadcastChannel').value.trim();
    const title = document.getElementById('broadcastTitle').value.trim();
    const message = document.getElementById('broadcastBody').value.trim();

    const res = await fetch(`${API_BASE_URL}/api/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, title, message })
    });

    const data = await res.json();
    toast(res.ok ? data.message : `Error: ${data.error}`);
  });

  document.getElementById('sendWarnBtn').addEventListener('click', async () => {
    const userId = document.getElementById('warnUserId').value.trim();
    const reason = document.getElementById('warnReason').value.trim();

    const res = await fetch(`${API_BASE_URL}/api/warn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, reason })
    });

    const data = await res.json();
    toast(res.ok ? data.message : `Error: ${data.error}`);
  });
}

function toast(text) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}
