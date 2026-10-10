CREATE TABLE `receiver_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`secret_hash` text NOT NULL,
	`created` text NOT NULL,
	`expires` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `receiver_credentials_secret_hash_unique` ON `receiver_credentials` (`secret_hash`);--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `receiver_id` text;