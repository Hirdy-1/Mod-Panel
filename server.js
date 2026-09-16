const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');

const app = express();

// --- CRITICAL FOR RENDER REVERSE PROXIES ---
app.set('trust proxy', 1);

// --- MIDDLEWARE SETUP ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'sentinel-super-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// --- DISCORD CLIENT SETUP ---
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
const REDIRECT_URI = process.env.REDIRECT_URI;

// State Configuration
const botSettings = {
  bannedWords: ['badword1', 'scamlink'],
  antiInvite: true,
  antiSpam: true,
  maxWarningsBeforeBan: 3,
};

const modmailThreads = new Map();
const chatLogs = [];
const actionLogs = [];
const userWarnings = new Map();
const userSpamCache = new Map();

// Authentication Guard
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Unauthorized. Please login with Discord.' });
  }
  next();
}

// --- AUTOMATED MODERATION & CHAT LOGGING ---
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || message.guild.id !== GUILD_ID) return;

  const content = message.content;
  const userId = message.author.id;
  const member = message.member;

  // 1. Anti-Invite Filter
  if (botSettings.antiInvite && /(discord\.gg|discord\.com\/invite)\//i.test(content)) {
    await message.delete().catch(() => {});
    if (member) await issueWarning(member, 'Posting Discord Invite Links');
    return;
  }

  // 2. Banned Words Filter
  const containsBanned = botSettings.bannedWords.some(word => 
    word.length > 0 && content.toLowerCase().includes(word.toLowerCase())
  );
  if (containsBanned) {
    await message.delete().catch(() => {});
    if (member) await issueWarning(member, 'Using Banned Vocabulary');
    return;
  }

  // 3. Anti-Spam Filter (5 messages within 3s)
  if (botSettings.antiSpam) {
    const now = Date.now();
    const timestamps = userSpamCache.get(userId) || [];
    timestamps.push(now);
    const recent = timestamps.filter(t => now - t < 3000);
    userSpamCache.set(userId, recent);

    if (recent.length >= 5) {
      await message.delete().catch(() => {});
      userSpamCache.set(userId, []);
      if (member) await issueWarning(member, 'Rapid Message Spamming');
      return;
    }
  }

  // Record Chat Log
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

// Helper Function for Warning System
async function issueWarning(member, reason) {
  const userId = member.id;
  const currentWarns = (userWarnings.get(userId) || 0) + 1;
  userWarnings.set(userId, currentWarns);

  await member.send(`⚠️ **Warning from Moderation**\nReason: ${reason}\nWarnings: ${currentWarns}/${botSettings.maxWarningsBeforeBan}`).catch(() => {});

  actionLogs.unshift({
    type: 'Warning',
    target: member.user.tag,
    reason: `${reason} (Warn #${currentWarns})`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });

  if (currentWarns >= botSettings.maxWarningsBeforeBan) {
    await member.guild.members.ban(userId, { reason: `Auto-Ban: Exceeded warning limit (${botSettings.maxWarningsBeforeBan}).` }).catch(() => {});
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
  if (!code) return res.status(400).send('No authorization code provided.');

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

    if (!tokens.access_token) {
      console.error('OAuth token exchange failed:', tokens);
      return res.status(400).send(`Failed to exchange code. Response: ${JSON.stringify(tokens)}`);
    }

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { authorization: `${tokens.token_type} ${tokens.access_token}` },
    });
    const user = await userRes.json();

    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(user.id).catch(() => null);

    if (!member || (!member.permissions.has('Administrator') && !member.permissions.has('ManageMessages'))) {
      return res.status(403).send('<h2>Access Denied: You need Administrator or Moderator permissions to access this panel.</h2>');
    }

    req.session.user = { id: user.id, username: user.username, avatar: user.avatar };
    res.redirect('/');
  } catch (err) {
    console.error('OAuth processing error:', err);
    res.status(500).send('Authentication Error: ' + err.message);
  }
});

app.get('/api/auth/me', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.user), user: req.session?.user || null });
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
      warnings: userWarnings.get(m.id) || 0,
    }));

    res.json(memberList);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/moderate', requireAuth, async (req, res) => {
  const { action, userId, reason, durationMinutes } = req.body;
  if (!userId || !reason) return res.status(400).json({ error: 'Missing target User ID or reason.' });

  try {
    const guild = await client.guilds.fetch(GUILD_ID);

    if (action === 'Ban member') {
      await guild.members.ban(userId, { reason });
      actionLogs.unshift({ type: 'Ban', target: userId, reason, timestamp: new Date().toLocaleTimeString() });
      return res.json({ success: true, message: `Banned user ID ${userId}` });
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return res.status(404).json({ error: 'Member is not in this server.' });

    if (action === 'Kick member') {
      await member.kick(reason);
      actionLogs.unshift({ type: 'Kick', target: member.user.tag, reason, timestamp: new Date().toLocaleTimeString() });
      return res.json({ success: true, message: `Kicked ${member.user.tag}` });
    }

    if (action === 'Timeout member') {
      const duration = (durationMinutes || 10) * 60 * 1000;
      await member.timeout(duration, reason);
      actionLogs.unshift({ type: 'Timeout', target: member.user.tag, reason: `${reason} (${durationMinutes}m)`, timestamp: new Date().toLocaleTimeString() });
      return res.json({ success: true, message: `Timed out ${member.user.tag} for ${durationMinutes}m.` });
    }

    res.status(400).json({ error: 'Invalid action type.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/settings', requireAuth, (req, res) => res.json(botSettings));

app.post('/api/settings', requireAuth, (req, res) => {
  const { bannedWords, antiInvite, antiSpam, maxWarningsBeforeBan } = req.body;
  if (Array.isArray(bannedWords)) botSettings.bannedWords = bannedWords;
  if (typeof antiInvite === 'boolean') botSettings.antiInvite = antiInvite;
  if (typeof antiSpam === 'boolean') botSettings.antiSpam = antiSpam;
  if (maxWarningsBeforeBan) botSettings.maxWarningsBeforeBan = Number(maxWarningsBeforeBan);
  res.json({ success: true, settings: botSettings });
});

// --- RESTORED BROADCAST & WARNING ROUTES ---
app.post('/api/broadcast', requireAuth, async (req, res) => {
  const { channelId, title, message } = req.body;
  if (!channelId || !message) return res.status(400).json({ error: 'Missing channel or message text.' });

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return res.status(400).json({ error: 'Target channel is invalid or non-text.' });

    const embed = new EmbedBuilder()
      .setTitle(title || 'Server Announcement')
      .setDescription(message)
      .setColor('#635bff')
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    res.json({ success: true, message: `Announcement sent to #${channel.name}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/warn', requireAuth, async (req, res) => {
  const { userId, reason } = req.body;
  if (!userId || !reason) return res.status(400).json({ error: 'Missing user ID or reason.' });

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(userId);
    await issueWarning(member, reason);
    res.json({ success: true, message: `Issued warning DM to ${member.user.tag}` });
  } catch (err) {
    res.status(500).json({ error: 'Could not send warning: ' + err.message });
  }
});

app.get('/api/logs', requireAuth, (req, res) => res.json(chatLogs));
app.get('/api/action-history', requireAuth, (req, res) => res.json(actionLogs));

// --- CATCH-ALL ROUTE FOR FRONTEND ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- INITIALIZATION ---
const PORT = process.env.PORT || 3000;
client.login(process.env.DISCORD_TOKEN).then(() => {
  app.listen(PORT, () => console.log(`Sentinel System online on port ${PORT}`));
});
