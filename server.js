const express = require('express');
const cors = require('cors');
const path = require('path');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Discord Client
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
const modmailThreads = new Map();

// Capture incoming Direct Messages from users
client.on('messageCreate', async (message) => {
  if (message.author.bot || message.guild) return;

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
});

// API Routes
app.get('/api/status', (req, res) => {
  res.json({
    online: client.isReady(),
    ping: client.ws.ping,
    guilds: client.guilds.cache.size,
  });
});

app.post('/api/moderate', async (req, res) => {
  const { action, userId, reason } = req.body;
  if (!userId || !reason) return res.status(400).json({ error: 'Missing userId or reason' });

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(userId).catch(() => null);

    if (action === 'Ban member') {
      await guild.members.ban(userId, { reason });
      return res.json({ success: true, message: `Banned user ${userId}` });
    } else if (action === 'Kick member') {
      if (!member) return res.status(404).json({ error: 'Member not found in server' });
      await member.kick(reason);
      return res.json({ success: true, message: `Kicked user ${userId}` });
    }
    return res.status(400).json({ error: 'Invalid action type' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

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
  if (!userId || !message) return res.status(400).json({ error: 'Missing userId or message' });

  try {
    const user = await client.users.fetch(userId);
    await user.send(`**[Modmail Reply]:** ${message}`);

    if (modmailThreads.has(userId)) {
      modmailThreads.get(userId).messages.push({
        sender: 'Moderator',
        content: message,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'outgoing',
      });
    }

    res.json({ success: true, message: 'Reply sent to user DM' });
  } catch (err) {
    res.status(500).json({ error: 'Could not DM user. DMs may be closed.' });
  }
});

// Fallback to serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
client.login(process.env.DISCORD_TOKEN).then(() => {
  app.listen(PORT, () => console.log(`API running on port ${PORT}`));
});
