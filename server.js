import express from 'express';
import { AuditLogEvent } from 'discord.js';

const router = express.Router();

// Middleware: Ensure the bot client is connected and guild exists
const getGuild = (client, guildId) => {
  if (!client.isReady()) throw new Error('Discord bot client is not ready.');
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error(`Guild with ID ${guildId} not found.`);
  return guild;
};

// 1. GET Server Members
router.get('/api/guild/members', async (req, res) => {
  try {
    const guild = getGuild(req.app.get('discordClient'), process.env.GUILD_ID);
    
    // Fetch members from Discord gateway (requires GuildMembers intent)
    const members = await guild.members.fetch();
    
    const responseData = members.map(member => ({
      id: member.user.id,
      username: member.user.username,
      discriminator: member.user.discriminator,
      displayName: member.displayName,
      avatar: member.user.displayAvatarURL({ dynamic: true }),
      roles: member.roles.cache.map(role => ({ id: role.id, name: role.name })),
      joinedAt: member.joinedAt,
      isBot: member.user.bot
    }));

    res.json({ success: true, count: responseData.length, data: responseData });
  } catch (error) {
    console.error('Failed to fetch members:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. GET Ban List
router.get('/api/guild/bans', async (req, res) => {
  try {
    const guild = getGuild(req.app.get('discordClient'), process.env.GUILD_ID);
    
    // Fetch bans (requires BAN_MEMBERS permission on the bot)
    const bans = await guild.bans.fetch();
    
    const responseData = bans.map(ban => ({
      user: {
        id: ban.user.id,
        username: ban.user.username,
        avatar: ban.user.displayAvatarURL({ dynamic: true })
      },
      reason: ban.reason || 'No reason provided'
    }));

    res.json({ success: true, count: responseData.length, data: responseData });
  } catch (error) {
    console.error('Failed to fetch bans:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. GET Audit Logs (Recent Moderation Actions)
router.get('/api/guild/audit-logs', async (req, res) => {
  try {
    const guild = getGuild(req.app.get('discordClient'), process.env.GUILD_ID);
    
    // Fetch last 20 audit log entries (requires VIEW_AUDIT_LOG permission)
    const auditLogs = await guild.fetchAuditLogs({ limit: 20 });
    
    const responseData = auditLogs.entries.map(entry => ({
      id: entry.id,
      action: AuditLogEvent[entry.action] || entry.action,
      executor: entry.executor ? {
        id: entry.executor.id,
        username: entry.executor.username
      } : null,
      target: entry.target ? {
        id: entry.target.id,
        username: entry.target?.username || entry.target?.name || 'Unknown'
      } : null,
      reason: entry.reason || 'No reason specified',
      createdAt: entry.createdAt
    }));

    res.json({ success: true, data: responseData });
  } catch (error) {
    console.error('Failed to fetch audit logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
