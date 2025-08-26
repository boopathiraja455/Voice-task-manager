CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`description` text NOT NULL,
	`due_date` text NOT NULL,
	`category` text DEFAULT 'Personal' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`completed` integer DEFAULT false,
	`frequency` text,
	`created_date` text NOT NULL,
	`completion_history` text,
	`reminder_offset` integer,
	`next_due_date` text
);
