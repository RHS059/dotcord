CREATE TABLE `accounts` (
	`email` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`role` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL
);
