ALTER TABLE `emergencyContacts` ADD COLUMN `notificationPreference` varchar(40) NOT NULL DEFAULT 'SMS';
--> statement-breakpoint
CREATE TABLE `userProfiles` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `fullName` varchar(160) NOT NULL DEFAULT '',
  `displayName` varchar(80) NOT NULL DEFAULT '',
  `email` varchar(320),
  `phone` varchar(40),
  `age` int,
  `bloodGroup` varchar(12),
  `medicalInfo` text,
  `homeLocation` varchar(160),
  `profilePhoto` varchar(200),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `userProfiles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `incidentDetails` (
  `id` int AUTO_INCREMENT NOT NULL,
  `incidentId` varchar(80) NOT NULL,
  `userResponse` varchar(120),
  `riskFactors` text,
  `sensorSnapshot` text,
  `locationStatus` varchar(120) NOT NULL DEFAULT 'Simulated',
  `contactProcessing` text,
  `notificationStatus` varchar(160) NOT NULL DEFAULT 'Demo notification prepared',
  `responseDuration` varchar(40),
  `resolution` varchar(160) NOT NULL DEFAULT 'Recorded',
  `timeline` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `incidentDetails_id` PRIMARY KEY(`id`),
  CONSTRAINT `incidentDetails_incidentId_unique` UNIQUE(`incidentId`)
);
--> statement-breakpoint
CREATE TABLE `safetySettings` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `fallDetection` int NOT NULL DEFAULT 1,
  `automaticEscalation` int NOT NULL DEFAULT 1,
  `safetyVerificationTimer` int NOT NULL DEFAULT 20,
  `emergencyCountdown` int NOT NULL DEFAULT 10,
  `severeEventTimer` int NOT NULL DEFAULT 10,
  `postFallMonitoring` int NOT NULL DEFAULT 1,
  `persistentMonitoring` int NOT NULL DEFAULT 1,
  `severeEventDetection` int NOT NULL DEFAULT 1,
  `safetyMode` varchar(40) NOT NULL DEFAULT 'NORMAL',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `safetySettings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `alertSettings` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `sound` int NOT NULL DEFAULT 1,
  `vibration` int NOT NULL DEFAULT 1,
  `visualAlerts` int NOT NULL DEFAULT 1,
  `volume` int NOT NULL DEFAULT 70,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `alertSettings_id` PRIMARY KEY(`id`)
);
