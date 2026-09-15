const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'sentinel-super-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set to true if using HTTPS on production
}));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const GUILD_ID = process.env.GUILD_ID;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3000/api/auth/callback';

// Dynamic Auto-Mod & Config Settings
const botSettings = {
  bannedWords: ['badword1', 'scamlink'],
  antiInvite: true,
  antiSpam: true,
  maxWarningsBeforeBan: 3,
};

// In-Memory Data Stores
const modmailThreads = new Map();
const chatLogs = [];
const actionLogs = [];
const userWarnings = new Map(); // Tracks warning count per user ID
const userSpamCache = new Map(); // Tracks message timestamps per user

// Auth Middleware
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized. Please login.' });
  next();
}

// --- DISCORD AUTO-MOD & SPAM ENGINE ---
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || message.guild.id !== GUILD_ID) return;

  const content = message.content;
  const userId = message.author.id;
  const member = message.member;

  // 1. Anti-Invite Filter
  if (botSettings.antiInvite && /(discord\.gg|discord\.com\/invite)\//i.test(content)) {
    await message.delete().catch(() => {});
    await issueWarning(member, 'Posting Discord Invite Links');
    return;
  }

  // 2. Banned Words Filter
  const containsBanned = botSettings.bannedWords.some(word => 
    content.toLowerCase().includes(word.toLowerCase())
  );
  if (containsBanned) {
    await message.delete().catch(() => {});
    await issueWarning(member, 'Using Banned Vocabulary');
    return;
  }

  // 3. Anti-Spam Filter (5 messages within 3 seconds)
  if (botSettings.antiSpam) {
    const now = Date.now();
    const timestamps = userSpamCache.get(userId) || [];
    timestamps.push(now);
    const recent = timestamps.filter(t => now - t < 3000);
    userSpamCache.set(userId, recent);

    if (recent.length >= 5) {
      await message.delete().catch(() => {});
      userSpamCache.set(userId, []);
      await issueWarning(member, 'Rapid Message Spamming');
      return;
    }
  }

  // Normal Chat Logging
  chatLogs.unshift({
    id: message.id,
    user: message.author.tag,
    avatar: message.author.displayAvatarURL({ extension: 'png' }),
    channel: `#${message.channel.name}`,
    content: content || '[Media/Embed]',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  });
  if (chatLogs.length > 100) chatLogs.pop();
});

// Helper Function: Issue Warnings & Trigger Auto-Actions
async function issueWarning(member, reason) {
  const userId = member.id;
  const currentWarns = (userWarnings.get(userId) || 0) + 1;
  userWarnings.set(userId, currentWarns);

  // Send Warning DM
  await member.send(`⚠️ **Warning from Server Moderation**\nReason: ${reason}\nTotal Warnings: ${currentWarns}/${botSettings.maxWarningsBeforeBan}`).catch(() => {});

  actionLogs.unshift({
    type: 'Warning',
    target: member.user.tag,
    reason: `${reason} (Warning #${currentWarns})`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });

  // Threshold Check -> Escalation
  if (currentWarns >= botSettings.maxWarningsBeforeBan) {
    await member.guild.members.ban(userId, { reason: `Auto-Ban: Reached ${botSettings.maxWarningsBeforeBan} warnings.` }).catch(() => {});
    userWarnings.delete(userId);
    actionLogs.unshift({
      type: 'Auto-Ban',
      target: member.user.tag,
      reason: `Exceeded warning limit (${botSettings.maxWarningsBeforeBan})`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  }
}

// --- DISCORD OAUTH2 ROUTES ---
app.get('/api/auth/login', (req, res) => {
  const redirect = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
  res.redirect(redirect);
});

app.get('/api/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');

  try {
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
        scope: 'identify guilds',
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const tokens = await tokenResponse.json();

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { authorization: `${tokens.token_type} ${tokens.access_token}` },
    });
    const user = await userRes.json();

    // Verify Admin/Mod permissions in specified guild
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(user.id).catch(() => null);

    if (!member || (!member.permissions.has('Administrator') && !member.permissions.has('ManageMessages'))) {
      return res.send('<h2>Access Denied: You must be an Administrator or Moderator to view this panel.</h2>');
    }

    req.session.user = { id: user.id, username: user.username, avatar: user.avatar };
    res.redirect('/');
  } catch (err) {
    console.error('OAuth error:', err);
    res.redirect('/?error=auth_failed');
  }
});

app.get('/api/auth/me', (req, res) => {
  res.json({ authenticated: !!req.session.user, user: req.session.user || null });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// --- API ENDPOINTS ---

app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const members = await guild.members.fetch();
    const humanMembers = members.filter(m => !m.user.bot);
    const bans = await guild.bans.fetch().catch(() => new Map());

    res.json({
      totalMembers: humanMembers.size,
      onlineMembers: humanMembers.filter(m => m.presence && ['online', 'idle', 'dnd'].includes(m.presence.status)).size,
      totalBans: bans.size,
      ping: client.ws.ping
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Real-Time Member List & Profiles
app.get('/api/members', requireAuth, async (req, res) => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const members = await guild.members.fetch();

    const memberList = members.map(m => ({
      id: m.id,
      username: m.user.tag,
      avatar: m.user.displayAvatarURL({ extension: 'png' }),
      isBot: m.user.bot,
      roles: m.roles.cache.filter(r => r.name !== '@everyone').map(r => ({ name: r.name, color: r.hexColor })),
      joinedAt: m.joinedAt ? m.joinedAt.toLocaleDateString() : 'Unknown',
      createdAt: m.user.createdAt.toLocaleDateString(),
      warnings: userWarnings.get(m.id) || 0,
    }));

    res.json(memberList);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Broadcast Channel Announcement
app.post('/api/broadcast', requireAuth, async (req, res) => {
  const { channelId, title, message } = req.body;
  if (!channelId || !message) return res.status(400).json({ error: 'Missing channel or message body.' });

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return res.status(400).json({ error: 'Invalid channel ID.' });

    const embed = new EmbedBuilder()
      .setTitle(title || 'Server Announcement')
      .setDescription(message)
      .setColor('#635bff')
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    res.json({ success: true, message: `Announcement published to #${channel.name}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Direct Warning DM
app.post('/api/warn', requireAuth, async (req, res) => {
  const { userId, reason } = req.body;
  if (!userId || !reason) return res.status(400).json({ error: 'Missing user ID or reason.' });

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(userId);
    await issueWarning(member, reason);
    res.json({ success: true, message: `Direct warning sent to ${member.user.tag}` });
  } catch (err) {
    res.status(500).json({ error: 'Could not warn member: ' + err.message });
  }
});

// Auto-Mod Settings Endpoint
app.get('/api/settings', requireAuth, (req, res) => res.json(botSettings));
app.post('/api/settings', requireAuth, (req, res) => {
  const { bannedWords, antiInvite, antiSpam, maxWarningsBeforeBan } = req.body;
  if (Array.isArray(bannedWords)) botSettings.bannedWords = bannedWords;
  if (typeof antiInvite === 'boolean') botSettings.antiInvite = antiInvite;
  if (typeof antiSpam === 'boolean') botSettings.antiSpam = antiSpam;
  if (maxWarningsBeforeBan) botSettings.maxWarningsBeforeBan = Number(maxWarningsBeforeBan);
  res.json({ success: true, settings: botSettings });
});

// Quick Actions Endpoint (Timeout / Ban / Kick)
app.post('/api/moderate', requireAuth, async (req, res) => {
  const { action, userId, reason, durationMinutes } = req.body;
  if (!userId || !reason) return res.status(400).json({ error: 'Missing parameters.' });

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(userId).catch(() => null);

    if (action === 'Ban member') {
      await guild.members.ban(userId, { reason });
      actionLogs.unshift({ type: 'Ban', target: userId, reason, timestamp: new Date().toLocaleTimeString() });
      return res.json({ success: true, message: `Banned user ${userId}` });
    }

    if (!member) return res.status(404).json({ error: 'Member not found.' });

    if (action === 'Kick member') {
      await member.kick(reason);
      actionLogs.unshift({ type: 'Kick', target: member.user.tag, reason, timestamp: new Date().toLocaleTimeString() });
      return res.json({ success: true, message: `Kicked ${member.user.tag}` });
    }

    if (action === 'Timeout member') {
      const duration = (durationMinutes || 10) * 60 * 1000;
      await member.timeout(duration, reason);
      actionLogs.unshift({ type: 'Timeout', target: member.user.tag, reason: `${reason} (${durationMinutes}m)`, timestamp: new Date().toLocaleTimeString() });
      return res.json({ success: true, message: `Timed out ${member.user.tag} for ${durationMinutes} minutes.` });
    }

    res.status(400).json({ error: 'Invalid action type.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/logs', requireAuth, (req, res) => res.json(chatLogs));
app.get('/api/action-history', requireAuth, (req, res) => res.json(actionLogs));

const PORT = process.env.PORT || 3000;
client.login(process.env.DISCORD_TOKEN).then(() => {
  app.listen(PORT, () => console.log(`Sentinel System online on port ${PORT}`));
});
