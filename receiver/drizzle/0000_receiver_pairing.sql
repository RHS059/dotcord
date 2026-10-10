CREATE TABLE `receiver_pairing` (
  `id` integer PRIMARY KEY NOT NULL,
  `subject` text NOT NULL,
  `token` text NOT NULL,
  `account_binding` text NOT NULL,
  `dot_id` text,
  `revision` integer NOT NULL DEFAULT 1,
  CONSTRAINT `receiver_pairing_singleton` CHECK (`id` = 1)
);
