CREATE TABLE `split_checks` (
	`security_id` text PRIMARY KEY NOT NULL,
	`checked_at` text NOT NULL,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `split_events` (
	`security_id` text NOT NULL,
	`ex_date` text NOT NULL,
	`ratio` text NOT NULL,
	`label` text NOT NULL,
	`source` text NOT NULL,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`security_id`, `ex_date`),
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `split_reviews` (
	`user_id` text NOT NULL,
	`portfolio_id` text NOT NULL,
	`account_key` text NOT NULL,
	`security_id` text NOT NULL,
	`ex_date` text NOT NULL,
	`status` text NOT NULL,
	`detail` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`user_id`, `portfolio_id`, `account_key`, `security_id`, `ex_date`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE cascade
);
