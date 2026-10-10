CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription` text NOT NULL,
	`message` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dots` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`sender` text NOT NULL,
	`text` text NOT NULL,
	`recipients` text NOT NULL,
	`created` text NOT NULL,
	`url` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`dot` text NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`expires` text NOT NULL
);
