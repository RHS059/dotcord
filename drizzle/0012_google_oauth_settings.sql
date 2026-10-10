CREATE TABLE `google_oauth_settings` (`id` text PRIMARY KEY NOT NULL, `client_id` text NOT NULL, `client_secret` text NOT NULL, `redirect_uri` text NOT NULL, `updated` text NOT NULL);
--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD `config_fingerprint` text;