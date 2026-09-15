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
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const GUILD_ID = process.env.GUILD_ID;

// In-memory data stores
const modmailThreads = new Map();
const chatLogs = []; // Stores recent guild messages

// Event: Capture Guild Chat Logs & Modmail DMs
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // 1. Direct Messages (Modmail)
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

  // 2. Server Channel Messages (Chat Logs)
  if (message.guild.id === GUILD_ID) {
    chatLogs.unshift({
      id: message.id,
      user: message.author.tag,
      avatar: message.author.displayAvatarURL({ extension: 'png' }),
      channel: `#${message.channel.name}`,
      content: message.content || '[Attachment/Embed]',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });

    // Keep log buffer to last 100 messages
    if (chatLogs.length > 100) chatLogs.pop();
  }
});

// --- API ENDPOINTS ---

// Check Bot Status
app.get('/api/status', (req, res) => {
  res.json({
    online: client.isReady(),
    ping: client.ws.ping,
    guilds: client.guilds.cache.size,
  });
});

// Moderation Actions: Ban & Kick
app.post('/api/moderate', async (req, res) => {
  const { action, userId, reason } = req.body;
  if (!userId || !reason) return res.status(400).json({ error: 'Missing target User ID or reason.' });

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    if (!guild) return res.status(404).json({ error: 'Guild not found. Check your GUILD_ID env variable.' });

    if (action === 'Ban member') {
      await guild.members.ban(userId, { reason });
      return res.json({ success: true, message: `Successfully banned user ${userId}` });
    } 
    
    if (action === 'Kick member') {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return res.status(404).json({ error: 'Member is not in this server.' });
      await member.kick(reason);
      return res.json({ success: true, message: `Successfully kicked ${member.user.tag}` });
    }

    return res.status(400).json({ error: 'Invalid moderation action specified.' });
  } catch (error) {
    console.error('Moderation error:', error);
    return res.status(500).json({ error: error.message || 'Failed to execute moderation action.' });
  }
});

// Chat Logs API
app.get('/api/logs', (req, res) => {
  res.json(chatLogs);
});

// Modmail: Fetch Threads
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

// Modmail: Reply to DM
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
    console.error('Modmail send error:', err);
    res.status(500).json({ error: 'Could not send DM. User may have DMs disabled.' });
  }
});

// Catch-all route to serve dashboard HTML
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
client.login(process.env.DISCORD_TOKEN).then(() => {
  app.listen(PORT, () => console.log(`Sentinel API running on port ${PORT}`));
}).catch(err => {
  console.error('Failed to log in to Discord:', err);
});
