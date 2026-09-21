CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`portfolio_id` text,
	`date` text NOT NULL,
	`net_worth` text NOT NULL,
	`holdings_value` text NOT NULL,
	`cash` text NOT NULL,
	`invested` text NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`provider` text DEFAULT 'snapshot' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_snapshot_user_date` ON `snapshots` (`user_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_snapshot` ON `snapshots` (`user_id`,`portfolio_id`,`date`);