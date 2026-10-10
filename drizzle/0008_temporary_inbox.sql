CREATE TABLE `temporary_inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`dot` text NOT NULL,
	`payload` text,
	`fingerprint` text NOT NULL,
	`created` text NOT NULL,
	`expires` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `temporary_inbox_recipient` ON `temporary_inbox` (`owner`,`dot`,`created`);--> statement-breakpoint
CREATE INDEX `temporary_inbox_expiry` ON `temporary_inbox` (`expires`);