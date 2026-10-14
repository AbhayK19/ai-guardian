CREATE TABLE `devices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`deviceId` varchar(64) NOT NULL,
	`name` varchar(120) NOT NULL,
	`connectionState` enum('connected','disconnected') NOT NULL DEFAULT 'connected',
	`battery` int NOT NULL DEFAULT 87,
	`firmware` varchar(120),
	`lastSyncAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `devices_id` PRIMARY KEY(`id`),
	CONSTRAINT `devices_deviceId_unique` UNIQUE(`deviceId`)
);
--> statement-breakpoint
CREATE TABLE `emergencyContacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`relationship` varchar(80) NOT NULL,
	`phone` varchar(40) NOT NULL,
	`priority` int NOT NULL DEFAULT 1,
	`enabled` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `emergencyContacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`incidentId` varchar(80) NOT NULL,
	`userId` int,
	`riskScore` int NOT NULL,
	`riskLevel` varchar(40) NOT NULL,
	`trigger` varchar(120) NOT NULL,
	`location` varchar(160) NOT NULL,
	`sensorSummary` text,
	`responseStatus` varchar(80) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `incidents_id` PRIMARY KEY(`id`),
	CONSTRAINT `incidents_incidentId_unique` UNIQUE(`incidentId`)
);
--> statement-breakpoint
CREATE TABLE `locationRecords` (
	`id` int AUTO_INCREMENT NOT NULL,
	`deviceId` varchar(64) NOT NULL,
	`latitude` varchar(32) NOT NULL,
	`longitude` varchar(32) NOT NULL,
	`accuracyMeters` int,
	`recordedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `locationRecords_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sensorReadings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`deviceId` varchar(64) NOT NULL,
	`scenario` varchar(40) NOT NULL,
	`heartRate` int NOT NULL,
	`accelerometer` varchar(120) NOT NULL,
	`gyroscope` varchar(120) NOT NULL,
	`movement` varchar(80) NOT NULL,
	`fallDetected` int NOT NULL DEFAULT 0,
	`latitude` varchar(32) NOT NULL,
	`longitude` varchar(32) NOT NULL,
	`battery` int NOT NULL,
	`recordedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sensorReadings_id` PRIMARY KEY(`id`)
);
