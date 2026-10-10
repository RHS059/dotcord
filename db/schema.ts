import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const dots = sqliteTable('dots',{id:text('id').primaryKey(),agentType:text('agent_type').notNull().default('dot'),discordId:text('discord_id'),webhookUrl:text('webhook_url'),owner:text('owner').notNull(),created:text('created').notNull()});
export const subscriptions = sqliteTable('subscriptions',{id:text('id').primaryKey(),owner:text('owner').notNull(),dot:text('dot').notNull(),url:text('url').notNull(),secret:text('secret').notNull(),expires:text('expires').notNull()});
export const discords = sqliteTable('discords',{id:text('id').primaryKey(),owner:text('owner').notNull(),name:text('name').notNull(),connectionUrl:text('connection_url').notNull(),guildId:text('guild_id').notNull(),channelId:text('channel_id').notNull(),botToken:text('bot_token')});

export const accounts = sqliteTable('accounts',{email:text('email').primaryKey(),userId:text('user_id'),role:text('role').notNull(),enabled:integer('enabled').notNull().default(1)});

export const apiTokens = sqliteTable('api_tokens',{id:text('id').primaryKey(),name:text('name').notNull(),prefix:text('prefix').notNull(),tokenHash:text('token_hash').notNull().unique(),created:text('created').notNull(),owner:text('owner'),expires:text('expires')});

// Pending content is readable for 15 minutes. Acknowledgment clears payload; the
// remaining hash-only receipt prevents duplicate reappearance until expiry.
export const temporaryInbox = sqliteTable('temporary_inbox',{
 id:text('id').primaryKey(),owner:text('owner').notNull(),dot:text('dot').notNull(),
 payload:text('payload'),fingerprint:text('fingerprint').notNull(),
 created:text('created').notNull(),expires:text('expires').notNull()
},table=>[index('temporary_inbox_recipient').on(table.owner,table.dot,table.created),index('temporary_inbox_expiry').on(table.expires)]);

export const wakeLimits = sqliteTable('wake_limits',{dot:text('dot').primaryKey(),nextAllowed:integer('next_allowed').notNull()});
export const securityMaintenance = sqliteTable('security_maintenance',{id:text('id').primaryKey(),nextRun:integer('next_run').notNull()});
export const securityAudit = sqliteTable('security_audit',{
 id:text('id').primaryKey(),created:text('created').notNull(),actor:text('actor').notNull(),action:text('action').notNull(),outcome:text('outcome').notNull(),resource:text('resource').notNull(),count:integer('count').notNull().default(1)
},table=>[index('security_audit_created').on(table.created,table.id)]);
