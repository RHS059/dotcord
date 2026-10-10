-- Server-only retry proofs; cleared immediately after confirmed restoration.
ALTER TABLE `receiver_pairing` ADD `previous_tokens` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `receiver_pairing` ADD `operation_id` text;
--> statement-breakpoint
ALTER TABLE `receiver_pairing` ADD `operation_until` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `receiver_pairing` ADD `lineage_secret` text;
--> statement-breakpoint
-- A private receiver identity, usable only alongside an active account credential.
UPDATE `receiver_pairing` SET `lineage_secret`=lower(hex(randomblob(32))) WHERE `lineage_secret` IS NULL;
