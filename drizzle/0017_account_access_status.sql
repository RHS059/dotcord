ALTER TABLE `accounts` ADD `status` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
UPDATE `accounts` SET `status` = CASE WHEN `enabled` = 1 THEN 'active' ELSE 'inactive' END;
