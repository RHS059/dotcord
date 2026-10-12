import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const dots = sqliteTable('dots',{id:text('id').primaryKey(),agentType:text('agent_type').notNull().default('dot'),wakeProvider:text('wake_provider').notNull().default('dot'),discordId:text('discord_id'),webhookUrl:text('webhook_url'),owner:text('owner').notNull(),created:text('created').notNull()});
export const subscriptions = sqliteTable('subscriptions',{id:text('id').primaryKey(),owner:text('owner').notNull(),dot:text('dot').notNull(),url:text('url').notNull(),secret:text('secret').notNull(),expires:text('expires').notNull(),scope:text('scope').notNull().default('handle'),receiverId:text('receiver_id'),receiverSecretHash:text('receiver_secret_hash'),receiverRevision:integer('receiver_revision').notNull().default(0),receiverLineage:text('receiver_lineage')});
export const discords = sqliteTable('discords',{id:text('id').primaryKey(),owner:text('owner').notNull(),name:text('name').notNull(),connectionUrl:text('connection_url').notNull(),guildId:text('guild_id').notNull(),channelId:text('channel_id').notNull(),botToken:text('bot_token')});

export const accounts = sqliteTable('accounts',{email:text('email').primaryKey(),userId:text('user_id'),primaryDot:text('primary_dot').unique(),role:text('role').notNull(),enabled:integer('enabled').notNull().default(1),status:text('status').notNull().default('active')});

export const apiTokens = sqliteTable('api_tokens',{id:text('id').primaryKey(),name:text('name').notNull(),prefix:text('prefix').notNull(),tokenHash:text('token_hash').notNull().unique(),created:text('created').notNull(),owner:text('owner'),expires:text('expires'),dot:text('dot')});

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

// Invitations bind a one-time link to a pre-authorized email and a new handle.
export const invitations = sqliteTable('invitations',{
 id:text('id').primaryKey(),secretHash:text('secret_hash').notNull().unique(),email:text('email').notNull(),
 dot:text('dot'),discordId:text('discord_id').notNull(),createdBy:text('created_by').notNull(),
 created:text('created').notNull(),expires:text('expires').notNull(),redeemedBy:text('redeemed_by'),claim:text('claim')
},table=>[index('invitations_expiry').on(table.expires)]);

export const oauthStates = sqliteTable('oauth_states',{
 id:text('id').primaryKey(),browserHash:text('browser_hash').notNull(),verifier:text('verifier').notNull(),nonce:text('nonce').notNull(),created:integer('created').notNull(),expires:integer('expires').notNull()
},table=>[index('oauth_states_expiry').on(table.expires)]);
export const authSessions = sqliteTable('auth_sessions',{
 id:text('id').primaryKey(),subject:text('subject').notNull(),email:text('email').notNull(),userId:text('user_id').notNull(),created:integer('created').notNull(),expires:integer('expires').notNull(),configFingerprint:text('config_fingerprint')
},table=>[index('auth_sessions_expiry').on(table.expires)]);
export const accountIdentities = sqliteTable('account_identities',{
 provider:text('provider').notNull(),subject:text('subject').notNull(),userId:text('user_id').notNull(),email:text('email').notNull()
},table=>[primaryKey({columns:[table.provider,table.subject]})]);
export const accountOnboarding = sqliteTable('account_onboarding',{
 userId:text('user_id').primaryKey(),claim:text('claim').notNull(),created:text('created').notNull()
});

// Server-only provider secret; never expose this table through public APIs.
export const googleOauthSettings = sqliteTable('google_oauth_settings',{
 id:text('id').primaryKey(),clientId:text('client_id').notNull(),clientSecret:text('client_secret').notNull(),redirectUri:text('redirect_uri').notNull(),updated:text('updated').notNull()
});

// Account-scoped receiver credentials are hash-only and cannot send or read messages.
export const receiverCredentials = sqliteTable('receiver_credentials',{provider:text('provider').notNull().default('dot'),dotId:text('dot_id'),webhookUrl:text('webhook_url'),authToken:text('auth_token'),authHeader:text('auth_header'),source:text('source'),id:text('id').primaryKey(),owner:text('owner').notNull(),name:text('name').notNull(),secretHash:text('secret_hash').notNull().unique(),created:text('created').notNull(),expires:text('expires').notNull()},table=>[uniqueIndex('receiver_grokbot_dot').on(table.dotId).where(sql`${table.provider} = 'grokbot'`)]);

// Bounded, content-free receipts: request retries never start another test delivery.
export const wakeTests = sqliteTable('wake_tests',{
 id:text('id').primaryKey(),owner:text('owner').notNull(),dot:text('dot').notNull(),
 recipientOwner:text('recipient_owner').notNull(),created:integer('created').notNull(),result:text('result')
},table=>[index('wake_tests_created').on(table.created),index('wake_tests_owner').on(table.owner)]);

// Stable per-receiver identity; the hash alone never authorizes a request.
export const receiverLineages = sqliteTable('receiver_lineages',{id:text('id').primaryKey(),owner:text('owner').notNull(),receiverId:text('receiver_id').notNull(),revision:integer('revision').notNull()});

export const externalWakeReceipts = sqliteTable('external_wake_receipts',{id:text('id').primaryKey(),status:text('status').notNull(),expires:text('expires').notNull()});
