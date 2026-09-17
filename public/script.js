document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  setupNavigation();
  setupFormHandlers();

  try {
    const authRes = await fetch('/api/auth/me');
    const authData = await authRes.json();

    if (authData.authenticated) {
      document.getElementById('authScreen').classList.remove('show');
      document.getElementById('appShell').style.display = 'flex';
      
      document.getElementById('userTag').textContent = authData.user.username;
      const roleBadge = document.getElementById('userRoleBadge');
      roleBadge.textContent = authData.user.roleName || 'Staff';
      if (authData.user.roleName === 'Admin') {
        roleBadge.style.background = '#e63946';
      } else {
        roleBadge.style.background = '#635bff';
      }

      loadDashboardData();
    } else {
      document.getElementById('authScreen').classList.add('show');
      document.getElementById('appShell').style.display = 'none';
    }
  } catch (err) {
    showToast('Failed to check authentication status.', true);
  }
}

function setupNavigation() {
  const navLinks = document.querySelectorAll('nav a');
  const sections = document.querySelectorAll('.page-section');
  const pageNameHeader = document.getElementById('pageName');

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetSection = link.getAttribute('data-section');

      navLinks.forEach(l => l.classList.remove('active'));
      sections.forEach(s => s.classList.remove('active'));

      link.classList.add('active');
      document.getElementById(targetSection).classList.add('active');
      pageNameHeader.textContent = link.textContent;

      refreshSectionData(targetSection);
    });
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.reload();
  });
}

function refreshSectionData(sectionId) {
  switch (sectionId) {
    case 'secDashboard':
      loadDashboardData();
      break;
    case 'secMembers':
      loadMembersData();
      break;
    case 'secBans':
      loadBansData();
      break;
    case 'secAppeals':
      loadAppealsData();
      break;
    case 'secLogs':
      loadLogsData();
      break;
    case 'secSettings':
      loadSettingsData();
      break;
  }
}

async function loadDashboardData() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();

    document.getElementById('statTotalMembers').textContent = data.totalMembers || 0;
    document.getElementById('statOnlineMembers').textContent = data.onlineMembers || 0;
    document.getElementById('statTotalBans').textContent = data.totalBans || 0;

    const tbody = document.getElementById('actionLogsTable');
    tbody.innerHTML = '';
    (data.actionLogs || []).forEach(log => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${log.timestamp}</td>
        <td><span class="pill" style="background: rgba(99, 91, 255, 0.2); color: #635bff;">${log.action}</span></td>
        <td>${log.target}</td>
        <td>${log.reason}</td>
      `;
      tbody.appendChild(row);
    });
  } catch (err) {
    showToast('Error loading stats', true);
  }
}

async function loadMembersData() {
  try {
    const res = await fetch('/api/members');
    const members = await res.json();

    const tbody = document.getElementById('membersTable');
    tbody.innerHTML = '';
    members.forEach(m => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><b>${m.tag}</b><br><small style="color: var(--muted);">${m.id}</small></td>
        <td>${m.roles.map(r => `<span class="pill" style="background: #282d3c;">${r}</span>`).join(' ')}</td>
        <td>${m.joinedAt}</td>
        <td><span class="pill" style="background: ${m.warnings > 0 ? 'var(--danger)' : 'var(--border)'}">${m.warnings}</span></td>
        <td>
          <button class="secondary-btn" onclick="promptModerate('${m.id}', 'warn')">Warn</button>
          <button class="secondary-btn" onclick="promptModerate('${m.id}', 'timeout')">Mute</button>
          <button class="danger-btn" onclick="promptModerate('${m.id}', 'kick')">Kick</button>
          <button class="danger-btn" onclick="promptModerate('${m.id}', 'ban')">Ban</button>
        </td>
      `;
      tbody.appendChild(row);
    });
  } catch (err) {
    showToast('Failed to load server members', true);
  }
}

async function promptModerate(userId, action) {
  const reason = prompt(`Reason for ${action.toUpperCase()} on ID ${userId}:`);
  if (reason === null) return;

  let duration = null;
  if (action === 'timeout') {
    duration = prompt('Timeout duration in minutes:', '10');
    if (!duration) return;
  }

  const proofUrl = prompt('Proof attachment URL (Optional):', '');

  try {
    const res = await fetch(`/api/members/${userId}/moderate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason, duration, proofUrl })
    });
    const result = await res.json();
    if (res.ok) {
      showToast(`Action ${action.toUpperCase()} successfully applied.`);
      loadMembersData();
    } else {
      showToast(result.error || 'Action failed.', true);
    }
  } catch (err) {
    showToast('Failed to issue moderation action.', true);
  }
}

async function loadBansData() {
  try {
    const res = await fetch('/api/bans');
    const bans = await res.json();

    const tbody = document.getElementById('bansTable');
    tbody.innerHTML = '';
    bans.forEach(b => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><input type="checkbox" class="ban-checkbox" value="${b.id}"></td>
        <td><b>${b.tag}</b><br><small style="color: var(--muted);">${b.id}</small></td>
        <td>${b.reason}</td>
        <td><button class="secondary-btn" onclick="executeSingleUnban('${b.id}')">Unban</button></td>
      `;
      tbody.appendChild(row);
    });
  } catch (err) {
    showToast('Failed to load bans list', true);
  }
}

function toggleSelectAllBans(masterCheckbox) {
  const checkboxes = document.querySelectorAll('.ban-checkbox');
  checkboxes.forEach(cb => cb.checked = masterCheckbox.checked);
}

async function executeSingleUnban(userId) {
  if (!confirm(`Unban user ID ${userId}?`)) return;
  await sendUnbanRequest([userId]);
}

async function executeBatchUnban() {
  const selected = Array.from(document.querySelectorAll('.ban-checkbox:checked')).map(cb => cb.value);
  if (selected.length === 0) {
    return showToast('No banned users selected.', true);
  }
  if (!confirm(`Unban ${selected.length} selected user(s)?`)) return;
  await sendUnbanRequest(selected);
}

async function sendUnbanRequest(userIds) {
  try {
    const res = await fetch('/api/bans/unban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds })
    });
    if (res.ok) {
      showToast('Unban request processed.');
      loadBansData();
    } else {
      showToast('Failed to process unbans.', true);
    }
  } catch (err) {
    showToast('Network error on unban request.', true);
  }
}

async function loadAppealsData() {
  try {
    const res = await fetch('/api/appeals');
    const appeals = await res.json();

    const tbody = document.getElementById('appealsTable');
    tbody.innerHTML = '';
    appeals.forEach(app => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${app.date}</td>
        <td><b>${app.username}</b><br><small style="color: var(--muted);">${app.userId}</small></td>
        <td>${app.statement}</td>
        <td><span class="pill" style="background: ${app.status === 'Approved' ? 'var(--success)' : app.status === 'Denied' ? 'var(--danger)' : 'var(--warning)'}; color: black;">${app.status}</span></td>
        <td>
          ${app.status === 'Pending' ? `
            <button class="primary-btn" onclick="reviewAppeal('${app.id}', 'approve')">Approve</button>
            <button class="danger-btn" onclick="reviewAppeal('${app.id}', 'deny')">Deny</button>
          ` : 'Reviewed'}
        </td>
      `;
      tbody.appendChild(row);
    });
  } catch (err) {
    showToast('Failed to load ban appeals.', true);
  }
}

async function reviewAppeal(appealId, decision) {
  try {
    const res = await fetch(`/api/appeals/${appealId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision })
    });
    if (res.ok) {
      showToast(`Appeal ${decision.toUpperCase()}D successfully.`);
      loadAppealsData();
    } else {
      showToast('Failed to review appeal.', true);
    }
  } catch (err) {
    showToast('Network error reviewing appeal.', true);
  }
}

function setupFormHandlers() {
  document.getElementById('sendBroadcastBtn').addEventListener('click', async () => {
    const channelId = document.getElementById('broadcastChannel').value;
    const title = document.getElementById('broadcastTitle').value;
    const message = document.getElementById('broadcastBody').value;

    if (!channelId || !message) {
      return showToast('Channel ID and Message Body are required.', true);
    }

    try {
      const res = await fetch('/api/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, title, message })
      });
      if (res.ok) {
        showToast('Announcement broadcasted successfully!');
        document.getElementById('broadcastTitle').value = '';
        document.getElementById('broadcastBody').value = '';
      } else {
        showToast('Failed to send broadcast.', true);
      }
    } catch (err) {
      showToast('Error broadcasting message.', true);
    }
  });

  document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    const antiInvite = document.getElementById('antiInviteToggle').checked;
    const antiSpam = document.getElementById('antiSpamToggle').checked;
    const maxWarns = document.getElementById('maxWarnsInput').value;
    const bannedWords = document.getElementById('bannedWordsInput').value.split(',').map(s => s.trim()).filter(Boolean);

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ antiInvite, antiSpam, maxWarns, bannedWords })
      });
      if (res.ok) {
        showToast('Bot security settings updated.');
      } else {
        showToast('Failed to update settings.', true);
      }
    } catch (err) {
      showToast('Error updating settings.', true);
    }
  });

  document.getElementById('publicAppealForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = document.getElementById('appealUserId').value;
    const username = document.getElementById('appealUsername').value;
    const statement = document.getElementById('appealStatement').value;

    try {
      const res = await fetch('/api/public/appeal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, username, statement })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        document.getElementById('publicAppealForm').reset();
      } else {
        alert(data.error || 'Failed to submit appeal.');
      }
    } catch (err) {
      alert('Network error submitting appeal.');
    }
  });
}

async function loadLogsData() {
  try {
    const res = await fetch('/api/logs');
    const logs = await res.json();

    const tbody = document.getElementById('logsTable');
    tbody.innerHTML = '';
    logs.forEach(l => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${l.timestamp}</td>
        <td><b>${l.username}</b></td>
        <td><span class="pill" style="background: #282d3c;">${l.channel}</span></td>
        <td>${l.content}</td>
      `;
      tbody.appendChild(row);
    });
  } catch (err) {
    showToast('Failed to load chat feed', true);
  }
}

async function loadSettingsData() {
  try {
    const res = await fetch('/api/settings');
    const settings = await res.json();

    document.getElementById('antiInviteToggle').checked = settings.antiInvite;
    document.getElementById('antiSpamToggle').checked = settings.antiSpam;
    document.getElementById('maxWarnsInput').value = settings.maxWarns;
    document.getElementById('bannedWordsInput').value = (settings.bannedWords || []).join(', ');
  } catch (err) {
    showToast('Failed to load settings', true);
  }
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.borderColor = isError ? 'var(--danger)' : 'var(--accent)';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}
