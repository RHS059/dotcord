CREATE TABLE `account_identities` (
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	PRIMARY KEY(`provider`, `subject`)
);
--> statement-breakpoint
CREATE TABLE `account_onboarding` (
	`user_id` text PRIMARY KEY NOT NULL,
	`claim` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`email` text NOT NULL,
	`user_id` text NOT NULL,
	`created` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_expiry` ON `auth_sessions` (`expires`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`browser_hash` text NOT NULL,
	`verifier` text NOT NULL,
	`nonce` text NOT NULL,
	`created` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauth_states_expiry` ON `oauth_states` (`expires`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`secret_hash` text NOT NULL,
	`email` text NOT NULL,
	`dot` text,
	`discord_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created` text NOT NULL,
	`expires` text NOT NULL,
	`redeemed_by` text,
	`claim` text
);
--> statement-breakpoint
INSERT INTO `__new_invitations`("id", "secret_hash", "email", "dot", "discord_id", "created_by", "created", "expires", "redeemed_by", "claim") SELECT "id", "secret_hash", "email", "dot", "discord_id", "created_by", "created", "expires", "redeemed_by", "claim" FROM `invitations`;--> statement-breakpoint
DROP TABLE `invitations`;--> statement-breakpoint
ALTER TABLE `__new_invitations` RENAME TO `invitations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_secret_hash_unique` ON `invitations` (`secret_hash`);--> statement-breakpoint
CREATE INDEX `invitations_expiry` ON `invitations` (`expires`);