import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import {
  alertSettings,
  devices,
  emergencyContacts,
  incidentDetails,
  incidents,
  riskAssessments,
  safetySettings,
  userProfiles,
  users,
  type InsertUser,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: Pool | null = null;

type DatasetRow = Record<string, string | number | boolean | null | undefined>;

export type DatasetInspectionResult = {
  dataset: string;
  selectedTable: string | null;
  availableTables: string[];
  tableCounts: { table: string; records: number }[];
  columns: string[];
  records: DatasetRow[];
  totalRecords: number;
  message: string;
  pagination?: {
    page: number;
    limit: number;
    totalRecords: number;
    hasMore: boolean;
  };
  error?: string;
};

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function getMysqlPool(): Promise<Pool | null> {
  if (!_pool && process.env.DATABASE_URL) {
    try {
      const connectionUrl = new URL(process.env.DATABASE_URL);
      const database = connectionUrl.pathname.replace(/^\/+/, "") || undefined;
      _pool = mysql.createPool({
        host: connectionUrl.hostname,
        port: Number(connectionUrl.port || 3306),
        user: connectionUrl.username || "root",
        password: connectionUrl.password || "",
        database,
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0,
        charset: "utf8mb4_general_ci",
      });
    } catch (error) {
      console.warn("[Database] Failed to create MySQL pool:", error);
      _pool = null;
    }
  }
  return _pool;
}

function sanitizeTableName(name: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Invalid table name: ${name}`);
  }
  return name;
}

function sanitizeColumnName(name: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Invalid column name: ${name}`);
  }
  return name;
}

const datasetAliases: Record<string, string[]> = {
  alertsettings: ["alerts", "alert settings"],
  emergencycontacts: ["contacts", "emergency contacts"],
  incidentdetails: ["incident details"],
  locationrecords: ["locations", "location records"],
  riskassessments: ["risk assessments", "assessments"],
  safetysettings: ["safety settings"],
  sensorreadings: ["sensors", "sensor readings", "readings"],
  userprofiles: ["profiles", "user profiles"],
};

function findRequestedTable(
  tables: string[],
  query: string
): string | undefined {
  const normalizedQuery = query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return tables.find(table => {
    const words = table.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    const candidates = [words, ...(datasetAliases[table.toLowerCase()] ?? [])];
    return candidates.some(candidate => {
      const normalizedCandidate = candidate
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
      return ` ${normalizedQuery} `.includes(` ${normalizedCandidate} `);
    });
  });
}

async function getTableCounts(pool: Pool, tables: string[]) {
  return Promise.all(
    tables.map(async table => {
      const safeTable = sanitizeTableName(table);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM \`${safeTable}\``
      );
      return { table: safeTable, records: Number(rows[0]?.total ?? 0) };
    })
  );
}

function pickDefaultTable(
  tableCounts: { table: string; records: number }[]
): string | undefined {
  const populated = tableCounts.filter(item => item.records > 0);
  populated.sort((left, right) => {
    const leftSystem = /user|profile|setting|auth|session|migration/i.test(
      left.table
    );
    const rightSystem = /user|profile|setting|auth|session|migration/i.test(
      right.table
    );
    return (
      Number(leftSystem) - Number(rightSystem) ||
      right.records - left.records ||
      left.table.localeCompare(right.table)
    );
  });
  return populated[0]?.table;
}

function getOrderColumn(columns: string[]): string {
  const preferred = [
    "createdAt",
    "updatedAt",
    "recordedAt",
    "lastSignedIn",
    "id",
  ];
  return (
    preferred.find(column => columns.includes(column)) ?? columns[0] ?? "id"
  );
}

export async function inspectDataset(
  query: string,
  requestedTable?: string,
  options: { page?: number; search?: string } = {}
): Promise<DatasetInspectionResult> {
  const pool = await getMysqlPool();
  if (!pool) {
    throw new Error(
      "Database connection failed: no MySQL connection could be opened. Set DATABASE_URL to a valid MySQL URL such as mysql://user:pass@127.0.0.1:3306/ai_guardian."
    );
  }

  const [tableRows] = await pool.query<RowDataPacket[]>("SHOW TABLES");
  const availableTables = (tableRows as RowDataPacket[]).map(row => {
    const value = Object.values(row)[0];
    return String(value);
  });

  if (!availableTables.length) {
    throw new Error("The connected database has no tables to inspect.");
  }

  const tableCounts = (await getTableCounts(pool, availableTables)).sort(
    (left, right) =>
      right.records - left.records || left.table.localeCompare(right.table)
  );

  const normalizedQuery = (query || "show all records").trim();
  const lowerQuery = normalizedQuery.toLowerCase();
  const isTableListing =
    /show\s+(the\s+)?(table|tables|database\s+tables|database\s+names)|list\s+(the\s+)?(table|tables)|what\s+tables|database\s+names/i.test(
      normalizedQuery
    );

  if (isTableListing) {
    return {
      dataset: "database",
      selectedTable: null,
      availableTables,
      tableCounts,
      columns: ["table_name", "records"],
      records: tableCounts.map(({ table, records }) => ({
        table_name: table,
        records,
      })),
      totalRecords: availableTables.length,
      message:
        "Available datasets and their record counts in the connected AI Guardian database.",
    };
  }

  const explicitTable = requestedTable
    ? sanitizeTableName(requestedTable)
    : findRequestedTable(availableTables, normalizedQuery);
  if (explicitTable && !availableTables.includes(explicitTable)) {
    throw new Error(
      `Table "${explicitTable}" is not available in the connected database.`
    );
  }
  const isGenericDatasetRequest = /\b(data|dataset|datasets|records)\b/i.test(
    normalizedQuery
  );
  const selectedTable =
    explicitTable ??
    (isGenericDatasetRequest ? pickDefaultTable(tableCounts) : undefined);

  if (!selectedTable) {
    return {
      dataset: "database",
      selectedTable: null,
      availableTables,
      tableCounts,
      columns: [],
      records: [],
      totalRecords: 0,
      message:
        "The database is connected, but no records are currently available.",
    };
  }

  const [columnRows] = await pool.query<RowDataPacket[]>(
    `SHOW COLUMNS FROM \`${selectedTable}\``
  );
  const columns = (columnRows as RowDataPacket[]).map(row => String(row.Field));
  const selectedRecordCount =
    tableCounts.find(item => item.table === selectedTable)?.records ?? 0;

  if (
    /show\s+(the\s+)?structure|describe\s+table|show\s+columns|column names|table\s+structure/i.test(
      normalizedQuery
    )
  ) {
    return {
      dataset: selectedTable,
      selectedTable,
      availableTables,
      tableCounts,
      columns: ["Field", "Type", "Null", "Key", "Default", "Extra"],
      records: (columnRows as RowDataPacket[]).map(column => ({
        Field: column.Field,
        Type: column.Type,
        Null: column.Null,
        Key: column.Key,
        Default: column.Default ?? null,
        Extra: column.Extra,
      })),
      totalRecords: selectedRecordCount,
      message: `Table structure for ${selectedTable}.`,
    };
  }

  const hasCountRequest =
    /count\s+(total\s+)?records|count\s+rows|total\s+records|row\s+count/i.test(
      lowerQuery
    );
  if (hasCountRequest) {
    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM \`${selectedTable}\``
    );
    const totalRecords = Number((countRows as RowDataPacket[])[0]?.total ?? 0);
    return {
      dataset: selectedTable,
      selectedTable,
      availableTables,
      tableCounts,
      columns: ["total_records"],
      records: [{ total_records: totalRecords }],
      totalRecords,
      message: `Total records in ${selectedTable}: ${totalRecords}.`,
    };
  }

  const searchMatch = normalizedQuery.match(
    /(?:search|find|filter)\s+(?:the\s+)?([A-Za-z0-9_]+)\s*(?:for|with|=|:)\s*['"]?([^'"\n]+)?/i
  );
  const fieldFilter = searchMatch?.[1]
    ? sanitizeColumnName(searchMatch[1])
    : undefined;
  const fieldValue = searchMatch?.[2]?.trim();
  const search = options.search?.trim().slice(0, 200);
  const filters: string[] = [];
  const filterParams: string[] = [];
  if (fieldFilter && fieldValue) {
    if (!columns.includes(fieldFilter))
      throw new Error(
        `Column "${fieldFilter}" is not available in ${selectedTable}.`
      );
    filters.push(`CAST(\`${fieldFilter}\` AS CHAR) LIKE ?`);
    filterParams.push(`%${fieldValue}%`);
  }
  if (search) {
    filters.push(
      `(${columns.map(column => `CAST(\`${sanitizeColumnName(column)}\` AS CHAR) LIKE ?`).join(" OR ")})`
    );
    filterParams.push(...columns.map(() => `%${search}%`));
  }
  const whereClause = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";
  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM \`${selectedTable}\`${whereClause}`,
    filterParams
  );
  const totalRecords = Number(countRows[0]?.total ?? 0);
  const requestedLimit = normalizedQuery.match(/(?:first|top)\s+(\d+)/i)?.[1];
  const requestedRecentLimit = normalizedQuery.match(
    /(?:latest|recent|last)\s+(\d+)/i
  )?.[1];
  const appliedLimit = Math.min(
    Number(requestedLimit ?? requestedRecentLimit ?? 100),
    500
  );
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const orderClause = requestedRecentLimit
    ? ` ORDER BY \`${sanitizeColumnName(getOrderColumn(columns))}\` DESC`
    : "";
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM \`${selectedTable}\`${whereClause}${orderClause} LIMIT ? OFFSET ?`,
    [...filterParams, appliedLimit, (page - 1) * appliedLimit]
  );
  const records = (rows as RowDataPacket[]).map(row => {
    const normalizedRow: DatasetRow = {};
    for (const [key, value] of Object.entries(row)) {
      normalizedRow[key] = value == null ? null : value;
    }
    return normalizedRow;
  });

  const defaultMessage = `Dataset: ${selectedTable} | Total Records: ${totalRecords}`;

  return {
    dataset: selectedTable,
    selectedTable,
    availableTables,
    tableCounts,
    columns: columns.length ? columns : Object.keys(records[0] ?? {}),
    records,
    totalRecords,
    message: defaultMessage,
    pagination: {
      page,
      limit: appliedLimit,
      totalRecords,
      hasMore: page * appliedLimit < totalRecords,
    },
  };
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function persistRiskAssessment(input: {
  deviceId: string;
  riskScore: number;
  riskLevel: string;
  confidence: string;
  factors: unknown;
  explanation: string;
  recordedAt: Date;
}) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(riskAssessments).values({
      deviceId: input.deviceId,
      riskScore: input.riskScore,
      riskLevel: input.riskLevel,
      confidence: input.confidence,
      factors: JSON.stringify(input.factors),
      explanation: input.explanation,
      recordedAt: input.recordedAt,
    });
  } catch (error) {
    console.warn("[Database] Risk assessment persistence skipped:", error);
  }
}

export async function persistIncident(input: {
  incidentId: string;
  riskScore: number;
  riskLevel: string;
  trigger: string;
  location: string;
  sensorSummary: string;
  responseStatus: string;
  createdAt: Date;
}) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(incidents).values(input);
  } catch (error) {
    console.warn("[Database] Incident persistence skipped:", error);
  }
}

export async function upsertProfileForUser(
  userId: number,
  input: {
    fullName?: string;
    displayName?: string;
    email?: string | null;
    phone?: string | null;
    age?: number | null;
    bloodGroup?: string | null;
    medicalInfo?: string | null;
    homeLocation?: string | null;
    profilePhoto?: string | null;
  }
) {
  const db = await getDb();
  if (!db) return undefined;

  const values = {
    userId,
    fullName: input.fullName ?? "",
    displayName: input.displayName ?? "",
    email: input.email ?? null,
    phone: input.phone ?? null,
    age: input.age ?? null,
    bloodGroup: input.bloodGroup ?? null,
    medicalInfo: input.medicalInfo ?? null,
    homeLocation: input.homeLocation ?? null,
    profilePhoto: input.profilePhoto ?? null,
    updatedAt: new Date(),
  };

  const existing = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  if (existing.length) {
    const updatedValues = {
      ...values,
      phone: input.phone === undefined ? existing[0]!.phone : input.phone,
      ...(input.phone !== undefined && input.phone !== existing[0]!.phone
        ? { phoneVerifiedAt: null }
        : {}),
    };
    await db
      .update(userProfiles)
      .set(updatedValues)
      .where(eq(userProfiles.userId, userId));
    return (
      await db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .limit(1)
    )[0];
  }

  await db.insert(userProfiles).values({ ...values, createdAt: new Date() });
  return (
    await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1)
  )[0];
}

export async function getProfileForUser(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  return result[0];
}

export async function upsertContactForUser(
  userId: number,
  input: {
    id?: number;
    name: string;
    relationship: string;
    phone: string;
    priority: "PRIMARY" | "SECONDARY" | "TERTIARY";
    enabled: boolean;
    notificationPreference?: string;
  }
) {
  const db = await getDb();
  if (!db) return undefined;
  const priorityValue =
    { PRIMARY: 1, SECONDARY: 2, TERTIARY: 3 }[input.priority] ?? 1;

  if (input.id) {
    const [existing] = await db
      .select()
      .from(emergencyContacts)
      .where(
        and(
          eq(emergencyContacts.id, input.id),
          eq(emergencyContacts.userId, userId)
        )
      )
      .limit(1);
    if (!existing) return undefined;
    await db
      .update(emergencyContacts)
      .set({
        name: input.name,
        relationship: input.relationship,
        phone: input.phone,
        priority: priorityValue,
        enabled: input.enabled ? 1 : 0,
        notificationPreference: input.notificationPreference ?? "SMS",
        phoneVerifiedAt:
          input.phone === existing.phone ? existing.phoneVerifiedAt : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(emergencyContacts.id, input.id),
          eq(emergencyContacts.userId, userId)
        )
      );
    return (
      await db
        .select()
        .from(emergencyContacts)
        .where(
          and(
            eq(emergencyContacts.id, input.id),
            eq(emergencyContacts.userId, userId)
          )
        )
        .limit(1)
    )[0];
  }

  const created = await db.insert(emergencyContacts).values({
    userId,
    name: input.name,
    relationship: input.relationship,
    phone: input.phone,
    priority: priorityValue,
    enabled: input.enabled ? 1 : 0,
    notificationPreference: input.notificationPreference ?? "SMS",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const createdId = Number((created as { insertId?: number }).insertId ?? 0);
  return createdId
    ? (
        await db
          .select()
          .from(emergencyContacts)
          .where(
            and(
              eq(emergencyContacts.id, createdId),
              eq(emergencyContacts.userId, userId)
            )
          )
          .limit(1)
      )[0]
    : undefined;
}

export async function listContactsForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(emergencyContacts)
    .where(eq(emergencyContacts.userId, userId));
}

export async function deleteContactForUser(userId: number, contactId: number) {
  const db = await getDb();
  if (!db) return false;
  const result = await db
    .delete(emergencyContacts)
    .where(
      and(
        eq(emergencyContacts.id, contactId),
        eq(emergencyContacts.userId, userId)
      )
    );
  return Number(result[0].affectedRows ?? 0) > 0;
}

export async function upsertSafetySettingsForUser(
  userId: number,
  input: {
    fallDetection?: boolean;
    automaticEscalation?: boolean;
    safetyVerificationTimer?: number;
    emergencyCountdown?: number;
    severeEventTimer?: number;
    postFallMonitoring?: boolean;
    persistentMonitoring?: boolean;
    severeEventDetection?: boolean;
    safetyMode?: "NORMAL" | "HIGH SENSITIVITY";
  }
) {
  const db = await getDb();
  if (!db) return undefined;
  const values = {
    userId,
    fallDetection:
      input.fallDetection === undefined
        ? undefined
        : input.fallDetection
          ? 1
          : 0,
    automaticEscalation:
      input.automaticEscalation === undefined
        ? undefined
        : input.automaticEscalation
          ? 1
          : 0,
    safetyVerificationTimer: input.safetyVerificationTimer ?? 20,
    emergencyCountdown: input.emergencyCountdown ?? 10,
    severeEventTimer: input.severeEventTimer ?? 10,
    postFallMonitoring:
      input.postFallMonitoring === undefined
        ? undefined
        : input.postFallMonitoring
          ? 1
          : 0,
    persistentMonitoring:
      input.persistentMonitoring === undefined
        ? undefined
        : input.persistentMonitoring
          ? 1
          : 0,
    severeEventDetection:
      input.severeEventDetection === undefined
        ? undefined
        : input.severeEventDetection
          ? 1
          : 0,
    safetyMode: input.safetyMode ?? "NORMAL",
    updatedAt: new Date(),
  };

  const existing = await db
    .select()
    .from(safetySettings)
    .where(eq(safetySettings.userId, userId))
    .limit(1);
  if (existing.length) {
    await db
      .update(safetySettings)
      .set(values)
      .where(eq(safetySettings.userId, userId));
    return (
      await db
        .select()
        .from(safetySettings)
        .where(eq(safetySettings.userId, userId))
        .limit(1)
    )[0];
  }

  await db.insert(safetySettings).values({ ...values, createdAt: new Date() });
  return (
    await db
      .select()
      .from(safetySettings)
      .where(eq(safetySettings.userId, userId))
      .limit(1)
  )[0];
}

export async function getSafetySettingsForUser(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(safetySettings)
    .where(eq(safetySettings.userId, userId))
    .limit(1);
  return result[0];
}

export async function upsertAlertSettingsForUser(
  userId: number,
  input: {
    sound?: boolean;
    vibration?: boolean;
    visualAlerts?: boolean;
    volume?: number;
  }
) {
  const db = await getDb();
  if (!db) return undefined;
  const values = {
    userId,
    sound: input.sound === undefined ? undefined : input.sound ? 1 : 0,
    vibration:
      input.vibration === undefined ? undefined : input.vibration ? 1 : 0,
    visualAlerts:
      input.visualAlerts === undefined ? undefined : input.visualAlerts ? 1 : 0,
    volume: input.volume ?? 70,
    updatedAt: new Date(),
  };

  const existing = await db
    .select()
    .from(alertSettings)
    .where(eq(alertSettings.userId, userId))
    .limit(1);
  if (existing.length) {
    await db
      .update(alertSettings)
      .set(values)
      .where(eq(alertSettings.userId, userId));
    return (
      await db
        .select()
        .from(alertSettings)
        .where(eq(alertSettings.userId, userId))
        .limit(1)
    )[0];
  }

  await db.insert(alertSettings).values({ ...values, createdAt: new Date() });
  return (
    await db
      .select()
      .from(alertSettings)
      .where(eq(alertSettings.userId, userId))
      .limit(1)
  )[0];
}

export async function getAlertSettingsForUser(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(alertSettings)
    .where(eq(alertSettings.userId, userId))
    .limit(1);
  return result[0];
}

export async function upsertDeviceConfigForUser(
  userId: number,
  input: {
    deviceId?: string;
    deviceName?: string;
    connectionStatus?: "Connected" | "Disconnected";
    battery?: number;
    firmware?: string;
    lastSync?: Date | string;
  }
) {
  const db = await getDb();
  if (!db) return undefined;
  const existing = await db
    .select()
    .from(devices)
    .where(eq(devices.deviceId, input.deviceId ?? "AG-001"))
    .limit(1);
  if (existing.length) {
    await db
      .update(devices)
      .set({
        name: input.deviceName ?? existing[0].name,
        connectionState:
          input.connectionStatus === "Disconnected"
            ? "disconnected"
            : "connected",
        battery: input.battery ?? existing[0].battery,
        firmware: input.firmware ?? existing[0].firmware ?? "Demo / Simulation",
        lastSyncAt: new Date(
          input.lastSync ?? existing[0].lastSyncAt ?? Date.now()
        ),
      })
      .where(eq(devices.deviceId, input.deviceId ?? "AG-001"));
    return (
      await db
        .select()
        .from(devices)
        .where(eq(devices.deviceId, input.deviceId ?? "AG-001"))
        .limit(1)
    )[0];
  }

  await db.insert(devices).values({
    deviceId: input.deviceId ?? "AG-001",
    name: input.deviceName ?? "AI Guardian Band",
    connectionState:
      input.connectionStatus === "Disconnected" ? "disconnected" : "connected",
    battery: input.battery ?? 87,
    firmware: input.firmware ?? "Demo / Simulation",
    lastSyncAt: new Date(input.lastSync ?? Date.now()),
    createdAt: new Date(),
  });
  return (
    await db
      .select()
      .from(devices)
      .where(eq(devices.deviceId, input.deviceId ?? "AG-001"))
      .limit(1)
  )[0];
}

export async function getDeviceConfigForUser(deviceId = "AG-001") {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(devices)
    .where(eq(devices.deviceId, deviceId))
    .limit(1);
  return result[0];
}

export async function persistIncidentDetail(input: {
  incidentId: string;
  userResponse?: string;
  riskFactors?: string[];
  sensorSnapshot?: string;
  locationStatus?: string;
  contactProcessing?: string[];
  notificationStatus?: string;
  responseDuration?: string;
  resolution?: string;
  timeline?: string[];
}) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(incidentDetails).values({
      incidentId: input.incidentId,
      userResponse: input.userResponse ?? null,
      riskFactors: input.riskFactors ? JSON.stringify(input.riskFactors) : null,
      sensorSnapshot: input.sensorSnapshot ?? null,
      locationStatus: input.locationStatus ?? "Simulated",
      contactProcessing: input.contactProcessing
        ? JSON.stringify(input.contactProcessing)
        : null,
      notificationStatus:
        input.notificationStatus ?? "Demo notification prepared",
      responseDuration: input.responseDuration ?? null,
      resolution: input.resolution ?? "Recorded",
      timeline: input.timeline ? JSON.stringify(input.timeline) : null,
      createdAt: new Date(),
    });
  } catch (error) {
    console.warn("[Database] Incident detail persistence skipped:", error);
  }
}

export async function listIncidentDetailById(incidentId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(incidentDetails)
    .where(eq(incidentDetails.incidentId, incidentId))
    .limit(1);
  return result[0];
}
