CREATE TABLE `fx_history` (
	`currency` text NOT NULL,
	`base` text NOT NULL,
	`date` text NOT NULL,
	`rate` text NOT NULL,
	PRIMARY KEY(`currency`, `base`, `date`)
);
--> statement-breakpoint
CREATE TABLE `price_history` (
	`security_id` text NOT NULL,
	`date` text NOT NULL,
	`close` text NOT NULL,
	PRIMARY KEY(`security_id`, `date`),
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `price_history_status` (
	`security_id` text PRIMARY KEY NOT NULL,
	`source` text,
	`first_date` text,
	`last_date` text,
	`fetched_at` text NOT NULL,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE cascade
);
