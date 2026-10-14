ALTER TABLE `userProfiles`
  ADD COLUMN IF NOT EXISTS `phoneVerifiedAt` timestamp NULL;
--> statement-breakpoint
ALTER TABLE `emergencyContacts`
  ADD COLUMN IF NOT EXISTS `phoneVerifiedAt` timestamp NULL;
--> statement-breakpoint
UPDATE `emergencyContacts` SET `enabled`=0 WHERE `phoneVerifiedAt` IS NULL;
--> statement-breakpoint
ALTER TABLE `incidents`
  ADD COLUMN IF NOT EXISTS `emergencyStatus` varchar(24) NOT NULL DEFAULT 'resolved',
  ADD COLUMN IF NOT EXISTS `latitude` varchar(32) NULL,
  ADD COLUMN IF NOT EXISTS `longitude` varchar(32) NULL,
  ADD COLUMN IF NOT EXISTS `locationAccuracyMeters` double NULL,
  ADD COLUMN IF NOT EXISTS `locationRecordedAt` timestamp NULL,
  ADD COLUMN IF NOT EXISTS `resolvedAt` timestamp NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `phoneVerificationChallenges` (
  `id` varchar(36) NOT NULL,
  `userId` int NOT NULL,
  `phoneHash` varchar(64) NOT NULL,
  `purpose` enum('account','contact') NOT NULL,
  `status` enum('pending','verified','consumed','failed','expired') NOT NULL DEFAULT 'pending',
  `providerRequestId` varchar(120) NULL,
  `verificationAttempts` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `expiresAt` timestamp NOT NULL DEFAULT (now()),
  `verifiedAt` timestamp NULL,
  CONSTRAINT `phoneVerificationChallenges_id` PRIMARY KEY(`id`),
  INDEX `phoneVerificationChallenges_user_phone_created_idx` (`userId`, `phoneHash`, `createdAt`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `latestLocations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `deviceId` varchar(64) NOT NULL,
  `latitude` varchar(32) NOT NULL,
  `longitude` varchar(32) NOT NULL,
  `accuracyMeters` double NULL,
  `recordedAt` timestamp NOT NULL,
  `updatedAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `latestLocations_id` PRIMARY KEY(`id`),
  CONSTRAINT `latestLocations_user_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `emergencyNotificationAttempts` (
  `id` int AUTO_INCREMENT NOT NULL,
  `incidentId` varchar(80) NOT NULL,
  `contactId` int NOT NULL,
  `status` enum('queued','sent','delivered','failed','unknown') NOT NULL DEFAULT 'unknown',
  `providerMessageId` varchar(120) NULL,
  `attemptCount` int NOT NULL DEFAULT 0,
  `providerError` varchar(160) NULL,
  `attemptedAt` timestamp NULL,
  `updatedAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `emergencyNotificationAttempts_id` PRIMARY KEY(`id`),
  CONSTRAINT `emergencyNotificationAttempts_incident_contact_unique` UNIQUE(`incidentId`, `contactId`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `incidentTimelineEvents` (
  `id` int AUTO_INCREMENT NOT NULL,
  `incidentId` varchar(80) NOT NULL,
  `eventType` varchar(64) NOT NULL,
  `details` varchar(240) NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `incidentTimelineEvents_id` PRIMARY KEY(`id`),
  INDEX `incidentTimelineEvents_incident_created_idx` (`incidentId`, `createdAt`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `liveLocationSessions` (
  `id` varchar(36) NOT NULL,
  `userId` int NOT NULL,
  `incidentId` varchar(80) NOT NULL,
  `tokenHash` varchar(64) NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `revokedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `liveLocationSessions_id` PRIMARY KEY(`id`),
  CONSTRAINT `liveLocationSessions_tokenHash_unique` UNIQUE(`tokenHash`),
  INDEX `liveLocationSessions_token_expiry_idx` (`tokenHash`, `expiresAt`),
  INDEX `liveLocationSessions_incident_owner_idx` (`incidentId`, `userId`)
);
