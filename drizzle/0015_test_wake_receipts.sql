CREATE TABLE `wake_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`dot` text NOT NULL,
	`recipient_owner` text NOT NULL,
	`created` integer NOT NULL,
	`result` text
);
--> statement-breakpoint
CREATE INDEX `wake_tests_created` ON `wake_tests` (`created`);--> statement-breakpoint
CREATE INDEX `wake_tests_owner` ON `wake_tests` (`owner`);