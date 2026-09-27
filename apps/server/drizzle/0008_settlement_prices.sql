CREATE TABLE `settlement_prices` (
	`symbol` text NOT NULL,
	`nominal_expiry` text NOT NULL,
	`trading_day` text,
	`close` text,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`symbol`, `nominal_expiry`)
);
