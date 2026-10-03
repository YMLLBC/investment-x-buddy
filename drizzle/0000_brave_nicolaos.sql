CREATE TABLE `buddy_evidence` (
	`run_id` text NOT NULL,
	`id` text NOT NULL,
	`evidence_json` text NOT NULL,
	`hash` text NOT NULL,
	PRIMARY KEY(`run_id`, `id`),
	FOREIGN KEY (`run_id`) REFERENCES `buddy_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `buddy_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`mode` text NOT NULL,
	`text` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `buddy_memory_owner_mode_created` ON `buddy_memory` (`owner_id`,`mode`,`created_at`);--> statement-breakpoint
CREATE TABLE `buddy_model_reservations` (
	`token` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`amount` real NOT NULL,
	`actual` real,
	`status` text NOT NULL,
	`owner_id` text NOT NULL,
	`run_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `buddy_reservations_day` ON `buddy_model_reservations` (`day`);--> statement-breakpoint
CREATE TABLE `buddy_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`window_ms` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `buddy_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`mode` text NOT NULL,
	`version` integer NOT NULL,
	`updated_at` text NOT NULL,
	`run_json` text NOT NULL,
	`symbols` text NOT NULL,
	`scenario` text NOT NULL,
	`planning` integer NOT NULL,
	`review_attempts` integer NOT NULL,
	`retry_at` integer NOT NULL,
	`lease_id` text,
	`lease_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `buddy_runs_owner_mode_updated` ON `buddy_runs` (`owner_id`,`mode`,`updated_at`);