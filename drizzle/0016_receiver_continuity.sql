CREATE TABLE `receiver_lineages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`receiver_id` text NOT NULL,
	`revision` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `receiver_secret_hash` text;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `receiver_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `receiver_lineage` text;
--> statement-breakpoint
-- Preserve existing platform leases; unavailable credentials remain inactive.
UPDATE `subscriptions` SET `receiver_secret_hash` = (
  SELECT `secret_hash` FROM `receiver_credentials`
  WHERE `receiver_credentials`.`id` = `subscriptions`.`receiver_id`
    AND `receiver_credentials`.`owner` = `subscriptions`.`owner`
) WHERE `receiver_id` IS NOT NULL;
