CREATE TABLE `manual_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`portfolio_id` text,
	`name` text NOT NULL,
	`asset_class` text DEFAULT 'other' NOT NULL,
	`region` text DEFAULT 'India' NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`current_value` text NOT NULL,
	`cost` text,
	`notes` text,
	`value_as_of` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_manual_assets_user` ON `manual_assets` (`user_id`);--> statement-breakpoint
ALTER TABLE `snapshots` ADD `manual_assets` text DEFAULT '0' NOT NULL;