import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { Router } from "express";
import type { Express, NextFunction, Request, Response } from "express";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { getMysqlPool } from "../db";
import { createContext } from "./context";
import {
  requestMsg91Otp,
  getMsg91OtpExpiryMinutes,
  verifyMsg91Otp,
} from "./msg91";

type AuthenticatedRequest = Request & { safetyUserId?: number };
type ContactRow = RowDataPacket & {
  id: number;
  name: string;
  relationship: string;
  phone: string;
  priority: number;
  enabled: number;
  phoneVerifiedAt: Date | string | null;
  createdAt: Date | string;
};
type IncidentRow = RowDataPacket & {
  incidentId: string;
  emergencyStatus: string;
  trigger: string;
  latitude: string | null;
  longitude: string | null;
  locationAccuracyMeters: number | null;
  locationRecordedAt: Date | string | null;
  createdAt: Date | string;
  resolvedAt: Date | string | null;
};
type LocationRow = RowDataPacket & {
  deviceId: string;
  latitude: string;
  longitude: string;
  accuracyMeters: number | null;
  recordedAt: Date | string;
};

const phoneSchema = z
  .string()
  .regex(
    /^\+[1-9]\d{7,14}$/,
    "Use an international phone number, for example +919876543210."
  );
const challengeIdSchema = z.string().uuid();
const locationSchema = z.object({
  deviceId: z.string().min(1).max(64),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(100_000).nullable().optional(),
  recordedAt: z.string().datetime({ offset: true }),
});
const contactInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  relationship: z.string().trim().min(1).max(80),
  phone: phoneSchema,
  priority: z.number().int().min(1).max(3).default(1),
  enabled: z.boolean(),
});
const androidSosSchema = z.object({
  trigger: z.enum(["SOS", "FALL", "MANUAL_HELP"]).default("SOS"),
  contactId: z.number().int().positive(),
  location: locationSchema.optional(),
});
const androidSmsStatusSchema = z.object({
  status: z.enum([
    "composer_opened",
    "user_reported_sent",
    "user_reported_cancelled",
    "composer_unavailable",
  ]),
});

function jsonError(res: Response, status: number, error: string) {
  return res.status(status).json({ error });
}

function requireDatabase() {
  return getMysqlPool().then(pool => {
    if (!pool) throw new Error("Database is not configured");
    return pool;
  });
}

function authenticate(req: Request, res: Response, next: NextFunction) {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const bearerSession =
      req.headers.authorization?.startsWith("Bearer ") ?? false;
    if (!bearerSession) {
      const origin = req.get("origin") || req.get("referer");
      try {
        if (!origin || new URL(origin).host !== req.get("host")) {
          jsonError(res, 403, "Cross-origin safety requests are not allowed.");
          return;
        }
      } catch {
        jsonError(res, 403, "Cross-origin safety requests are not allowed.");
        return;
      }
    }
  }
  void createContext({ req, res } as CreateExpressContextOptions)
    .then(context => {
      if (!context.user || context.user.id <= 0) {
        jsonError(res, 401, "Sign in to use real safety features.");
        return;
      }
      (req as AuthenticatedRequest).safetyUserId = context.user.id;
      next();
    })
    .catch(() => jsonError(res, 401, "Unable to authenticate this request."));
}

function userId(req: Request) {
  const id = (req as AuthenticatedRequest).safetyUserId;
  if (!id) throw new Error("Authentication required");
  return id;
}

async function withTransaction<T>(
  pool: Pool,
  work: (connection: Awaited<ReturnType<Pool["getConnection"]>>) => Promise<T>
) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function phoneHash(phone: string) {
  const secret =
    process.env.PHONE_HASH_SECRET?.trim() || process.env.JWT_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "Set PHONE_HASH_SECRET or a JWT_SECRET with at least 32 characters."
    );
  }
  return createHmac("sha256", secret).update(phone).digest("hex");
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function mobileForMsg91(phone: string) {
  return phone.slice(1);
}

function asIso(value: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function validateLocationTimestamp(value: string) {
  const recordedAt = new Date(value);
  const age = Date.now() - recordedAt.getTime();
  if (age < -60_000 || age > 24 * 60 * 60 * 1000) {
    throw new Error("Location timestamp must be within the last 24 hours.");
  }
  return recordedAt;
}

async function saveLatestLocation(
  connection: Awaited<ReturnType<Pool["getConnection"]>>,
  ownerId: number,
  location: z.infer<typeof locationSchema>
) {
  const recordedAt = validateLocationTimestamp(location.recordedAt);
  await connection.execute(
    `INSERT INTO latestLocations
      (userId, deviceId, latitude, longitude, accuracyMeters, recordedAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE deviceId=VALUES(deviceId), latitude=VALUES(latitude), longitude=VALUES(longitude),
       accuracyMeters=VALUES(accuracyMeters), recordedAt=VALUES(recordedAt), updatedAt=UTC_TIMESTAMP()`,
    [
      ownerId,
      location.deviceId,
      String(location.latitude),
      String(location.longitude),
      location.accuracyMeters ?? null,
      recordedAt,
    ]
  );
  await connection.execute(
    `UPDATE incidents SET latitude=?, longitude=?, locationAccuracyMeters=?,
       locationRecordedAt=?, location=?
     WHERE userId=? AND emergencyStatus='active'`,
    [
      String(location.latitude),
      String(location.longitude),
      location.accuracyMeters ?? null,
      recordedAt,
      `${location.latitude}, ${location.longitude}`,
      ownerId,
    ]
  );
  const [activeIncidents] = await connection.execute<
    (RowDataPacket & { incidentId: string })[]
  >(
    `SELECT incidentId FROM incidents WHERE userId=? AND emergencyStatus='active' LIMIT 1`,
    [ownerId]
  );
  if (activeIncidents[0]) {
    const details = `Device fix at ${recordedAt.toISOString()}; accuracy ${
      location.accuracyMeters == null
        ? "unknown"
        : `±${Math.round(location.accuracyMeters)}m`
    }`;
    await connection.execute(
      `INSERT INTO incidentTimelineEvents (incidentId, eventType, details)
       SELECT ?, 'location_updated', ?
       WHERE NOT EXISTS (
         SELECT 1 FROM incidentTimelineEvents
         WHERE incidentId=? AND eventType='location_updated'
           AND createdAt > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE)
       )`,
      [activeIncidents[0].incidentId, details, activeIncidents[0].incidentId]
    );
  }
  return { ...location, recordedAt: recordedAt.toISOString() };
}

function makeShareToken() {
  return randomBytes(32).toString("base64url");
}

function shareExpiryMinutes() {
  const value = Number(process.env.LIVE_LOCATION_EXPIRY_MINUTES || 60);
  return Number.isInteger(value) && value >= 5 && value <= 1440 ? value : 60;
}

function locationUpdateIntervalSeconds() {
  const value = Number(process.env.LOCATION_UPDATE_INTERVAL_SECONDS || 30);
  return Number.isInteger(value) && value >= 15 && value <= 300 ? value : 30;
}

async function readCurrentLocation(
  connection: Awaited<ReturnType<Pool["getConnection"]>>,
  ownerId: number
) {
  const [rows] = await connection.execute<LocationRow[]>(
    `SELECT deviceId, latitude, longitude, accuracyMeters, recordedAt
     FROM latestLocations WHERE userId=? ORDER BY recordedAt DESC LIMIT 1`,
    [ownerId]
  );
  const latest = rows[0];
  if (!latest) return null;
  return {
    deviceId: latest.deviceId,
    latitude: Number(latest.latitude),
    longitude: Number(latest.longitude),
    accuracyMeters: latest.accuracyMeters,
    recordedAt: asIso(latest.recordedAt),
    isStale:
      Date.now() - new Date(latest.recordedAt).getTime() > 15 * 60 * 1000,
  };
}

function trackingUrl(token: string) {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (!configured) throw new Error("PUBLIC_APP_URL is not configured.");
  const safeBase = new URL(configured);
  if (
    safeBase.username ||
    safeBase.password ||
    (safeBase.protocol !== "https:" &&
      !(
        process.env.NODE_ENV !== "production" &&
        safeBase.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(safeBase.hostname)
      ))
  ) {
    throw new Error(
      "PUBLIC_APP_URL must use HTTPS (HTTP localhost is allowed only in development)."
    );
  }
  return new URL(`/share/${encodeURIComponent(token)}`, safeBase).toString();
}

function statusString(status: string) {
  return ["queued", "sent", "delivered", "failed", "unknown"].includes(status)
    ? status
    : "unknown";
}

async function createContact(
  pool: Pool,
  ownerId: number,
  input: z.infer<typeof contactInputSchema>
) {
  const [result] = await pool.execute(
    `INSERT INTO emergencyContacts
     (userId, name, relationship, phone, priority, enabled, notificationPreference, phoneVerifiedAt)
     VALUES (?, ?, ?, ?, ?, ?, 'SMS', NULL)`,
    [
      ownerId,
      input.name,
      input.relationship,
      input.phone,
      input.priority,
      input.enabled ? 1 : 0,
    ]
  );
  const id = Number((result as { insertId?: number }).insertId);
  const [created] = await pool.execute<ContactRow[]>(
    `SELECT id, name, relationship, phone, priority, enabled, phoneVerifiedAt, createdAt
     FROM emergencyContacts WHERE id=? AND userId=?`,
    [id, ownerId]
  );
  return created[0];
}

export function registerSafetyApiRoutes(app: Express) {
  const router = Router();
  const publicRouter = Router();

  app.get("/share/:token", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  publicRouter.get("/share/:token", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (!/^[A-Za-z0-9_-]{40,50}$/.test(req.params.token)) {
      return jsonError(
        res,
        404,
        "This live-location link is invalid or no longer available."
      );
    }
    try {
      const pool = await requireDatabase();
      const [rows] = await pool.execute<
        (RowDataPacket & {
          incidentId: string;
          emergencyStatus: string;
          trigger: string;
          createdAt: Date | string;
          expiresAt: Date | string;
          latitude: string | null;
          longitude: string | null;
          locationAccuracyMeters: number | null;
          locationRecordedAt: Date | string | null;
        })[]
      >(
        `SELECT i.incidentId, i.emergencyStatus, i.trigger, i.createdAt,
          s.expiresAt, i.latitude, i.longitude, i.locationAccuracyMeters, i.locationRecordedAt
         FROM liveLocationSessions s JOIN incidents i ON i.incidentId=s.incidentId
         WHERE s.tokenHash=? AND s.revokedAt IS NULL AND s.expiresAt > UTC_TIMESTAMP()
           AND i.emergencyStatus='active' LIMIT 1`,
        [tokenHash(req.params.token)]
      );
      const row = rows[0];
      if (!row)
        return jsonError(
          res,
          404,
          "This live-location link is invalid or no longer available."
        );
      const hasLocation = row.latitude !== null && row.longitude !== null;
      const recordedAt = asIso(row.locationRecordedAt);
      return res.json({
        status: row.emergencyStatus,
        event: row.trigger,
        startedAt: asIso(row.createdAt),
        expiresAt: asIso(row.expiresAt),
        location: hasLocation
          ? {
              latitude: Number(row.latitude),
              longitude: Number(row.longitude),
              accuracyMeters: row.locationAccuracyMeters,
              recordedAt,
              mapUrl: `https://maps.google.com/?q=${encodeURIComponent(`${row.latitude},${row.longitude}`)}`,
              isStale:
                !recordedAt ||
                Date.now() - new Date(recordedAt).getTime() > 15 * 60 * 1000,
            }
          : null,
      });
    } catch (error) {
      console.error(
        "[Safety] Could not read shared location:",
        error instanceof Error ? error.message : "unknown error"
      );
      return jsonError(res, 503, "Live location is temporarily unavailable.");
    }
  });

  router.use(authenticate);

  router.get("/status", async (req, res) => {
    try {
      const pool = await requireDatabase();
      const ownerId = userId(req);
      const [profiles] = await pool.execute<
        (RowDataPacket & {
          phone: string | null;
          phoneVerifiedAt: Date | string | null;
        })[]
      >(
        `SELECT phone, phoneVerifiedAt FROM userProfiles WHERE userId=? LIMIT 1`,
        [ownerId]
      );
      const [contacts] = await pool.execute<
        (RowDataPacket & {
          enabled: number;
          phoneVerifiedAt: Date | string | null;
        })[]
      >(
        `SELECT enabled, phoneVerifiedAt FROM emergencyContacts WHERE userId=?`,
        [ownerId]
      );
      const [incidents] = await pool.execute<IncidentRow[]>(
        `SELECT incidentId, emergencyStatus, trigger, latitude, longitude,
          locationAccuracyMeters, locationRecordedAt, createdAt, resolvedAt
         FROM incidents WHERE userId=? AND emergencyStatus='active'
         ORDER BY createdAt DESC LIMIT 1`,
        [ownerId]
      );
      const connection = await pool.getConnection();
      let location: Awaited<ReturnType<typeof readCurrentLocation>>;
      try {
        location = await readCurrentLocation(connection, ownerId);
      } finally {
        connection.release();
      }
      const active = incidents[0];
      let shareRows: (RowDataPacket & {
        expiresAt: Date | string;
        revokedAt: Date | string | null;
      })[] = [];
      if (active) {
        [shareRows] = await pool.execute<
          (RowDataPacket & {
            expiresAt: Date | string;
            revokedAt: Date | string | null;
          })[]
        >(
          `SELECT expiresAt, revokedAt FROM liveLocationSessions
           WHERE incidentId=? AND userId=? LIMIT 1`,
          [active.incidentId, ownerId]
        );
      }
      return res.json({
        phone: {
          verified: Boolean(profiles[0]?.phoneVerifiedAt),
          verifiedAt: asIso(profiles[0]?.phoneVerifiedAt ?? null),
          masked: profiles[0]?.phone
            ? `${profiles[0].phone.slice(0, 4)}••••${profiles[0].phone.slice(-3)}`
            : null,
        },
        contacts: {
          total: contacts.length,
          enabled: contacts.filter(contact => contact.enabled === 1).length,
          verifiedEnabled: contacts.filter(
            contact => contact.enabled === 1 && contact.phoneVerifiedAt
          ).length,
        },
        provider: {
          otpConfigured: Boolean(
            process.env.MSG91_AUTH_KEY &&
              process.env.MSG91_OTP_TEMPLATE_ID &&
              (
                process.env.PHONE_HASH_SECRET?.trim() ||
                process.env.JWT_SECRET?.trim() ||
                ""
              ).length >= 32
          ),
          publicUrlConfigured: Boolean(process.env.PUBLIC_APP_URL?.trim()),
        },
        locationUpdateIntervalSeconds: locationUpdateIntervalSeconds(),
        location,
        activeIncident: active
          ? {
              id: active.incidentId,
              status: active.emergencyStatus,
              trigger: active.trigger,
              startedAt: asIso(active.createdAt),
              sharing: Boolean(
                shareRows[0] &&
                  !shareRows[0].revokedAt &&
                  new Date(shareRows[0].expiresAt).getTime() > Date.now()
              ),
              locationRecordedAt: asIso(active.locationRecordedAt),
            }
          : null,
      });
    } catch (error) {
      console.error(
        "[Safety] Could not load status:",
        error instanceof Error ? error.message : "unknown error"
      );
      return jsonError(
        res,
        503,
        "Safety status is unavailable. Confirm the database migration and connection."
      );
    }
  });

  const otpRouter = Router();
  otpRouter.use(authenticate);
  otpRouter.post("/send", async (req, res) => {
    const parsed = z
      .object({ phone: phoneSchema, purpose: z.enum(["account", "contact"]) })
      .safeParse(req.body);
    if (!parsed.success)
      return jsonError(
        res,
        400,
        parsed.error.issues[0]?.message || "Invalid phone number."
      );
    if (parsed.data.purpose === "contact")
      return jsonError(
        res,
        410,
        "Emergency contacts use trusted-contact consent, not phone verification."
      );
    try {
      const pool = await requireDatabase();
      const ownerId = userId(req);
      const hash = phoneHash(parsed.data.phone);
      const configuredCooldown = Number(
        process.env.MSG91_OTP_RESEND_SECONDS || 60
      );
      const cooldown = Number.isFinite(configuredCooldown)
        ? Math.max(30, Math.min(300, Math.trunc(configuredCooldown)))
        : 60;
      const challengeId = randomUUID();
      const otpExpiryMinutes = getMsg91OtpExpiryMinutes();
      const expires = new Date(Date.now() + otpExpiryMinutes * 60 * 1000);
      await withTransaction(pool, async connection => {
        await connection.execute("SELECT id FROM users WHERE id=? FOR UPDATE", [
          ownerId,
        ]);
        await connection.execute(
          `DELETE FROM phoneVerificationChallenges
           WHERE userId=? AND createdAt < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)`,
          [ownerId]
        );
        const [limits] = await connection.execute<
          (RowDataPacket & {
            requestCount: number;
            accountRequestCount: number;
            lastSentAt: Date | string | null;
          })[]
        >(
          `SELECT COUNT(*) AS accountRequestCount,
             SUM(CASE WHEN phoneHash=? THEN 1 ELSE 0 END) AS requestCount,
             MAX(CASE WHEN phoneHash=? THEN createdAt ELSE NULL END) AS lastSentAt
           FROM phoneVerificationChallenges
           WHERE userId=? AND createdAt > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR)`,
          [hash, hash, ownerId]
        );
        if (
          Number(limits[0]?.requestCount ?? 0) >= 5 ||
          Number(limits[0]?.accountRequestCount ?? 0) >= 10
        ) {
          throw new Error("OTP request limit reached. Try again later.");
        }
        if (
          limits[0]?.lastSentAt &&
          Date.now() - new Date(limits[0].lastSentAt).getTime() <
            cooldown * 1000
        ) {
          throw new Error(
            `Wait ${cooldown} seconds before requesting another OTP.`
          );
        }
        await connection.execute(
          `UPDATE phoneVerificationChallenges SET status='expired'
           WHERE userId=? AND purpose=? AND status IN ('pending','verified')`,
          [ownerId, parsed.data.purpose]
        );
        await connection.execute(
          `INSERT INTO phoneVerificationChallenges
           (id, userId, phoneHash, purpose, status, verificationAttempts, createdAt, expiresAt)
           VALUES (?, ?, ?, ?, 'pending', 0, UTC_TIMESTAMP(), ?)`,
          [challengeId, ownerId, hash, parsed.data.purpose, expires]
        );
      });
      let providerRequestId: string | null;
      try {
        providerRequestId = await requestMsg91Otp(
          mobileForMsg91(parsed.data.phone)
        );
      } catch (error) {
        await pool.execute(
          `UPDATE phoneVerificationChallenges SET status='failed' WHERE id=? AND userId=?`,
          [challengeId, ownerId]
        );
        const configMissing =
          error instanceof Error && error.message.includes("not configured");
        console.error(
          "[Safety] MSG91 OTP request failed:",
          configMissing
            ? "provider configuration missing"
            : "provider rejected request"
        );
        return jsonError(
          res,
          configMissing ? 503 : 502,
          configMissing
            ? "Phone verification provider is not configured."
            : "The provider did not accept the OTP request. No successful delivery is being reported."
        );
      }
      await pool.execute(
        `UPDATE phoneVerificationChallenges SET providerRequestId=? WHERE id=? AND userId=?`,
        [providerRequestId, challengeId, ownerId]
      );
      return res.status(202).json({
        challengeId,
        status: "accepted_for_delivery",
        expiresInSeconds: otpExpiryMinutes * 60,
        resendAfterSeconds: cooldown,
        message:
          "The provider accepted the request; delivery to the handset is not confirmed.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (
        message.startsWith("Wait ") ||
        message.startsWith("OTP request limit")
      )
        return jsonError(res, 429, message);
      console.error(
        "[Safety] OTP request could not be started:",
        message || "unknown error"
      );
      return jsonError(
        res,
        503,
        "Unable to start verification. Confirm database and provider configuration."
      );
    }
  });

  otpRouter.post("/verify", async (req, res) => {
    const parsed = z
      .object({
        challengeId: challengeIdSchema,
        phone: phoneSchema,
        otp: z.string().regex(/^\d{6}$/, "Enter the six-digit OTP."),
        purpose: z.enum(["account", "contact"]),
      })
      .safeParse(req.body);
    if (!parsed.success)
      return jsonError(
        res,
        400,
        parsed.error.issues[0]?.message || "Invalid verification request."
      );
    try {
      const pool = await requireDatabase();
      const ownerId = userId(req);
      const hash = phoneHash(parsed.data.phone);
      const [matches] = await pool.execute<
        (RowDataPacket & { id: string; verificationAttempts: number })[]
      >(
        `UPDATE phoneVerificationChallenges SET verificationAttempts=verificationAttempts+1
         WHERE id=? AND userId=? AND phoneHash=? AND purpose=? AND status='pending'
           AND expiresAt > UTC_TIMESTAMP() AND verificationAttempts < 5`,
        [parsed.data.challengeId, ownerId, hash, parsed.data.purpose]
      );
      if (!(matches as unknown as { affectedRows?: number }).affectedRows) {
        return jsonError(
          res,
          400,
          "This verification is expired, already used, or has too many attempts."
        );
      }
      let valid: boolean;
      try {
        valid = await verifyMsg91Otp(
          mobileForMsg91(parsed.data.phone),
          parsed.data.otp
        );
      } catch {
        return jsonError(
          res,
          502,
          "The verification provider is unavailable. Try again before the challenge expires."
        );
      }
      if (!valid) return jsonError(res, 400, "The OTP is invalid or expired.");
      await withTransaction(pool, async connection => {
        const [updated] = await connection.execute(
          `UPDATE phoneVerificationChallenges SET status='verified', verifiedAt=UTC_TIMESTAMP()
           WHERE id=? AND userId=? AND status='pending' AND expiresAt > UTC_TIMESTAMP()`,
          [parsed.data.challengeId, ownerId]
        );
        if (!(updated as unknown as { affectedRows?: number }).affectedRows) {
          throw new Error("This OTP has already been verified or expired.");
        }
        if (parsed.data.purpose === "account") {
          const [profile] = await connection.execute<RowDataPacket[]>(
            `SELECT id FROM userProfiles WHERE userId=? LIMIT 1 FOR UPDATE`,
            [ownerId]
          );
          if (profile.length) {
            await connection.execute(
              `UPDATE userProfiles SET phone=?, phoneVerifiedAt=UTC_TIMESTAMP() WHERE userId=?`,
              [parsed.data.phone, ownerId]
            );
          } else {
            await connection.execute(
              `INSERT INTO userProfiles (userId, fullName, displayName, phone, phoneVerifiedAt)
               VALUES (?, '', '', ?, UTC_TIMESTAMP())`,
              [ownerId, parsed.data.phone]
            );
          }
        }
      });
      return res.json({
        verified: true,
        purpose: parsed.data.purpose,
        verifiedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error(
        "[Safety] OTP verification failed:",
        error instanceof Error ? error.message : "unknown error"
      );
      return jsonError(
        res,
        503,
        "Unable to verify this code. Confirm database and provider availability."
      );
    }
  });

  app.use("/api/auth/otp", otpRouter);

  router.get("/contacts", async (req, res) => {
    try {
      const pool = await requireDatabase();
      const [rows] = await pool.execute<ContactRow[]>(
        `SELECT id, name, relationship, phone, priority, enabled, phoneVerifiedAt, createdAt
         FROM emergencyContacts WHERE userId=? ORDER BY priority, id`,
        [userId(req)]
      );
      return res.json(
        rows.map(contact => ({
          id: contact.id,
          name: contact.name,
          relationship: contact.relationship,
          phone: contact.phone,
          priority: contact.priority,
          enabled: contact.enabled === 1,
          trusted: contact.enabled === 1,
          phoneVerifiedAt: asIso(contact.phoneVerifiedAt),
          createdAt: asIso(contact.createdAt),
        }))
      );
    } catch (error) {
      console.error(
        "[Safety] Could not list contacts:",
        error instanceof Error ? error.message : "unknown error"
      );
      return jsonError(res, 503, "Emergency contacts are unavailable.");
    }
  });

  router.post("/contacts", async (req, res) => {
    const parsed = contactInputSchema.safeParse(req.body);
    if (!parsed.success)
      return jsonError(
        res,
        400,
        parsed.error.issues[0]?.message || "Invalid contact."
      );
    try {
      const contact = await createContact(
        await requireDatabase(),
        userId(req),
        parsed.data
      );
      return res.status(201).json({
        id: contact.id,
        name: contact.name,
        relationship: contact.relationship,
        phone: contact.phone,
        priority: contact.priority,
        enabled: contact.enabled === 1,
        trusted: contact.enabled === 1,
        phoneVerifiedAt: asIso(contact.phoneVerifiedAt),
        message: contact.enabled
          ? "Contact saved as trusted for Android SOS. Phone ownership remains unverified."
          : "Contact saved, but it is not trusted or enabled for SOS.",
      });
    } catch (error) {
      console.error(
        "[Safety] Contact creation failed:",
        "database write failed"
      );
      return jsonError(res, 503, "Unable to save the contact.");
    }
  });

  router.patch("/contacts/:id", async (req, res) => {
    const id = Number(req.params.id);
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(120).optional(),
        relationship: z.string().trim().min(1).max(80).optional(),
        phone: phoneSchema.optional(),
        priority: z.number().int().min(1).max(3).optional(),
        enabled: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!Number.isInteger(id) || id <= 0 || !parsed.success)
      return jsonError(res, 400, "Invalid contact update.");
    try {
      const pool = await requireDatabase();
      const ownerId = userId(req);
      const [found] = await pool.execute<ContactRow[]>(
        `SELECT id, name, relationship, phone, priority, enabled, phoneVerifiedAt, createdAt
         FROM emergencyContacts WHERE id=? AND userId=? LIMIT 1`,
        [id, ownerId]
      );
      const existing = found[0];
      if (!existing) return jsonError(res, 404, "Contact not found.");
      const input = parsed.data;
      const phoneChanged = Boolean(input.phone && input.phone !== existing.phone);
      const verifiedAt = phoneChanged ? null : existing.phoneVerifiedAt;
      const enabled = phoneChanged
        ? false
        : (input.enabled ?? existing.enabled === 1);
      await pool.execute(
        `UPDATE emergencyContacts SET name=?, relationship=?, phone=?, priority=?, enabled=?,
           phoneVerifiedAt=? WHERE id=? AND userId=?`,
        [
          input.name ?? existing.name,
          input.relationship ?? existing.relationship,
          input.phone ?? existing.phone,
          input.priority ?? existing.priority,
          enabled ? 1 : 0,
          verifiedAt,
          id,
          ownerId,
        ]
      );
      return res.json({
        updated: true,
        enabled,
        trusted: enabled,
        phoneVerifiedAt: asIso(verifiedAt),
        message: phoneChanged
          ? "Contact number updated, phone verification cleared, and SOS trust disabled. Review and re-enable trust separately."
          : enabled
            ? "Contact is trusted and enabled for Android SOS. Phone verification status is unchanged."
            : "Contact is no longer trusted or enabled for SOS.",
      });
    } catch (error) {
      console.error(
        "[Safety] Contact update failed:",
        error instanceof Error ? error.message : "unknown error"
      );
      return jsonError(res, 503, "Unable to update the contact.");
    }
  });

  router.delete("/contacts/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0)
      return jsonError(res, 400, "Invalid contact.");
    try {
      const pool = await requireDatabase();
      const [result] = await pool.execute(
        `DELETE FROM emergencyContacts WHERE id=? AND userId=?`,
        [id, userId(req)]
      );
      return res.json({
        removed: Boolean((result as { affectedRows?: number }).affectedRows),
      });
    } catch (error) {
      console.error(
        "[Safety] Contact deletion failed:",
        error instanceof Error ? error.message : "unknown error"
      );
      return jsonError(res, 503, "Unable to remove the contact.");
    }
  });

  router.post("/location", async (req, res) => {
    const parsed = locationSchema.safeParse(req.body);
    if (!parsed.success)
      return jsonError(
        res,
        400,
        parsed.error.issues[0]?.message || "Invalid location update."
      );
    try {
      const pool = await requireDatabase();
      const location = await withTransaction(pool, connection =>
        saveLatestLocation(connection, userId(req), parsed.data)
      );
      return res.json({
        accepted: true,
        location: {
          ...location,
          mapUrl: `https://maps.google.com/?q=${encodeURIComponent(`${location.latitude},${location.longitude}`)}`,
        },
      });
    } catch (error) {
      console.error(
        "[Safety] Location update failed:",
        error instanceof Error ? error.message : "unknown error"
      );
      return jsonError(
        res,
        503,
        error instanceof Error && error.message.startsWith("Location timestamp")
          ? error.message
          : "Location could not be stored. Check network and database availability."
      );
    }
  });

  router.post("/android-sos", async (req, res) => {
    const parsed = androidSosSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return jsonError(
        res,
        400,
        parsed.error.issues[0]?.message || "Invalid Android SOS request."
      );
    try {
      const pool = await requireDatabase();
      const ownerId = userId(req);
      const incidentId = randomUUID();
      const requestTime = new Date();
      const result = await withTransaction(pool, async connection => {
        await connection.execute("SELECT id FROM users WHERE id=? FOR UPDATE", [
          ownerId,
        ]);
        const [active] = await connection.execute<IncidentRow[]>(
          `SELECT incidentId, emergencyStatus, trigger, latitude, longitude,
            locationAccuracyMeters, locationRecordedAt, createdAt, resolvedAt
           FROM incidents WHERE userId=? AND emergencyStatus='active'
           ORDER BY createdAt DESC LIMIT 1 FOR UPDATE`,
          [ownerId]
        );
        if (active.length) return { existing: active[0] };

        const [contacts] = await connection.execute<
          (RowDataPacket & { id: number })[]
        >(
          `SELECT id FROM emergencyContacts
           WHERE id=? AND userId=? AND enabled=1
           LIMIT 1`,
          [parsed.data.contactId, ownerId]
        );
        if (!contacts.length) throw new Error("CONTACT_NOT_AUTHORIZED");

        const location = parsed.data.location
          ? await saveLatestLocation(connection, ownerId, parsed.data.location)
          : null;
        await connection.execute(
          `INSERT INTO incidents
           (incidentId, userId, riskScore, riskLevel, \`trigger\`, location, sensorSummary,
            responseStatus, emergencyStatus, latitude, longitude, locationAccuracyMeters, locationRecordedAt, createdAt)
           VALUES (?, ?, 100, 'HIGH RISK', ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
          [
            incidentId,
            ownerId,
            parsed.data.trigger,
            location ? `${location.latitude}, ${location.longitude}` : "Location unavailable",
            "Android-initiated SOS; SMS requires user confirmation in the system composer",
            "Android SMS awaiting user confirmation",
            location ? String(location.latitude) : null,
            location ? String(location.longitude) : null,
            location?.accuracyMeters ?? null,
            location?.recordedAt ? new Date(location.recordedAt) : null,
            requestTime,
          ]
        );
        await connection.execute(
          `INSERT INTO incidentTimelineEvents (incidentId, eventType, details)
           VALUES (?, 'android_sos_started', ?)`,
          [incidentId, `Android SOS; user-selected trusted contact ${parsed.data.contactId}`]
        );
        await connection.execute(
          `INSERT INTO incidentTimelineEvents (incidentId, eventType, details)
           VALUES (?, ?, ?)`,
          location
            ? [
                incidentId,
                "location_captured",
                `Android GPS fix at ${location.recordedAt}; accuracy ${
                  location.accuracyMeters == null
                    ? "unknown"
                    : `±${Math.round(location.accuracyMeters)}m`
                }`,
              ]
            : [
                incidentId,
                "location_unavailable",
                "Android did not provide an authorized GPS fix",
              ]
        );
        await connection.execute(
          `INSERT INTO incidentTimelineEvents (incidentId, eventType, details)
           VALUES (?, 'android_sms_pending_confirmation', ?)`,
          [incidentId, "SMS composer has not yet reported a user action"]
        );
        return { location };
      });

      if ("existing" in result && result.existing) {
        return res.status(409).json({
          error: "An emergency incident is already active.",
          incidentId: result.existing.incidentId,
          smsStatus: "not_sent",
        });
      }
      return res.status(201).json({
        incidentId,
        status: "active",
        smsStatus: "not_sent_composer_not_opened",
        createdAt: requestTime.toISOString(),
        location: result.location
          ? {
              ...result.location,
              mapUrl: `https://maps.google.com/?q=${encodeURIComponent(`${result.location.latitude},${result.location.longitude}`)}`,
            }
          : null,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "CONTACT_NOT_AUTHORIZED")
        return jsonError(
          res,
          403,
          "Choose a trusted emergency contact enabled for SOS."
        );
      console.error(
        "[Safety] Android SOS recording failed:",
        error instanceof Error ? error.message : "unknown error"
      );
      return jsonError(
        res,
        503,
        "Android SOS could not be recorded. Check authentication, database, and network availability."
      );
    }
  });

  router.post("/incidents/:id/android-sms-status", async (req, res) => {
    const parsed = androidSmsStatusSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return jsonError(res, 400, "Invalid Android SMS status.");
    try {
      const pool = await requireDatabase();
      const ownerId = userId(req);
      const labels = {
        composer_opened: {
          response: "Android SMS composer opened; sending is unconfirmed",
          event: "android_sms_composer_opened",
          detail: "System SMS composer opened; sending and delivery are unconfirmed",
        },
        user_reported_sent: {
          response: "User reported SMS sent; delivery is unconfirmed",
          event: "android_sms_user_reported_sent",
          detail: "User reported tapping send; carrier/provider delivery is unconfirmed",
        },
        user_reported_cancelled: {
          response: "User cancelled Android SMS; not sent",
          event: "android_sms_user_reported_cancelled",
          detail: "User reported cancelling the SMS composer",
        },
        composer_unavailable: {
          response: "Android SMS composer unavailable; not sent",
          event: "android_sms_composer_unavailable",
          detail: "No compatible system SMS composer was available",
        },
      } as const;
      const outcome = labels[parsed.data.status];
      await withTransaction(pool, async connection => {
        const [incidents] = await connection.execute<RowDataPacket[]>(
          `SELECT incidentId FROM incidents
           WHERE incidentId=? AND userId=? AND emergencyStatus='active'
             AND EXISTS (
               SELECT 1 FROM incidentTimelineEvents
               WHERE incidentTimelineEvents.incidentId=incidents.incidentId
                 AND eventType='android_sos_started'
             )
           LIMIT 1 FOR UPDATE`,
          [req.params.id, ownerId]
        );
        if (!incidents.length) throw new Error("ANDROID_INCIDENT_NOT_FOUND");
        await connection.execute(
          `UPDATE incidents SET responseStatus=? WHERE incidentId=? AND userId=?`,
          [outcome.response, req.params.id, ownerId]
        );
        await connection.execute(
          `INSERT INTO incidentTimelineEvents (incidentId, eventType, details)
           VALUES (?, ?, ?)`,
          [req.params.id, outcome.event, outcome.detail]
        );
      });
      return res.json({
        status: parsed.data.status,
        delivery: "unconfirmed",
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "ANDROID_INCIDENT_NOT_FOUND"
      )
        return jsonError(res, 404, "Active Android incident not found.");
      console.error(
        "[Safety] Android SMS status update failed:",
        error instanceof Error ? error.message : "unknown error"
      );
      return jsonError(res, 503, "Android SMS status could not be recorded.");
    }
  });

  router.post("/sos", async (req, res) => {
    const parsed = z
      .object({
        trigger: z
          .enum(["SOS", "FALL", "MANUAL_HELP", "DEVICE_ALERT"])
          .default("SOS"),
        location: locationSchema.optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success)
      return jsonError(
        res,
        400,
        parsed.error.issues[0]?.message || "Invalid SOS request."
      );
    try {
      const pool = await requireDatabase();
      const ownerId = userId(req);
      const incidentId = randomUUID();
      const shareId = randomUUID();
      const rawToken = makeShareToken();
      const url = trackingUrl(rawToken);
      const expiresAt = new Date(Date.now() + shareExpiryMinutes() * 60_000);
      const requestTime = new Date();
      const result = await withTransaction(pool, async connection => {
        await connection.execute("SELECT id FROM users WHERE id=? FOR UPDATE", [
          ownerId,
        ]);
        await connection.execute(
          `DELETE FROM liveLocationSessions
           WHERE userId=? AND (expiresAt < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)
             OR revokedAt < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY))`,
          [ownerId]
        );
        const [active] = await connection.execute<IncidentRow[]>(
          `SELECT incidentId, emergencyStatus, trigger, latitude, longitude,
            locationAccuracyMeters, locationRecordedAt, createdAt, resolvedAt
           FROM incidents WHERE userId=? AND emergencyStatus='active'
           ORDER BY createdAt DESC LIMIT 1 FOR UPDATE`,
          [ownerId]
        );
        if (active.length) return { existing: active[0] };
        if (parsed.data.location) {
          await saveLatestLocation(connection, ownerId, parsed.data.location);
        }
        const currentLocation = await readCurrentLocation(connection, ownerId);
        await connection.execute(
          `INSERT INTO incidents
           (incidentId, userId, riskScore, riskLevel, \`trigger\`, location, sensorSummary,
            responseStatus, emergencyStatus, latitude, longitude, locationAccuracyMeters, locationRecordedAt, createdAt)
           VALUES (?, ?, 100, 'HIGH RISK', ?, ?, ?, 'SMS not sent from website; use Android app', 'active', ?, ?, ?, ?, UTC_TIMESTAMP())`,
          [
            incidentId,
            ownerId,
            parsed.data.trigger,
            currentLocation
              ? `${currentLocation.latitude}, ${currentLocation.longitude}`
              : "Location unavailable",
            "User-initiated SOS",
            currentLocation ? String(currentLocation.latitude) : null,
            currentLocation ? String(currentLocation.longitude) : null,
            currentLocation?.accuracyMeters ?? null,
            currentLocation?.recordedAt
              ? new Date(currentLocation.recordedAt)
              : null,
          ]
        );
        await connection.execute(
          `INSERT INTO liveLocationSessions (id, userId, incidentId, tokenHash, expiresAt)
           VALUES (?, ?, ?, ?, ?)`,
          [shareId, ownerId, incidentId, tokenHash(rawToken), expiresAt]
        );
        await connection.execute(
          `INSERT INTO incidentTimelineEvents (incidentId, eventType, details)
           VALUES (?, 'sos_started', 'User-initiated emergency incident; no SMS sent from website')`,
          [incidentId]
        );
        await connection.execute(
          `INSERT INTO incidentTimelineEvents (incidentId, eventType, details)
           VALUES (?, 'android_sms_required', 'Use the AI Guardian Android app to prepare an SMS in the phone messaging app')`,
          [incidentId]
        );
        if (currentLocation) {
          await connection.execute(
            `INSERT INTO incidentTimelineEvents (incidentId, eventType, details)
             VALUES (?, 'location_captured', ?)`,
            [
              incidentId,
              `Fix at ${currentLocation.recordedAt}; accuracy ${
                currentLocation.accuracyMeters == null
                  ? "unknown"
                  : `±${Math.round(currentLocation.accuracyMeters)}m`
              }`,
            ]
          );
        }
        if (!currentLocation) {
          await connection.execute(
            `INSERT INTO incidentTimelineEvents (incidentId, eventType, details)
             VALUES (?, 'location_unavailable', 'No device location was available at SOS time')`,
            [incidentId]
          );
        }
        return { currentLocation };
      });
      if ("existing" in result && result.existing) {
        return res.status(409).json({
          error: "An emergency incident is already active.",
          incidentId: result.existing.incidentId,
          notificationsSent: false,
          smsStatus: "not_sent_android_app_required",
        });
      }
      return res.status(201).json({
        incidentId,
        status: "active",
        startedAt: requestTime.toISOString(),
        location: result.currentLocation
          ? {
              ...result.currentLocation,
              mapUrl: `https://maps.google.com/?q=${encodeURIComponent(`${result.currentLocation.latitude},${result.currentLocation.longitude}`)}`,
            }
          : null,
        liveLocationUrl: url,
        liveLocationExpiresAt: expiresAt.toISOString(),
        notifications: [],
        smsStatus: "not_sent_android_app_required",
        message:
          "Incident and live-location link recorded. No SMS was sent; use the Android app to prepare and confirm a message in the phone's messaging app.",
      });
    } catch (error) {
      console.error(
        "[Safety] SOS could not be completed:",
        error instanceof Error ? error.message : "unknown error"
      );
      return jsonError(
        res,
        503,
        "SOS could not be recorded. Check authentication, database, and service configuration."
      );
    }
  });

  router.get("/incidents", async (req, res) => {
    try {
      const pool = await requireDatabase();
      const [incidents] = await pool.execute<
        (IncidentRow & {
          responseStatus: string;
          riskLevel: string;
          riskScore: number;
        })[]
      >(
        `SELECT incidentId, emergencyStatus, trigger, latitude, longitude,
          locationAccuracyMeters, locationRecordedAt, createdAt, resolvedAt, responseStatus, riskLevel, riskScore
         FROM incidents WHERE userId=? ORDER BY createdAt DESC LIMIT 50`,
        [userId(req)]
      );
      if (!incidents.length) return res.json([]);
      const ids = incidents.map(item => item.incidentId);
      const [attempts] = await pool.execute<
        (RowDataPacket & {
          attemptId: number;
          incidentId: string;
          contactId: number;
          status: string;
          providerMessageId: string | null;
          attemptedAt: Date | string | null;
          attemptCount: number;
          providerError: string | null;
        })[]
      >(
        `SELECT id AS attemptId, incidentId, contactId, status, providerMessageId, attemptedAt,
          attemptCount, providerError
         FROM emergencyNotificationAttempts WHERE incidentId IN (${ids.map(() => "?").join(",")})`,
        ids
      );
      const [events] = await pool.execute<
        (RowDataPacket & {
          incidentId: string;
          eventType: string;
          details: string | null;
          createdAt: Date | string;
        })[]
      >(
        `SELECT incidentId, eventType, details, createdAt
         FROM incidentTimelineEvents WHERE incidentId IN (${ids.map(() => "?").join(",")})
         ORDER BY createdAt`,
        ids
      );
      return res.json(
        incidents.map(item => ({
          id: item.incidentId,
          status: item.emergencyStatus,
          trigger: item.trigger,
          riskLevel: item.riskLevel,
          riskScore: item.riskScore,
          responseStatus: item.responseStatus,
          location:
            item.latitude && item.longitude
              ? {
                  latitude: Number(item.latitude),
                  longitude: Number(item.longitude),
                  accuracyMeters: item.locationAccuracyMeters,
                  recordedAt: asIso(item.locationRecordedAt),
                }
              : null,
          startedAt: asIso(item.createdAt),
          resolvedAt: asIso(item.resolvedAt),
          notifications: attempts
            .filter(attempt => attempt.incidentId === item.incidentId)
            .map(attempt => ({
              attemptId: attempt.attemptId,
              contactId: attempt.contactId,
              status: statusString(attempt.status),
              providerMessageId: attempt.providerMessageId,
              attemptedAt: asIso(attempt.attemptedAt),
              canRetry: false,
            })),
          timeline: events
            .filter(event => event.incidentId === item.incidentId)
            .map(event => ({
              type: event.eventType,
              details: event.details,
              timestamp: asIso(event.createdAt),
            })),
        }))
      );
    } catch (error) {
      console.error(
        "[Safety] Could not list incidents:",
        error instanceof Error ? error.message : "unknown error"
      );
      return jsonError(res, 503, "Incident history is unavailable.");
    }
  });

  router.post("/incidents/:id/resolve", async (req, res) => {
    const parsed = z
      .object({
        resolution: z.string().trim().max(160).default("User marked safe"),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return jsonError(res, 400, "Invalid resolution.");
    try {
      const pool = await requireDatabase();
      const ownerId = userId(req);
      await withTransaction(pool, async connection => {
        const [updated] = await connection.execute(
          `UPDATE incidents SET emergencyStatus='resolved', responseStatus=?, resolvedAt=UTC_TIMESTAMP()
           WHERE incidentId=? AND userId=? AND emergencyStatus='active'`,
          [parsed.data.resolution, req.params.id, ownerId]
        );
        if (!(updated as unknown as { affectedRows?: number }).affectedRows) {
          throw new Error("Active incident not found.");
        }
        await connection.execute(
          `UPDATE liveLocationSessions SET revokedAt=UTC_TIMESTAMP()
           WHERE incidentId=? AND userId=? AND revokedAt IS NULL`,
          [req.params.id, ownerId]
        );
        await connection.execute(
          `INSERT INTO incidentTimelineEvents (incidentId, eventType, details)
           VALUES (?, 'incident_resolved', ?)`,
          [req.params.id, parsed.data.resolution]
        );
      });
      return res.json({ resolved: true, sharing: "stopped" });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Active incident not found."
      )
        return jsonError(res, 404, error.message);
      console.error(
        "[Safety] Incident resolution failed:",
        error instanceof Error ? error.message : "unknown error"
      );
      return jsonError(res, 503, "Unable to resolve the incident.");
    }
  });

  router.post("/incidents/:id/sharing/revoke", async (req, res) => {
    try {
      const pool = await requireDatabase();
      const [result] = await pool.execute(
        `UPDATE liveLocationSessions SET revokedAt=UTC_TIMESTAMP()
         WHERE incidentId=? AND userId=? AND revokedAt IS NULL`,
        [req.params.id, userId(req)]
      );
      return res.json({
        revoked: Boolean((result as { affectedRows?: number }).affectedRows),
      });
    } catch (error) {
      console.error(
        "[Safety] Sharing revocation failed:",
        error instanceof Error ? error.message : "unknown error"
      );
      return jsonError(res, 503, "Unable to revoke live-location access.");
    }
  });

  router.post("/notifications/:id/retry", (_req, res) =>
    jsonError(
      res,
      410,
      "Server-side emergency SMS is disabled. Use the Android app to prepare a message in the phone's messaging app."
    )
  );

  app.use("/api/safety", router);
  app.use(publicRouter);
}
