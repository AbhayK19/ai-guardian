import {
  double,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const userProfiles = mysqlTable("userProfiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  fullName: varchar("fullName", { length: 160 }).notNull().default(""),
  displayName: varchar("displayName", { length: 80 }).notNull().default(""),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 40 }),
  phoneVerifiedAt: timestamp("phoneVerifiedAt"),
  age: int("age"),
  bloodGroup: varchar("bloodGroup", { length: 12 }),
  medicalInfo: text("medicalInfo"),
  homeLocation: varchar("homeLocation", { length: 160 }),
  profilePhoto: varchar("profilePhoto", { length: 200 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const devices = mysqlTable("devices", {
  id: int("id").autoincrement().primaryKey(),
  deviceId: varchar("deviceId", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  connectionState: mysqlEnum("connectionState", ["connected", "disconnected"])
    .default("connected")
    .notNull(),
  battery: int("battery").default(87).notNull(),
  firmware: varchar("firmware", { length: 120 }),
  lastSyncAt: timestamp("lastSyncAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const sensorReadings = mysqlTable("sensorReadings", {
  id: int("id").autoincrement().primaryKey(),
  deviceId: varchar("deviceId", { length: 64 }).notNull(),
  scenario: varchar("scenario", { length: 40 }).notNull(),
  heartRate: int("heartRate").notNull(),
  accelerometer: varchar("accelerometer", { length: 120 }).notNull(),
  gyroscope: varchar("gyroscope", { length: 120 }).notNull(),
  movement: varchar("movement", { length: 80 }).notNull(),
  fallDetected: int("fallDetected").default(0).notNull(),
  latitude: varchar("latitude", { length: 32 }).notNull(),
  longitude: varchar("longitude", { length: 32 }).notNull(),
  battery: int("battery").notNull(),
  recordedAt: timestamp("recordedAt").defaultNow().notNull(),
});

export const emergencyContacts = mysqlTable("emergencyContacts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  relationship: varchar("relationship", { length: 80 }).notNull(),
  phone: varchar("phone", { length: 40 }).notNull(),
  priority: int("priority").default(1).notNull(),
  enabled: int("enabled").default(1).notNull(),
  notificationPreference: varchar("notificationPreference", { length: 40 })
    .default("SMS")
    .notNull(),
  phoneVerifiedAt: timestamp("phoneVerifiedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const incidents = mysqlTable("incidents", {
  id: int("id").autoincrement().primaryKey(),
  incidentId: varchar("incidentId", { length: 80 }).notNull().unique(),
  userId: int("userId"),
  riskScore: int("riskScore").notNull(),
  riskLevel: varchar("riskLevel", { length: 40 }).notNull(),
  trigger: varchar("trigger", { length: 120 }).notNull(),
  location: varchar("location", { length: 160 }).notNull(),
  sensorSummary: text("sensorSummary"),
  responseStatus: varchar("responseStatus", { length: 80 }).notNull(),
  emergencyStatus: varchar("emergencyStatus", { length: 24 })
    .default("resolved")
    .notNull(),
  latitude: varchar("latitude", { length: 32 }),
  longitude: varchar("longitude", { length: 32 }),
  locationAccuracyMeters: double("locationAccuracyMeters"),
  locationRecordedAt: timestamp("locationRecordedAt"),
  resolvedAt: timestamp("resolvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const incidentDetails = mysqlTable("incidentDetails", {
  id: int("id").autoincrement().primaryKey(),
  incidentId: varchar("incidentId", { length: 80 }).notNull().unique(),
  userResponse: varchar("userResponse", { length: 120 }),
  riskFactors: text("riskFactors"),
  sensorSnapshot: text("sensorSnapshot"),
  locationStatus: varchar("locationStatus", { length: 120 })
    .notNull()
    .default("Simulated"),
  contactProcessing: text("contactProcessing"),
  notificationStatus: varchar("notificationStatus", { length: 160 })
    .notNull()
    .default("Demo notification prepared"),
  responseDuration: varchar("responseDuration", { length: 40 }),
  resolution: varchar("resolution", { length: 160 })
    .notNull()
    .default("Recorded"),
  timeline: text("timeline"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const safetySettings = mysqlTable("safetySettings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  fallDetection: int("fallDetection").default(1).notNull(),
  automaticEscalation: int("automaticEscalation").default(1).notNull(),
  safetyVerificationTimer: int("safetyVerificationTimer").default(20).notNull(),
  emergencyCountdown: int("emergencyCountdown").default(10).notNull(),
  severeEventTimer: int("severeEventTimer").default(10).notNull(),
  postFallMonitoring: int("postFallMonitoring").default(1).notNull(),
  persistentMonitoring: int("persistentMonitoring").default(1).notNull(),
  severeEventDetection: int("severeEventDetection").default(1).notNull(),
  safetyMode: varchar("safetyMode", { length: 40 }).default("NORMAL").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const alertSettings = mysqlTable("alertSettings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  sound: int("sound").default(1).notNull(),
  vibration: int("vibration").default(1).notNull(),
  visualAlerts: int("visualAlerts").default(1).notNull(),
  volume: int("volume").default(70).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const riskAssessments = mysqlTable("riskAssessments", {
  id: int("id").autoincrement().primaryKey(),
  deviceId: varchar("deviceId", { length: 64 }).notNull(),
  riskScore: int("riskScore").notNull(),
  riskLevel: varchar("riskLevel", { length: 40 }).notNull(),
  confidence: varchar("confidence", { length: 24 }).notNull(),
  factors: text("factors").notNull(),
  explanation: text("explanation").notNull(),
  recordedAt: timestamp("recordedAt").defaultNow().notNull(),
});

export const locationRecords = mysqlTable("locationRecords", {
  id: int("id").autoincrement().primaryKey(),
  deviceId: varchar("deviceId", { length: 64 }).notNull(),
  latitude: varchar("latitude", { length: 32 }).notNull(),
  longitude: varchar("longitude", { length: 32 }).notNull(),
  accuracyMeters: double("accuracyMeters"),
  recordedAt: timestamp("recordedAt").defaultNow().notNull(),
});

export const phoneVerificationChallenges = mysqlTable(
  "phoneVerificationChallenges",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId").notNull(),
    phoneHash: varchar("phoneHash", { length: 64 }).notNull(),
    purpose: mysqlEnum("purpose", ["account", "contact"]).notNull(),
    status: mysqlEnum("status", [
      "pending",
      "verified",
      "consumed",
      "failed",
      "expired",
    ])
      .default("pending")
      .notNull(),
    providerRequestId: varchar("providerRequestId", { length: 120 }),
    verificationAttempts: int("verificationAttempts").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt").defaultNow().notNull(),
    verifiedAt: timestamp("verifiedAt"),
  },
  table => ({
    userPhoneCreatedIdx: index(
      "phoneVerificationChallenges_user_phone_created_idx"
    ).on(table.userId, table.phoneHash, table.createdAt),
  })
);

export const latestLocations = mysqlTable(
  "latestLocations",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    deviceId: varchar("deviceId", { length: 64 }).notNull(),
    latitude: varchar("latitude", { length: 32 }).notNull(),
    longitude: varchar("longitude", { length: 32 }).notNull(),
    accuracyMeters: double("accuracyMeters"),
    recordedAt: timestamp("recordedAt").notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    ownerUnique: uniqueIndex("latestLocations_user_unique").on(table.userId),
  })
);

export const emergencyNotificationAttempts = mysqlTable(
  "emergencyNotificationAttempts",
  {
    id: int("id").autoincrement().primaryKey(),
    incidentId: varchar("incidentId", { length: 80 }).notNull(),
    contactId: int("contactId").notNull(),
    status: mysqlEnum("status", [
      "queued",
      "sent",
      "delivered",
      "failed",
      "unknown",
    ])
      .default("unknown")
      .notNull(),
    providerMessageId: varchar("providerMessageId", { length: 120 }),
    attemptCount: int("attemptCount").default(0).notNull(),
    providerError: varchar("providerError", { length: 160 }),
    attemptedAt: timestamp("attemptedAt"),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    incidentContactUnique: uniqueIndex(
      "emergencyNotificationAttempts_incident_contact_unique"
    ).on(table.incidentId, table.contactId),
  })
);

export const incidentTimelineEvents = mysqlTable(
  "incidentTimelineEvents",
  {
    id: int("id").autoincrement().primaryKey(),
    incidentId: varchar("incidentId", { length: 80 }).notNull(),
    eventType: varchar("eventType", { length: 64 }).notNull(),
    details: varchar("details", { length: 240 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    incidentCreatedIdx: index("incidentTimelineEvents_incident_created_idx").on(
      table.incidentId,
      table.createdAt
    ),
  })
);

export const liveLocationSessions = mysqlTable(
  "liveLocationSessions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId").notNull(),
    incidentId: varchar("incidentId", { length: 80 }).notNull(),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expiresAt").notNull(),
    revokedAt: timestamp("revokedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tokenExpiryIdx: index("liveLocationSessions_token_expiry_idx").on(
      table.tokenHash,
      table.expiresAt
    ),
    incidentOwnerIdx: index("liveLocationSessions_incident_owner_idx").on(
      table.incidentId,
      table.userId
    ),
  })
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type UserProfileRecord = typeof userProfiles.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type SensorReading = typeof sensorReadings.$inferSelect;
export type EmergencyContact = typeof emergencyContacts.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type IncidentDetail = typeof incidentDetails.$inferSelect;
export type SafetySetting = typeof safetySettings.$inferSelect;
export type AlertSetting = typeof alertSettings.$inferSelect;
export type RiskAssessment = typeof riskAssessments.$inferSelect;
export type LocationRecord = typeof locationRecords.$inferSelect;
export type PhoneVerificationChallenge =
  typeof phoneVerificationChallenges.$inferSelect;
export type LatestLocation = typeof latestLocations.$inferSelect;
export type EmergencyNotificationAttempt =
  typeof emergencyNotificationAttempts.$inferSelect;
export type IncidentTimelineEvent = typeof incidentTimelineEvents.$inferSelect;
export type LiveLocationSession = typeof liveLocationSessions.$inferSelect;
