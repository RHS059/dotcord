CREATE TABLE `security_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`created` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`outcome` text NOT NULL,
	`resource` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `security_audit_created` ON `security_audit` (`created`,`id`);--> statement-breakpoint
CREATE TABLE `security_maintenance` (
	`id` text PRIMARY KEY NOT NULL,
	`next_run` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wake_limits` (
	`dot` text PRIMARY KEY NOT NULL,
	`next_allowed` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `api_tokens` ADD `owner` text;--> statement-breakpoint
ALTER TABLE `api_tokens` ADD `expires` text;--> statement-breakpoint
-- Preserve existing wake callers for 30 days; no legacy token retains admin rights.
UPDATE api_tokens SET expires = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days') WHERE expires IS NULL;
