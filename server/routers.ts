import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  deleteContactForUser,
  getDb,
  getAlertSettingsForUser,
  getDeviceConfigForUser,
  getMysqlPool,
  getProfileForUser,
  getSafetySettingsForUser,
  inspectDataset,
  listContactsForUser,
  listIncidentDetailById,
  persistIncident,
  persistIncidentDetail,
  persistRiskAssessment,
  upsertAlertSettingsForUser,
  upsertContactForUser,
  upsertDeviceConfigForUser,
  upsertProfileForUser,
  upsertSafetySettingsForUser,
} from "./db";
import { z } from "zod";
import {
  assessRisk,
  RISK_CONFIG,
  riskToLegacy,
  scenarioTelemetry,
  type RiskAssessment,
  type Scenario,
  type TelemetryInput,
} from "./risk-engine";
import {
  incidents as incidentTable,
  type EmergencyContact as EmergencyContactRow,
} from "../drizzle/schema";
import {
  buildEmergencyNotificationPlan,
  DEFAULT_PHASE4_STORE,
  getEnabledContactsSorted,
  readPhase4Store,
  validateProfile,
  writePhase4Store,
  type EmergencyContact,
  type PersistedIncident,
  type UserProfile,
} from "./phase4";

const scenarioSchema = z.enum([
  "normal",
  "running",
  "impact",
  "fall",
  "distress",
  "emergency",
]);
const telemetrySchema = z.object({
  deviceId: z.string().default("AG-001"),
  timestamp: z.string(),
  heartRate: z.number().min(0).max(250),
  accelX: z.number(),
  accelY: z.number(),
  accelZ: z.number(),
  gyroX: z.number(),
  gyroY: z.number(),
  gyroZ: z.number(),
  movement: z.string().default("Normal"),
  fallDetected: z.boolean().default(false),
  latitude: z.number(),
  longitude: z.number(),
  battery: z.number().min(0).max(100),
  connected: z.boolean().default(true),
  scenario: scenarioSchema.default("normal"),
});

type IncidentRecord = {
  id: string;
  score: number;
  level: string;
  trigger: string;
  location: string;
  sensorSummary: string;
  factors: RiskAssessment["factors"];
  responseStatus: string;
  createdAt: string;
};

function toEmergencyContact(contact: EmergencyContactRow): EmergencyContact {
  return {
    id: String(contact.id),
    name: contact.name,
    relationship: contact.relationship,
    phone: contact.phone,
    priority:
      contact.priority === 1
        ? "PRIMARY"
        : contact.priority === 2
          ? "SECONDARY"
          : "TERTIARY",
    enabled: Boolean(contact.enabled),
    notificationPreference: contact.notificationPreference,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };
}

let activeScenario: Scenario = "normal";
let latestTelemetry = scenarioTelemetry("normal");
let latestAssessment = assessRisk(latestTelemetry);
let telemetryHistory: TelemetryInput[] = [latestTelemetry];
let assessmentHistory: RiskAssessment[] = [latestAssessment];
let incidents: IncidentRecord[] = [];
let latestEmergency: {
  active: boolean;
  activatedAt?: number;
  cancelledAt?: number;
} = { active: false };

function recordTelemetry(input: TelemetryInput) {
  latestTelemetry = input;
  activeScenario = input.scenario;
  telemetryHistory = [...telemetryHistory, input].slice(
    -RISK_CONFIG.demo.maxHistory
  );
  latestAssessment = assessRisk(input, telemetryHistory.slice(0, -1));
  assessmentHistory = [...assessmentHistory, latestAssessment].slice(
    -RISK_CONFIG.demo.maxHistory
  );
  void persistRiskAssessment({
    deviceId: input.deviceId,
    riskScore: latestAssessment.riskScore,
    riskLevel: latestAssessment.riskLevel,
    confidence: latestAssessment.confidence,
    factors: latestAssessment.factors,
    explanation: latestAssessment.explanation,
    recordedAt: new Date(latestAssessment.timestamp),
  });
  return { telemetry: latestTelemetry, assessment: latestAssessment };
}

function createIncident(
  assessment: RiskAssessment,
  trigger: string,
  responseStatus = "Simulation active"
) {
  const incident: IncidentRecord = {
    id: `AG-${Date.now()}`,
    score: assessment.riskScore,
    level: assessment.riskLevel,
    trigger,
    location: `${latestTelemetry.latitude}, ${latestTelemetry.longitude}`,
    sensorSummary: `${latestTelemetry.heartRate} BPM · ${latestTelemetry.movement} · acceleration ${Math.abs(latestTelemetry.accelZ).toFixed(1)} g`,
    factors: assessment.factors,
    responseStatus,
    createdAt: new Date().toISOString(),
  };
  incidents = [incident, ...incidents].slice(0, 100);
  const store = readPhase4Store();
  store.incidents = [
    {
      id: incident.id,
      eventType: trigger,
      riskLevel: incident.level,
      riskScore: incident.score,
      timestamp: incident.createdAt,
      locationStatus: "Simulated location captured",
      userResponse: responseStatus.includes("Recovered") ? "I'm safe" : "No response / help requested",
      resolution: responseStatus,
      responseStatus,
      notificationStatus: "Pending emergency workflow",
      emergencyContacts: [],
      trigger,
      location: incident.location,
      sensorSummary: incident.sensorSummary,
      detectionFactors: incident.factors.map(factor => factor.name),
    } satisfies PersistedIncident,
    ...store.incidents.filter(item => item.id !== incident.id),
  ].slice(0, 100);
  writePhase4Store(store);
  void persistIncident({
    incidentId: incident.id,
    riskScore: incident.score,
    riskLevel: incident.level,
    trigger: incident.trigger,
    location: incident.location,
    sensorSummary: incident.sensorSummary,
    responseStatus: incident.responseStatus,
    createdAt: new Date(incident.createdAt),
  });
  return incident;
}

export const appRouter = router({
  database: router({
    inspect: publicProcedure
      .input(
        z.object({
          query: z.string().default("show all records"),
          table: z.string().optional(),
          page: z.number().int().min(1).default(1),
          search: z.string().max(200).optional(),
        })
      )
      .mutation(async ({ input }) => {
        try {
          return await inspectDataset(input.query, input.table, {
            page: input.page,
            search: input.search,
          });
        } catch {
          const details = "The database query failed. Confirm the MySQL connection and requested table.";
          return {
            dataset: input.table ?? "database",
            selectedTable: input.table ?? null,
            availableTables: [],
            tableCounts: [],
            columns: ["error"],
            records: [{ error: details }],
            totalRecords: 0,
            message: "Database error",
            error: details,
          };
        }
      }),
    listTables: publicProcedure.query(async () => {
      const pool = await getMysqlPool();
      if (!pool) {
        return { tables: [], error: "Database connection failed. Set DATABASE_URL to a valid MySQL URL." };
      }
      try {
        const [rows] = await pool.query("SHOW TABLES");
        const tableRows = rows as Array<Record<string, unknown>>;
        const tables = tableRows.map(row => String(Object.values(row)[0] ?? ""));
        return { tables };
      } catch (error) {
        return { tables: [], error: error instanceof Error ? error.message : "Unknown error" };
      }
    }),
  }),
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  health: publicProcedure.query(() => ({
    status: "ok",
    mode: "simulation",
    timestamp: new Date().toISOString(),
  })),
  device: publicProcedure.query(() => ({
    deviceId: latestTelemetry.deviceId,
    name: "AI Guardian Band",
    connected: latestTelemetry.connected !== false,
    battery: latestTelemetry.battery,
    firmware: "Prototype bridge v0.1",
    lastSyncAt: latestTelemetry.timestamp,
    hardwareReady: true,
  })),
  sensors: router({
    current: publicProcedure.query(() => ({
      ...latestTelemetry,
      recordedAt: latestTelemetry.timestamp,
      acceleration: Math.sqrt(
        latestTelemetry.accelX ** 2 +
          latestTelemetry.accelY ** 2 +
          latestTelemetry.accelZ ** 2
      ),
      risk: latestAssessment,
    })),
    history: publicProcedure.query(() =>
      assessmentHistory.map((assessment, index) => ({
        timestamp: assessment.timestamp,
        risk: assessment.riskScore,
        heartRate:
          telemetryHistory[index]?.heartRate ?? latestTelemetry.heartRate,
      }))
    ),
  }),
  simulation: router({
    scenario: publicProcedure
      .input(z.object({ scenario: scenarioSchema }))
      .mutation(({ input }) => {
        const next = scenarioTelemetry(
          input.scenario as Scenario,
          latestTelemetry
        );
        return {
          scenario: input.scenario,
          risk: riskToLegacy(recordTelemetry(next).assessment),
          telemetry: next,
        };
      }),
    reset: publicProcedure.mutation(() => {
      latestTelemetry = { ...scenarioTelemetry("normal"), battery: 87 };
      activeScenario = "normal";
      telemetryHistory = [];
      assessmentHistory = [];
      incidents = [];
      return recordTelemetry(latestTelemetry);
    }),
    recharge: publicProcedure.mutation(() => {
      latestTelemetry = {
        ...latestTelemetry,
        battery: 100,
        timestamp: new Date().toISOString(),
      };
      return recordTelemetry(latestTelemetry);
    }),
    connection: publicProcedure
      .input(z.object({ connected: z.boolean() }))
      .mutation(({ input }) => {
        latestTelemetry = {
          ...latestTelemetry,
          connected: input.connected,
          timestamp: new Date().toISOString(),
        };
        return recordTelemetry(latestTelemetry);
      }),
  }),
  risk: router({
    current: publicProcedure.query(() => ({
      scenario: activeScenario,
      ...riskToLegacy(latestAssessment),
      riskScore: latestAssessment.riskScore,
      riskLevel: latestAssessment.riskLevel,
      confidence: latestAssessment.confidence,
      factors: latestAssessment.factors,
      timestamp: latestAssessment.timestamp,
      medicallyValidated: false,
    })),
    analyze: publicProcedure
      .input(
        z.object({
          heartRate: z.number(),
          acceleration: z.number(),
          gyro: z.number(),
          fallDetected: z.boolean(),
          scenario: scenarioSchema.optional(),
        })
      )
      .mutation(({ input }) => {
        const reading = scenarioTelemetry(
          input.scenario ?? activeScenario,
          latestTelemetry
        );
        const normalized: TelemetryInput = {
          ...reading,
          heartRate: input.heartRate,
          accelZ: input.acceleration,
          gyroZ: input.gyro,
          fallDetected: input.fallDetected,
        };
        const assessment = assessRisk(normalized, telemetryHistory);
        return {
          ...riskToLegacy(assessment),
          ...assessment,
          score: assessment.riskScore,
          level: assessment.riskLevel,
          transparent: true,
          model: "rule-based-v1",
        };
      }),
  }),
  incidents: router({
    list: publicProcedure.query(async () => {
      const db = await getDb();
      if (db) {
        const rows = await db.select().from(incidentTable).catch(() => []);
        return rows.map(row => ({
          id: row.incidentId,
          score: row.riskScore,
          level: row.riskLevel,
          trigger: row.trigger,
          location: row.location,
          sensorSummary: row.sensorSummary ?? "",
          factors: [],
          responseStatus: row.responseStatus,
          createdAt: row.createdAt.toISOString(),
        } satisfies IncidentRecord));
      }
      return readPhase4Store().incidents.map(item => ({
        id: item.id,
        score: item.riskScore,
        level: item.riskLevel,
        trigger: item.trigger ?? item.eventType,
        location: item.location ?? item.locationStatus,
        sensorSummary: item.sensorSummary ?? "",
        factors: (item.detectionFactors ?? []).map(name => ({ name, contribution: 0, evidence: name })),
        responseStatus: item.responseStatus,
        createdAt: item.timestamp,
      } satisfies IncidentRecord));
    }),
    create: publicProcedure
      .input(
        z.object({
          score: z.number().min(0).max(100),
          level: z.string(),
          trigger: z.string(),
          location: z.string(),
          sensorSummary: z.string().optional(),
          responseStatus: z.string().optional(),
        })
      )
      .mutation(({ input }) => {
        const item = createIncident(
          {
            ...latestAssessment,
            riskScore: input.score,
            riskLevel: input.level as RiskAssessment["riskLevel"],
          },
          input.trigger,
          input.responseStatus ?? "Simulation active"
        );
        return item;
      }),
    detail: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
      const db = await getDb();
      if (db) {
        const record = await listIncidentDetailById(input.id);
        return record ?? null;
      }
      return null;
    }),
  }),
  profile: router({
    get: publicProcedure.query(async () => {
      const db = await getDb();
      if (db) {
        const record = await getProfileForUser(1);
        return record ? {
          fullName: record.fullName,
          displayName: record.displayName,
          email: record.email ?? "",
          phone: record.phone ?? "",
          age: String(record.age ?? ""),
          bloodGroup: record.bloodGroup ?? "",
          medicalInfo: record.medicalInfo ?? "",
          homeLocation: record.homeLocation ?? "",
        } : readPhase4Store().profile;
      }
      return readPhase4Store().profile;
    }),
    update: publicProcedure
      .input(
        z.object({
          fullName: z.string().min(1).optional(),
          displayName: z.string().min(1).optional(),
          email: z.string().optional(),
          phone: z.string().optional(),
          age: z.string().optional(),
          bloodGroup: z.string().optional(),
          medicalInfo: z.string().optional(),
          homeLocation: z.string().optional(),
          profilePhoto: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const store = readPhase4Store();
        const nextProfile: UserProfile = {
          ...store.profile,
          ...input,
          fullName: input.fullName ?? store.profile.fullName,
          displayName: input.displayName ?? store.profile.displayName,
          email: input.email ?? store.profile.email,
          phone: input.phone ?? store.profile.phone,
          age: input.age ?? store.profile.age,
          bloodGroup: input.bloodGroup ?? store.profile.bloodGroup,
          medicalInfo: input.medicalInfo ?? store.profile.medicalInfo,
          homeLocation: input.homeLocation ?? store.profile.homeLocation,
          profilePhoto: input.profilePhoto ?? store.profile.profilePhoto,
        };
        const validation = validateProfile(nextProfile);
        if (!validation.valid) {
          throw new Error(Object.values(validation.errors).join("; "));
        }
        const db = await getDb();
        if (db) {
          await upsertProfileForUser(1, {
            fullName: nextProfile.fullName,
            displayName: nextProfile.displayName,
            email: nextProfile.email || null,
            phone: nextProfile.phone || null,
            age: Number(nextProfile.age) || null,
            bloodGroup: nextProfile.bloodGroup || null,
            medicalInfo: nextProfile.medicalInfo || null,
            homeLocation: nextProfile.homeLocation || null,
            profilePhoto: nextProfile.profilePhoto || null,
          });
        }
        store.profile = nextProfile;
        writePhase4Store(store);
        return nextProfile;
      }),
  }),
  contacts: router({
    list: publicProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (db && ctx.user) {
        return (await listContactsForUser(ctx.user.id)).map(
          toEmergencyContact
        );
      }
      return readPhase4Store().contacts;
    }),
    create: publicProcedure
      .input(
        z.object({
          name: z.string().min(2),
          relationship: z.string().min(2),
          phone: z.string().min(8),
          priority: z.enum(["PRIMARY", "SECONDARY", "TERTIARY"]),
          enabled: z.boolean().optional().default(true),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (db && ctx.user) {
          const saved = await upsertContactForUser(ctx.user.id, {
            name: input.name,
            relationship: input.relationship,
            phone: input.phone,
            priority: input.priority,
            enabled: input.enabled,
            notificationPreference: "SMS",
          });
          if (!saved) throw new Error("Emergency contact could not be saved.");
          return toEmergencyContact(saved);
        }

        const store = readPhase4Store();
        const contact: EmergencyContact = {
          id: `contact-${Date.now()}`,
          name: input.name,
          relationship: input.relationship,
          phone: input.phone,
          priority: input.priority,
          enabled: input.enabled,
          notificationPreference: "SMS",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        store.contacts = [...store.contacts, contact];
        writePhase4Store(store);
        return contact;
      }),
    update: publicProcedure
      .input(
        z.object({
          id: z.string(),
          name: z.string().optional(),
          relationship: z.string().optional(),
          phone: z.string().optional(),
          priority: z.enum(["PRIMARY", "SECONDARY", "TERTIARY"]).optional(),
          enabled: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (db && ctx.user) {
          const existing = await listContactsForUser(ctx.user.id);
          const row = existing.find(contact => String(contact.id) === input.id);
          if (!row) return null;
          const saved = await upsertContactForUser(ctx.user.id, {
            id: row.id,
            name: input.name ?? row.name,
            relationship: input.relationship ?? row.relationship,
            phone: input.phone ?? row.phone,
            priority:
              input.priority ??
              (row.priority === 1
                ? "PRIMARY"
                : row.priority === 2
                  ? "SECONDARY"
                  : "TERTIARY"),
            enabled: input.enabled ?? Boolean(row.enabled),
            notificationPreference: row.notificationPreference,
          });
          return saved ? toEmergencyContact(saved) : null;
        }

        const store = readPhase4Store();
        const next = store.contacts.map(contact =>
          contact.id === input.id
            ? {
                ...contact,
                ...input,
                updatedAt: new Date().toISOString(),
              }
            : contact
        );
        store.contacts = next;
        writePhase4Store(store);
        return next.find(contact => contact.id === input.id) ?? null;
      }),
    remove: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (db && ctx.user) {
        const contactId = Number(input.id);
        const removed =
          Number.isSafeInteger(contactId) && contactId > 0
            ? await deleteContactForUser(ctx.user.id, contactId)
            : false;
        const remaining = await listContactsForUser(ctx.user.id);
        return {
          removed,
          contacts: remaining.map(toEmergencyContact),
        };
      }

      const store = readPhase4Store();
      const target = store.contacts.find(contact => contact.id === input.id);
      const next = store.contacts.filter(contact => contact.id !== input.id);
      store.contacts = next;
      writePhase4Store(store);
      return { removed: !!target, contacts: next };
    }),
  }),
  settings: router({
    get: publicProcedure.query(async () => {
      const db = await getDb();
      if (db) {
        const row = await getSafetySettingsForUser(1);
        return row ? {
          fallDetection: Boolean(row.fallDetection),
          automaticEscalation: Boolean(row.automaticEscalation),
          safetyVerificationTimer: Number(row.safetyVerificationTimer) || 20,
          emergencyCountdown: Number(row.emergencyCountdown) || 10,
          severeEventTimer: Number(row.severeEventTimer) || 10,
          postFallMonitoring: Boolean(row.postFallMonitoring),
          persistentMonitoring: Boolean(row.persistentMonitoring),
          severeEventDetection: Boolean(row.severeEventDetection),
          safetyMode: (row.safetyMode as "NORMAL" | "HIGH SENSITIVITY") || "NORMAL",
        } : readPhase4Store().safetySettings;
      }
      return readPhase4Store().safetySettings;
    }),
    update: publicProcedure
      .input(
        z.object({
          fallDetection: z.boolean().optional(),
          automaticEscalation: z.boolean().optional(),
          safetyVerificationTimer: z.number().min(10).max(30).optional(),
          emergencyCountdown: z.number().min(5).max(30).optional(),
          severeEventTimer: z.number().min(5).max(15).optional(),
          postFallMonitoring: z.boolean().optional(),
          persistentMonitoring: z.boolean().optional(),
          severeEventDetection: z.boolean().optional(),
          safetyMode: z.enum(["NORMAL", "HIGH SENSITIVITY"]).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const store = readPhase4Store();
        const next = { ...store.safetySettings, ...input };
        const db = await getDb();
        if (db) {
          await upsertSafetySettingsForUser(1, {
            fallDetection: next.fallDetection,
            automaticEscalation: next.automaticEscalation,
            safetyVerificationTimer: next.safetyVerificationTimer,
            emergencyCountdown: next.emergencyCountdown ?? 10,
            severeEventTimer: next.severeEventTimer,
            postFallMonitoring: next.postFallMonitoring,
            persistentMonitoring: next.persistentMonitoring,
            severeEventDetection: next.severeEventDetection,
            safetyMode: next.safetyMode,
          });
        }
        store.safetySettings = next;
        writePhase4Store(store);
        return store.safetySettings;
      }),
  }),
  alertSettings: router({
    get: publicProcedure.query(async () => {
      const db = await getDb();
      if (db) {
        const row = await getAlertSettingsForUser(1).catch(() => undefined);
        return row ? {
          sound: Boolean(row.sound),
          vibration: Boolean(row.vibration),
          visualAlerts: Boolean(row.visualAlerts),
          volume: Number(row.volume) || 70,
        } : readPhase4Store().alertSettings;
      }
      return readPhase4Store().alertSettings;
    }),
    update: publicProcedure
      .input(
        z.object({
          sound: z.boolean().optional(),
          vibration: z.boolean().optional(),
          visualAlerts: z.boolean().optional(),
          volume: z.number().min(0).max(100).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const store = readPhase4Store();
        const next = { ...store.alertSettings, ...input };
        const db = await getDb();
        if (db) {
          await upsertAlertSettingsForUser(1, {
            sound: next.sound,
            vibration: next.vibration,
            visualAlerts: next.visualAlerts,
            volume: next.volume,
          });
        }
        store.alertSettings = next;
        writePhase4Store(store);
        return store.alertSettings;
      }),
  }),
  deviceConfig: router({
    get: publicProcedure.query(async () => {
      const db = await getDb();
      if (db) {
        const device = await getDeviceConfigForUser();
        if (device) {
          return {
            deviceId: device.deviceId,
            deviceName: device.name,
            connectionStatus: device.connectionState === "connected" ? "Connected" : "Disconnected",
            battery: device.battery,
            firmware: device.firmware ?? "Demo / Simulation",
            lastSync: device.lastSyncAt?.toISOString() ?? new Date().toISOString(),
          };
        }
      }
      return readPhase4Store().device;
    }),
    update: publicProcedure
      .input(
        z.object({
          deviceId: z.string().optional(),
          deviceName: z.string().optional(),
          connectionStatus: z.enum(["Connected", "Disconnected"]).optional(),
          battery: z.number().min(0).max(100).optional(),
          firmware: z.string().optional(),
          lastSync: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const store = readPhase4Store();
        const next = { ...store.device, ...input };
        const db = await getDb();
        if (db) {
          await upsertDeviceConfigForUser(1, {
            deviceId: next.deviceId,
            deviceName: next.deviceName,
            connectionStatus: next.connectionStatus,
            battery: next.battery,
            firmware: next.firmware,
            lastSync: next.lastSync,
          });
        }
        store.device = next;
        writePhase4Store(store);
        return store.device;
      }),
  }),
  emergency: router({
    activate: publicProcedure
      .input(z.object({ trigger: z.string().optional() }).optional())
      .mutation(async ({ ctx, input }) => {
        latestEmergency = { active: true, activatedAt: Date.now() };
        const store = readPhase4Store();
        const db = await getDb();
        const configuredContacts = db && ctx.user
          ? (await listContactsForUser(ctx.user.id)).map(toEmergencyContact)
          : store.contacts;
        const plan = buildEmergencyNotificationPlan(configuredContacts.filter(c => c.enabled));
        const incident = createIncident(
          latestAssessment,
          input?.trigger ?? `${activeScenario} scenario`
        );
        void persistIncidentDetail({
          incidentId: incident.id,
          userResponse: "Emergency activated",
          riskFactors: incident.factors.map(f => f.name),
          sensorSnapshot: incident.sensorSummary,
          locationStatus: "Simulated",
          contactProcessing: plan.recipients.map(contact => `${contact.name} (${contact.priority})`),
          notificationStatus: plan.warning ?? "Demo notification prepared",
          responseDuration: "0s",
          resolution: "Emergency response simulation",
          timeline: [
            "Fall detected",
            "Alert activated",
            "Emergency escalation",
            "Location captured",
            "Demo notification prepared",
            "Incident recorded",
          ],
        });
        const persisted = readPhase4Store();
        const savedIncident = persisted.incidents.find(item => item.id === incident.id);
        if (savedIncident) {
          savedIncident.notificationStatus = plan.warning ?? "Demo notification prepared";
          savedIncident.emergencyContacts = plan.recipients.map(contact => contact.name);
          savedIncident.resolution = "Emergency response simulation complete";
          savedIncident.responseStatus = "Emergency response completed";
          writePhase4Store(persisted);
        }
        const richerIncident = {
          ...incident,
          notificationStatus: plan.warning ?? "Demo notification prepared",
          emergencyContacts: plan.recipients.map(contact => contact.name),
          noRealDelivery: true,
          demoNotificationType: plan.notificationType,
        };
        return {
          ...latestEmergency,
          incident: richerIncident,
          notificationPlan: plan,
          message:
            plan.warning ?? "Demo emergency activated. No external notification was sent.",
        };
      }),
    cancel: publicProcedure
      .input(z.object({ reason: z.string().optional() }).optional())
      .mutation(({ input }) => {
        latestEmergency = { active: false, cancelledAt: Date.now() };
        const incident = createIncident(
          latestAssessment,
          input?.reason ?? "Emergency countdown cancelled",
          "Cancelled before confirmation"
        );
        return { ...latestEmergency, incident };
      }),
    status: publicProcedure.query(() => latestEmergency),
  }),
  telemetry: router({
    ingest: publicProcedure.input(telemetrySchema).mutation(({ input }) => {
      const result = recordTelemetry(input);
      return {
        accepted: true,
        simulated: true,
        deviceId: input.deviceId,
        recordedAt: result.assessment.timestamp,
        ...result,
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;
