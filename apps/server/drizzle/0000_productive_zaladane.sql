CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`portfolio_id` text NOT NULL,
	`name` text NOT NULL,
	`broker` text DEFAULT 'manual' NOT NULL,
	`account_ref` text,
	`currency` text DEFAULT 'INR' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_accounts_portfolio` ON `accounts` (`portfolio_id`);--> statement-breakpoint
CREATE TABLE `exchange_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`base_currency` text NOT NULL,
	`quote_currency` text NOT NULL,
	`rate` text NOT NULL,
	`as_of` text NOT NULL,
	`provider` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fx` ON `exchange_rates` (`base_currency`,`quote_currency`,`as_of`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`portfolio_id` text NOT NULL,
	`account_id` text,
	`broker` text NOT NULL,
	`filename` text NOT NULL,
	`file_hash` text NOT NULL,
	`status` text DEFAULT 'previewed' NOT NULL,
	`rows_total` integer DEFAULT 0 NOT NULL,
	`rows_imported` integer DEFAULT 0 NOT NULL,
	`rows_skipped` integer DEFAULT 0 NOT NULL,
	`rows_invalid` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `portfolios` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`kind` text DEFAULT 'custom' NOT NULL,
	`base_currency` text DEFAULT 'INR' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_portfolio_user_name` ON `portfolios` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`security_id` text NOT NULL,
	`price` text NOT NULL,
	`prev_close` text,
	`change_pct` text,
	`currency` text DEFAULT 'INR' NOT NULL,
	`as_of` text NOT NULL,
	`provider` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_quotes_security_asof` ON `quotes` (`security_id`,`as_of`);--> statement-breakpoint
CREATE TABLE `securities` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`isin` text,
	`amfi_code` text,
	`name` text NOT NULL,
	`asset_class` text DEFAULT 'equity' NOT NULL,
	`sub_class` text,
	`sector` text,
	`sub_sector` text,
	`currency` text DEFAULT 'INR' NOT NULL,
	`exchange` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_securities_isin` ON `securities` (`isin`);--> statement-breakpoint
CREATE INDEX `idx_securities_amfi` ON `securities` (`amfi_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_security_symbol_exchange` ON `securities` (`symbol`,`exchange`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`portfolio_id` text NOT NULL,
	`account_id` text,
	`security_id` text,
	`import_batch_id` text,
	`type` text NOT NULL,
	`trade_date` text NOT NULL,
	`settle_date` text,
	`quantity` text DEFAULT '0' NOT NULL,
	`price` text DEFAULT '0' NOT NULL,
	`gross_amount` text DEFAULT '0' NOT NULL,
	`fees` text DEFAULT '0' NOT NULL,
	`taxes` text DEFAULT '0' NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`fx_rate_to_base` text,
	`segment` text DEFAULT 'equity' NOT NULL,
	`external_ref` text,
	`raw_row_hash` text,
	`source_broker` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_tx_user_portfolio` ON `transactions` (`user_id`,`portfolio_id`);--> statement-breakpoint
CREATE INDEX `idx_tx_security` ON `transactions` (`security_id`);--> statement-breakpoint
CREATE INDEX `idx_tx_raw_hash` ON `transactions` (`raw_row_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tx_user_extref` ON `transactions` (`user_id`,`external_ref`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`email` text,
	`phone` text,
	`dob` text,
	`password_hash` text NOT NULL,
	`base_currency` text DEFAULT 'INR' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);