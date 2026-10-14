import type { Express, Request, Response } from "express";
import { appRouter } from "../routers";
import { createContext } from "./context";

const realtimeClients = new Set<Response>();

function logStartupWarning(feature: string, detail: string) {
  console.warn(`[API] ${feature} not ready: ${detail}`);
}

async function createCaller(req: Request, res: Response) {
  const ctx = await createContext({ req, res } as any);
  return appRouter.createCaller(ctx);
}

function respondJson(res: Response, status: number, payload: Record<string, unknown>) {
  res.status(status).json(payload);
}

function maybeAuthConfigured() {
  return Boolean(process.env.OAUTH_SERVER_URL && process.env.OAUTH_SERVER_URL.trim());
}

function maybeDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());
}

export function emitRealtimeEvent(event: string, payload: unknown) {
  const message = JSON.stringify({
    event,
    payload,
    timestamp: new Date().toISOString(),
  });

  for (const client of realtimeClients) {
    client.write(`event: ${event}\n`);
    client.write(`data: ${message}\n\n`);
  }
}

export function registerRestApiRoutes(app: Express) {
  app.get("/api/health", async (_req, res) => {
    const status = {
      status: "ok",
      mode: process.env.NODE_ENV === "development" ? "development" : "production",
      database: maybeDatabaseConfigured() ? "configured" : "not-configured",
      oauth: maybeAuthConfigured() ? "configured" : "not-configured",
      timestamp: new Date().toISOString(),
    };
    respondJson(res, 200, status);
  });

  app.get("/api/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    realtimeClients.add(res);
    res.write(`event: connected\ndata: ${JSON.stringify({ status: "connected" })}\n\n`);

    req.on("close", () => {
      realtimeClients.delete(res);
    });
  });

  app.post("/api/auth/register", async (req, res) => {
    if (!maybeAuthConfigured()) {
      logStartupWarning("Auth registration", "OAUTH_SERVER_URL is not configured");
      return respondJson(res, 503, {
        error: "Authentication provider unavailable",
        detail: "Set OAUTH_SERVER_URL to a valid auth server before registering users.",
      });
    }

    try {
      const caller = await createCaller(req, res);
      const result = await caller.profile.get();
      respondJson(res, 200, {
        success: true,
        user: result,
        message: "User registration is handled by the configured OAuth provider.",
      });
    } catch (error) {
      respondJson(res, 500, {
        error: "Registration failed",
        detail: error instanceof Error ? error.message : "Unknown registration error",
      });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    if (!maybeAuthConfigured()) {
      logStartupWarning("Auth login", "OAUTH_SERVER_URL is not configured");
      return respondJson(res, 503, {
        error: "Authentication provider unavailable",
        detail: "Set OAUTH_SERVER_URL and complete the provider-backed login flow.",
      });
    }

    try {
      const caller = await createCaller(req, res);
      const user = await caller.auth.me();
      respondJson(res, 200, {
        success: !!user,
        user,
        message: user ? "Authenticated" : "Login required",
      });
    } catch (error) {
      respondJson(res, 500, {
        error: "Login failed",
        detail: error instanceof Error ? error.message : "Unknown login error",
      });
    }
  });

  app.get("/api/user/profile", async (req, res) => {
    try {
      const caller = await createCaller(req, res);
      const profile = await caller.profile.get();
      respondJson(res, 200, profile);
    } catch (error) {
      respondJson(res, 500, {
        error: "Unable to read profile",
        detail: error instanceof Error ? error.message : "Unknown profile error",
      });
    }
  });

  app.get("/api/devices", async (req, res) => {
    try {
      const caller = await createCaller(req, res);
      const device = await caller.deviceConfig.get();
      respondJson(res, 200, device);
    } catch (error) {
      respondJson(res, 500, {
        error: "Unable to load devices",
        detail: error instanceof Error ? error.message : "Unknown device error",
      });
    }
  });

  app.post("/api/devices/register", async (req, res) => {
    try {
      const caller = await createCaller(req, res);
      const device = await caller.deviceConfig.update({
        deviceId: typeof req.body?.deviceId === "string" ? req.body.deviceId : "AG-001",
        deviceName: typeof req.body?.deviceName === "string" ? req.body.deviceName : "AI Guardian Band",
        connectionStatus: req.body?.connectionStatus === "Disconnected" ? "Disconnected" : "Connected",
        battery: typeof req.body?.battery === "number" ? req.body.battery : 87,
        firmware: typeof req.body?.firmware === "string" ? req.body.firmware : "Prototype bridge v0.1",
        lastSync: new Date().toISOString(),
      });
      emitRealtimeEvent("DEVICE_CONNECTED", device);
      respondJson(res, 200, { success: true, device });
    } catch (error) {
      respondJson(res, 500, {
        error: "Device registration failed",
        detail: error instanceof Error ? error.message : "Unknown device registration error",
      });
    }
  });

  app.get("/api/devices/:id", async (req, res) => {
    try {
      const caller = await createCaller(req, res);
      const device = await caller.deviceConfig.get();
      respondJson(res, 200, { id: req.params.id, device });
    } catch (error) {
      respondJson(res, 500, {
        error: "Unable to load device",
        detail: error instanceof Error ? error.message : "Unknown device error",
      });
    }
  });

  app.get("/api/location/current", async (req, res) => {
    try {
      const caller = await createCaller(req, res);
      const sensor = await caller.sensors.current();
      respondJson(res, 200, {
        deviceId: sensor.deviceId,
        latitude: sensor.latitude,
        longitude: sensor.longitude,
        accuracyMeters: 12,
        timestamp: sensor.recordedAt,
      });
    } catch (error) {
      respondJson(res, 500, {
        error: "Unable to read current location",
        detail: error instanceof Error ? error.message : "Unknown location error",
      });
    }
  });

  app.post("/api/location/update", async (req, res) => {
    try {
      const caller = await createCaller(req, res);
      const payload = {
        deviceId: typeof req.body?.deviceId === "string" ? req.body.deviceId : "AG-001",
        timestamp: new Date().toISOString(),
        heartRate: typeof req.body?.heartRate === "number" ? req.body.heartRate : 78,
        accelX: typeof req.body?.accelX === "number" ? req.body.accelX : 0,
        accelY: typeof req.body?.accelY === "number" ? req.body.accelY : 0,
        accelZ: typeof req.body?.accelZ === "number" ? req.body.accelZ : 0,
        gyroX: typeof req.body?.gyroX === "number" ? req.body.gyroX : 0,
        gyroY: typeof req.body?.gyroY === "number" ? req.body.gyroY : 0,
        gyroZ: typeof req.body?.gyroZ === "number" ? req.body.gyroZ : 0,
        movement: typeof req.body?.movement === "string" ? req.body.movement : "Normal",
        fallDetected: Boolean(req.body?.fallDetected),
        latitude: typeof req.body?.latitude === "number" ? req.body.latitude : 16.7049,
        longitude: typeof req.body?.longitude === "number" ? req.body.longitude : 74.2433,
        battery: typeof req.body?.battery === "number" ? req.body.battery : 87,
        connected: Boolean(req.body?.connected ?? true),
        scenario: typeof req.body?.scenario === "string" ? req.body.scenario : "normal",
      };
      const result = await caller.telemetry.ingest(payload);
      emitRealtimeEvent("LOCATION_UPDATED", result);
      respondJson(res, 200, { success: true, location: result });
    } catch (error) {
      respondJson(res, 500, {
        error: "Location update failed",
        detail: error instanceof Error ? error.message : "Unknown location update error",
      });
    }
  });

  app.get("/api/contacts", async (req, res) => {
    try {
      const caller = await createCaller(req, res);
      const contacts = await caller.contacts.list();
      respondJson(res, 200, contacts);
    } catch (error) {
      respondJson(res, 500, {
        error: "Unable to load emergency contacts",
        detail: error instanceof Error ? error.message : "Unknown contacts error",
      });
    }
  });

  app.post("/api/contacts", async (req, res) => {
    try {
      const caller = await createCaller(req, res);
      const contact = await caller.contacts.create({
        name: String(req.body?.name ?? ""),
        relationship: String(req.body?.relationship ?? "Contact"),
        phone: String(req.body?.phone ?? ""),
        priority: req.body?.priority === "SECONDARY" ? "SECONDARY" : req.body?.priority === "TERTIARY" ? "TERTIARY" : "PRIMARY",
        enabled: Boolean(req.body?.enabled ?? true),
      });
      emitRealtimeEvent("CONTACT_UPDATED", contact);
      respondJson(res, 200, { success: true, contact });
    } catch (error) {
      respondJson(res, 500, {
        error: "Unable to add emergency contact",
        detail: error instanceof Error ? error.message : "Unknown contacts error",
      });
    }
  });

  app.put("/api/contacts/:id", async (req, res) => {
    try {
      const caller = await createCaller(req, res);
      const contact = await caller.contacts.update({
        id: String(req.params.id),
        name: req.body?.name,
        relationship: req.body?.relationship,
        phone: req.body?.phone,
        priority: req.body?.priority,
        enabled: req.body?.enabled,
      });
      emitRealtimeEvent("CONTACT_UPDATED", contact);
      respondJson(res, 200, { success: true, contact });
    } catch (error) {
      respondJson(res, 500, {
        error: "Unable to update emergency contact",
        detail: error instanceof Error ? error.message : "Unknown contacts error",
      });
    }
  });

  app.delete("/api/contacts/:id", async (req, res) => {
    try {
      const caller = await createCaller(req, res);
      const result = await caller.contacts.remove({ id: String(req.params.id) });
      emitRealtimeEvent("CONTACT_REMOVED", { id: req.params.id });
      respondJson(res, 200, { success: true, result });
    } catch (error) {
      respondJson(res, 500, {
        error: "Unable to delete emergency contact",
        detail: error instanceof Error ? error.message : "Unknown contacts error",
      });
    }
  });

  app.post("/api/emergency/start", async (req, res) => {
    try {
      const caller = await createCaller(req, res);
      const result = await caller.emergency.activate({ trigger: String(req.body?.trigger ?? "rest-api") });
      emitRealtimeEvent("EMERGENCY_STARTED", result);
      respondJson(res, 200, result);
    } catch (error) {
      respondJson(res, 500, {
        error: "Emergency start failed",
        detail: error instanceof Error ? error.message : "Unknown emergency error",
      });
    }
  });

  app.post("/api/emergency/cancel", async (req, res) => {
    try {
      const caller = await createCaller(req, res);
      const result = await caller.emergency.cancel({ reason: String(req.body?.reason ?? "Cancelled by REST client") });
      emitRealtimeEvent("EMERGENCY_CANCELLED", result);
      respondJson(res, 200, result);
    } catch (error) {
      respondJson(res, 500, {
        error: "Emergency cancel failed",
        detail: error instanceof Error ? error.message : "Unknown emergency error",
      });
    }
  });

  app.post("/api/emergency/resolve", async (req, res) => {
    try {
      const caller = await createCaller(req, res);
      const result = await caller.emergency.cancel({ reason: String(req.body?.reason ?? "Resolved via REST endpoint") });
      emitRealtimeEvent("EMERGENCY_RESOLVED", result);
      respondJson(res, 200, result);
    } catch (error) {
      respondJson(res, 500, {
        error: "Emergency resolve failed",
        detail: error instanceof Error ? error.message : "Unknown emergency error",
      });
    }
  });

  app.get("/api/emergency/:id", async (req, res) => {
    try {
      const caller = await createCaller(req, res);
      const incident = await caller.incidents.detail({ id: String(req.params.id) });
      respondJson(res, 200, incident ?? { id: req.params.id, status: "not-found" });
    } catch (error) {
      respondJson(res, 500, {
        error: "Unable to load emergency record",
        detail: error instanceof Error ? error.message : "Unknown emergency record error",
      });
    }
  });

  app.get("/api/incidents", async (req, res) => {
    try {
      const caller = await createCaller(req, res);
      const incidents = await caller.incidents.list();
      respondJson(res, 200, incidents);
    } catch (error) {
      respondJson(res, 500, {
        error: "Unable to load incidents",
        detail: error instanceof Error ? error.message : "Unknown incidents error",
      });
    }
  });

  app.get("/api/incidents/:id", async (req, res) => {
    try {
      const caller = await createCaller(req, res);
      const incident = await caller.incidents.detail({ id: String(req.params.id) });
      respondJson(res, 200, incident ?? { id: req.params.id, status: "not-found" });
    } catch (error) {
      respondJson(res, 500, {
        error: "Unable to load incident",
        detail: error instanceof Error ? error.message : "Unknown incident error",
      });
    }
  });

  app.post("/api/sensors", async (req, res) => {
    try {
      const caller = await createCaller(req, res);
      const result = await caller.telemetry.ingest({
        deviceId: String(req.body?.deviceId ?? "AG-001"),
        timestamp: new Date().toISOString(),
        heartRate: Number(req.body?.heartRate ?? 78),
        accelX: Number(req.body?.accelX ?? 0),
        accelY: Number(req.body?.accelY ?? 0),
        accelZ: Number(req.body?.accelZ ?? 0),
        gyroX: Number(req.body?.gyroX ?? 0),
        gyroY: Number(req.body?.gyroY ?? 0),
        gyroZ: Number(req.body?.gyroZ ?? 0),
        movement: String(req.body?.movement ?? "Normal"),
        fallDetected: Boolean(req.body?.fallDetected),
        latitude: Number(req.body?.latitude ?? 16.7049),
        longitude: Number(req.body?.longitude ?? 74.2433),
        battery: Number(req.body?.battery ?? 87),
        connected: Boolean(req.body?.connected ?? true),
        scenario: String(req.body?.scenario ?? "normal"),
      });
      respondJson(res, 200, result);
    } catch (error) {
      respondJson(res, 500, {
        error: "Sensor ingestion failed",
        detail: error instanceof Error ? error.message : "Unknown sensor error",
      });
    }
  });

  app.get("/api/sensors/latest", async (req, res) => {
    try {
      const caller = await createCaller(req, res);
      const sensor = await caller.sensors.current();
      respondJson(res, 200, sensor);
    } catch (error) {
      respondJson(res, 500, {
        error: "Unable to read latest sensor state",
        detail: error instanceof Error ? error.message : "Unknown sensor error",
      });
    }
  });

  app.post("/api/ai/analyze", async (req, res) => {
    try {
      const caller = await createCaller(req, res);
      const result = await caller.risk.analyze({
        heartRate: Number(req.body?.heartRate ?? 78),
        acceleration: Number(req.body?.acceleration ?? 0),
        gyro: Number(req.body?.gyro ?? 0),
        fallDetected: Boolean(req.body?.fallDetected),
        scenario: typeof req.body?.scenario === "string" ? (req.body.scenario as any) : undefined,
      });
      respondJson(res, 200, result);
    } catch (error) {
      respondJson(res, 500, {
        error: "AI risk analysis failed",
        detail: error instanceof Error ? error.message : "Unknown AI error",
      });
    }
  });
}
