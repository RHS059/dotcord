CREATE TABLE `discords` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`connection_url` text NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `dots` ADD `discord_id` text;