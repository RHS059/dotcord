CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`secret_hash` text NOT NULL,
	`email` text NOT NULL,
	`dot` text NOT NULL,
	`discord_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created` text NOT NULL,
	`expires` text NOT NULL,
	`redeemed_by` text,
	`claim` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_secret_hash_unique` ON `invitations` (`secret_hash`);--> statement-breakpoint
CREATE INDEX `invitations_expiry` ON `invitations` (`expires`);--> statement-breakpoint
ALTER TABLE `api_tokens` ADD `dot` text;