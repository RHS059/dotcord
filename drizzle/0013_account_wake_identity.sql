ALTER TABLE `accounts` ADD `primary_dot` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_primary_dot_unique` ON `accounts` (`primary_dot`);
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `scope` text DEFAULT 'handle' NOT NULL;
--> statement-breakpoint
UPDATE accounts SET primary_dot=(SELECT id FROM dots WHERE dots.owner=accounts.user_id AND dots.agent_type='dot') WHERE user_id IS NOT NULL AND (SELECT COUNT(*) FROM dots WHERE dots.owner=accounts.user_id AND dots.agent_type='dot')=1;
