CREATE TABLE `external_wake_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`expires` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `dots` ADD `wake_provider` text DEFAULT 'dot' NOT NULL;--> statement-breakpoint
ALTER TABLE `receiver_credentials` ADD `provider` text DEFAULT 'dot' NOT NULL;--> statement-breakpoint
ALTER TABLE `receiver_credentials` ADD `dot_id` text;--> statement-breakpoint
ALTER TABLE `receiver_credentials` ADD `webhook_url` text;--> statement-breakpoint
ALTER TABLE `receiver_credentials` ADD `auth_token` text;--> statement-breakpoint
ALTER TABLE `receiver_credentials` ADD `auth_header` text;--> statement-breakpoint
ALTER TABLE `receiver_credentials` ADD `source` text;--> statement-breakpoint
CREATE UNIQUE INDEX `receiver_grokbot_dot` ON `receiver_credentials` (`dot_id`) WHERE "receiver_credentials"."provider" = 'grokbot';