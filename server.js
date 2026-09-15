const express = require('express');
const cors = require('cors');
const path = require('path');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// In-memory data stores
const modmailThreads = new Map();
const chatLogs = [];
const actionLogs = []; // Audit log for dashboard kicks/bans

// Event: Capture Guild Chat Logs & Modmail DMs
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Direct Messages (Modmail)
  if (!message.guild) {
    const userId = message.author.id;

    if (!modmailThreads.has(userId)) {
      modmailThreads.set(userId, {
        username: message.author.tag,
        avatar: message.author.displayAvatarURL({ extension: 'png' }),
        messages: [],
      });
    }

    const thread = modmailThreads.get(userId);
    thread.messages.push({
      sender: message.author.username,
      content: message.content,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'incoming',
    });
    return;
  }

  // Server Channel Messages
  if (message.guild.id === GUILD_ID) {
    chatLogs.unshift({
      id: message.id,
      user: message.author.tag,
      avatar: message.author.displayAvatarURL({ extension: 'png' }),
      channel: `#${message.channel.name}`,
      content: message.content || '[Attachment/Embed]',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });

    if (chatLogs.length > 100) chatLogs.pop();
  }
});

// --- API ENDPOINTS ---

// Server Stats Endpoint (Members, Online non-bots, Bans)
app.get('/api/stats', async (req, res) => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    // Fetch all members to accurately filter bots
    const members = await guild.members.fetch();
    const humanMembers = members.filter(m => !m.user.bot);
    
    const totalHumans = humanMembers.size;
    const onlineHumans = humanMembers.filter(m => 
      m.presence && ['online', 'idle', 'dnd'].includes(m.presence.status)
    ).size;

    // Fetch Ban Count
    const bans = await guild.bans.fetch().catch(() => new Map());
    const banCount = bans.size;

    res.json({
      totalMembers: totalHumans,
      onlineMembers: onlineHumans,
      totalBans: banCount,
      ping: client.ws.ping
    });
  } catch (error) {
    console.error('Stats fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Moderation Actions: Ban & Kick
app.post('/api/moderate', async (req, res) => {
  const { action, userId, reason } = req.body;
  if (!userId || !reason) return res.status(400).json({ error: 'Missing target User ID or reason.' });

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    if (!guild) return res.status(404).json({ error: 'Guild not found.' });

    if (action === 'Ban member') {
      await guild.members.ban(userId, { reason });
      actionLogs.unshift({
        type: 'Ban',
        target: userId,
        reason,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
      return res.json({ success: true, message: `Successfully banned user ${userId}` });
    } 
    
    if (action === 'Kick member') {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return res.status(404).json({ error: 'Member is not in this server.' });
      
      const tag = member.user.tag;
      await member.kick(reason);
      
      actionLogs.unshift({
        type: 'Kick',
        target: tag,
        reason,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
      return res.json({ success: true, message: `Successfully kicked ${tag}` });
    }

    return res.status(400).json({ error: 'Invalid action type.' });
  } catch (error) {
    console.error('Moderation error:', error);
    return res.status(500).json({ error: error.message || 'Failed to execute moderation action.' });
  }
});

// Logs & History Endpoints
app.get('/api/logs', (req, res) => res.json(chatLogs));
app.get('/api/action-history', (req, res) => res.json(actionLogs));

// Modmail Endpoints
app.get('/api/modmail', (req, res) => {
  const threads = Array.from(modmailThreads.entries()).map(([userId, data]) => ({
    userId,
    username: data.username,
    avatar: data.avatar,
    lastMessage: data.messages[data.messages.length - 1],
    messages: data.messages,
  }));
  res.json(threads);
});

app.post('/api/modmail/reply', async (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) return res.status(400).json({ error: 'Missing userId or message payload.' });

  try {
    const user = await client.users.fetch(userId);
    await user.send(`**[Support Team]:** ${message}`);

    if (modmailThreads.has(userId)) {
      modmailThreads.get(userId).messages.push({
        sender: 'Moderator',
        content: message,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'outgoing',
      });
    }

    res.json({ success: true, message: 'Message delivered to user DM.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not send DM. User may have DMs disabled.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
client.login(process.env.DISCORD_TOKEN).then(() => {
  app.listen(PORT, () => console.log(`Sentinel API running on port ${PORT}`));
});
