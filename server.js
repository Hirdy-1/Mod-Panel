import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField } from 'discord.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// CONFIGURATION (Set via Environment Variables in Render/Hosting)
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const GUILD_ID = process.env.GUILD_ID;
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/api/auth/callback`;
const ADMIN_ROLE_IDS = (process.env.ADMIN_ROLE_IDS || '').split(',').filter(Boolean);
const MOD_ROLE_IDS = (process.env.MOD_ROLE_IDS || '').split(',').filter(Boolean);

// IN-MEMORY STORAGE (Replace with DB for permanent storage)
let botSettings = {
  antiInvite: true,
  antiSpam: false,
  maxWarns: 3,
  bannedWords: ['scamlink', 'freevxbucks']
};

let userWarnings = {}; // { userId: count }
let actionLogs = [];
let realTimeLogs = [];
let banAppeals = [];   // Array of { id, userId, username, reason, status: 'Pending'|'Approved'|'Denied', date }

// DISCORD CLIENT INITIALIZATION
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

client.once('ready', () => {
  console.log(`[BOT ONLINE] Logged in as ${client.user.tag}`);
});

// DISCORD MESSAGE MONITORING
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || message.guild.id !== GUILD_ID) return;

  // Real-time Chat Feed Logging
  realTimeLogs.unshift({
    timestamp: new Date().toLocaleTimeString(),
    username: message.author.tag,
    channel: `#${message.channel.name}`,
    content: message.content
  });
  if (realTimeLogs.length > 50) realTimeLogs.pop();

  // Security Shields: Anti-Invite
  if (botSettings.antiInvite && /(discord\.gg|discord\.com\/invite)/i.test(message.content)) {
    await message.delete().catch(() => {});
    await issueWarning(message.author.id, message.member, 'Sent prohibited invite link');
    return;
  }

  // Security Shields: Banned Vocabulary
  const contentLower = message.content.toLowerCase();
  const hasBannedWord = botSettings.bannedWords.some(word => word && contentLower.includes(word.toLowerCase()));
  if (hasBannedWord) {
    await message.delete().catch(() => {});
    await issueWarning(message.author.id, message.member, 'Used banned vocabulary');
  }
});

async function issueWarning(userId, member, reason) {
  userWarnings[userId] = (userWarnings[userId] || 0) + 1;
  const count = userWarnings[userId];

  logAction('WARN', userId, `Auto-Warn (${count}/${botSettings.maxWarns}): ${reason}`);

  if (count >= botSettings.maxWarns && member) {
    try {
      await member.ban({ reason: `Exceeded warning threshold (${botSettings.maxWarns})` });
      logAction('AUTO-BAN', userId, `Exceeded maximum warning limit`);
      userWarnings[userId] = 0;
    } catch (err) {
      console.error('Failed to auto-ban user:', err);
    }
  }
}

function logAction(action, target, reason) {
  actionLogs.unshift({
    timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
    action,
    target,
    reason
  });
  if (actionLogs.length > 100) actionLogs.pop();
}

// EXPRESS MIDDLEWARE
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'sentinel_secret_key_123',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
  })
);

// AUTHENTICATION MIDDLEWARES
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function requireStaffRole(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  const { roles } = req.session.user;
  const isStaff = roles.some(r => ADMIN_ROLE_IDS.includes(r) || MOD_ROLE_IDS.includes(r));
  if (!isStaff) return res.status(403).json({ error: 'Forbidden: Staff Role Required' });
  next();
}

// OAUTH2 AUTH ROUTES
app.get('/api/auth/login', (req, res) => {
  const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&response_type=code&scope=identify%20guilds.members.read`;
  res.redirect(url);
});

app.get('/api/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code provided.');

  try {
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const tokens = await tokenResponse.json();

    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { authorization: `${tokens.token_type} ${tokens.access_token}` }
    });
    const userData = await userResponse.json();

    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(userData.id).catch(() => null);

    if (!member) {
      return res.status(403).send('You must be a member of the target guild to log in.');
    }

    const memberRoles = member.roles.cache.map(r => r.id);
    const isAdmin = memberRoles.some(r => ADMIN_ROLE_IDS.includes(r)) || member.permissions.has(PermissionsBitField.Flags.Administrator);
    const isMod = memberRoles.some(r => MOD_ROLE_IDS.includes(r));

    if (!isAdmin && !isMod) {
      return res.status(403).send('Access Denied: Missing required Staff roles.');
    }

    req.session.user = {
      id: userData.id,
      username: `${userData.username}#${userData.discriminator || '0'}`,
      avatar: userData.avatar,
      roles: memberRoles,
      roleName: isAdmin ? 'Admin' : 'Moderator'
    };

    res.redirect('/');
  } catch (err) {
    console.error('OAuth Error:', err);
    res.status(500).send('Authentication failed.');
  }
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, user: req.session.user });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// REST API ENDPOINTS
app.get('/api/stats', requireStaffRole, async (req, res) => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const bans = await guild.bans.fetch();
    res.json({
      totalMembers: guild.memberCount,
      onlineMembers: guild.members.cache.filter(m => m.presence?.status && m.presence.status !== 'offline').size,
      totalBans: bans.size,
      actionLogs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/members', requireStaffRole, async (req, res) => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const members = await guild.members.fetch();
    const data = members.map(m => ({
      id: m.id,
      tag: m.user.tag,
      roles: m.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name),
      joinedAt: m.joinedAt ? m.joinedAt.toISOString().split('T')[0] : 'Unknown',
      warnings: userWarnings[m.id] || 0
    }));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/members/:id/moderate', requireStaffRole, async (req, res) => {
  const { action, reason, duration, proofUrl } = req.body;
  const userId = req.params.id;

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(userId).catch(() => null);

    const logReason = `${reason || 'No reason specified'}${proofUrl ? ` | Proof: ${proofUrl}` : ''}`;

    if (action === 'warn') {
      await issueWarning(userId, member, logReason);
    } else if (action === 'timeout') {
      if (!member) return res.status(404).json({ error: 'Member not found in guild.' });
      const ms = (duration || 10) * 60 * 1000;
      await member.timeout(ms, logReason);
      logAction('TIMEOUT', userId, `Duration: ${duration}m | ${logReason}`);
    } else if (action === 'kick') {
      if (!member) return res.status(404).json({ error: 'Member not found in guild.' });
      await member.kick(logReason);
      logAction('KICK', userId, logReason);
    } else if (action === 'ban') {
      await guild.bans.create(userId, { reason: logReason });
      logAction('BAN', userId, logReason);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bans', requireStaffRole, async (req, res) => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const bans = await guild.bans.fetch();
    const data = bans.map(b => ({
      id: b.user.id,
      tag: b.user.tag,
      reason: b.reason || 'No reason provided'
    }));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bans/unban', requireStaffRole, async (req, res) => {
  const { userIds } = req.body;
  if (!Array.isArray(userIds)) return res.status(400).json({ error: 'Invalid userIds array' });

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    for (const id of userIds) {
      await guild.bans.remove(id, `Bulk unban requested by ${req.session.user.username}`);
      logAction('UNBAN', id, 'Bulk Unban Executed');
    }
    res.json({ success: true, count: userIds.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/appeals', requireStaffRole, (req, res) => {
  res.json(banAppeals);
});

app.post('/api/appeals/:id/review', requireStaffRole, async (req, res) => {
  const { id } = req.params;
  const { decision } = req.body; // 'approve' | 'deny'

  const appeal = banAppeals.find(a => a.id === id);
  if (!appeal) return res.status(404).json({ error: 'Appeal not found' });

  appeal.status = decision === 'approve' ? 'Approved' : 'Denied';

  if (decision === 'approve') {
    try {
      const guild = await client.guilds.fetch(GUILD_ID);
      await guild.bans.remove(appeal.userId, 'Ban appeal approved');
      logAction('UNBAN', appeal.userId, 'Ban Appeal Approved');
    } catch (err) {
      console.error('Failed to unban on approved appeal:', err);
    }
  }

  res.json({ success: true, appeal });
});

// PUBLIC APPEAL SUBMISSION
app.post('/api/public/appeal', async (req, res) => {
  const { userId, username, statement } = req.body;
  if (!userId || !statement) return res.status(400).json({ error: 'User ID and statement are required.' });

  const newAppeal = {
    id: `app_${Date.now()}`,
    userId,
    username: username || 'Unknown User',
    statement,
    status: 'Pending',
    date: new Date().toISOString().split('T')[0]
  };

  banAppeals.unshift(newAppeal);
  res.json({ success: true, message: 'Appeal submitted successfully.' });
});

app.post('/api/broadcast', requireStaffRole, async (req, res) => {
  const { channelId, title, message } = req.body;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return res.status(400).json({ error: 'Invalid channel' });

    const embed = new EmbedBuilder()
      .setTitle(title || 'Announcement')
      .setDescription(message)
      .setColor(0x635bff)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    logAction('ANNOUNCEMENT', `#${channel.name}`, title);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs', requireStaffRole, (req, res) => {
  res.json(realTimeLogs);
});

app.get('/api/settings', requireStaffRole, (req, res) => {
  res.json(botSettings);
});

app.post('/api/settings', requireStaffRole, (req, res) => {
  const { antiInvite, antiSpam, maxWarns, bannedWords } = req.body;
  botSettings = {
    antiInvite: Boolean(antiInvite),
    antiSpam: Boolean(antiSpam),
    maxWarns: Number(maxWarns) || 3,
    bannedWords: Array.isArray(bannedWords) ? bannedWords : []
  };
  logAction('SETTINGS_UPDATE', 'System', 'Automated security shields updated');
  res.json({ success: true, settings: botSettings });
});

client.login(DISCORD_BOT_TOKEN);

app.listen(PORT, () => {
  console.log(`[SERVER ONLINE] Dashboard running on port ${PORT}`);
});
