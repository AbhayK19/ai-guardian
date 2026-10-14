import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type ProfilePriority = "PRIMARY" | "SECONDARY" | "TERTIARY";

export type UserProfile = {
  fullName: string;
  displayName: string;
  email: string;
  phone: string;
  age: string;
  bloodGroup?: string;
  medicalInfo?: string;
  homeLocation?: string;
  profilePhoto?: string;
};

export type EmergencyContact = {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  priority: ProfilePriority;
  enabled: boolean;
  notificationPreference: string;
  createdAt: string;
  updatedAt: string;
};

export type SafetySettings = {
  fallDetection: boolean;
  automaticEscalation: boolean;
  safetyVerificationTimer: number;
  emergencyCountdown: number;
  severeEventTimer: number;
  postFallMonitoring: boolean;
  persistentMonitoring: boolean;
  severeEventDetection: boolean;
  safetyMode: "NORMAL" | "HIGH SENSITIVITY";
};

export type PersistedIncident = {
  id: string;
  eventType: string;
  riskLevel: string;
  riskScore: number;
  timestamp: string;
  locationStatus: string;
  userResponse: string;
  resolution: string;
  responseStatus: string;
  notificationStatus: string;
  emergencyContacts: string[];
  trigger?: string;
  location?: string;
  sensorSummary?: string;
  detectionFactors?: string[];
};

export type AlertSettings = {
  sound: boolean;
  vibration: boolean;
  visualAlerts: boolean;
  volume: number;
};

export type DeviceDefinition = {
  deviceId: string;
  deviceName: string;
  connectionStatus: "Connected" | "Disconnected";
  battery: number;
  lastSync: string;
  firmware: string;
  status: "Available" | "Unavailable" | "Simulation";
  sensors: {
    accelerometer: "Available" | "Unavailable" | "Simulation";
    gyroscope: "Available" | "Unavailable" | "Simulation";
    heartRate: "Available" | "Unavailable" | "Simulation";
    gps: "Available" | "Unavailable" | "Simulation";
  };
};

export type NotificationPlan = {
  notificationType: "DEMO NOTIFICATION";
  recipients: EmergencyContact[];
  warning?: string;
  message: string;
};

export const DEFAULT_PROFILE: UserProfile = {
  fullName: "Alex Rivera",
  displayName: "Alex",
  email: "alex@example.com",
  phone: "+1 (415) 555-0102",
  age: "21",
  bloodGroup: "O+",
  medicalInfo: "No known allergies.",
  homeLocation: "San Francisco, CA",
  profilePhoto: "AR",
};

export const DEFAULT_CONTACTS: EmergencyContact[] = [
  {
    id: "contact-1",
    name: "Anita Sharma",
    relationship: "Mother",
    phone: "+91 98765 43210",
    priority: "PRIMARY",
    enabled: true,
    notificationPreference: "SMS",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "contact-2",
    name: "Rohan Mehta",
    relationship: "Friend",
    phone: "+91 99887 66554",
    priority: "SECONDARY",
    enabled: true,
    notificationPreference: "SMS",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const DEFAULT_SAFETY_SETTINGS: SafetySettings = {
  fallDetection: true,
  automaticEscalation: true,
  safetyVerificationTimer: 20,
  emergencyCountdown: 10,
  severeEventTimer: 10,
  postFallMonitoring: true,
  persistentMonitoring: true,
  severeEventDetection: true,
  safetyMode: "NORMAL",
};

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  sound: true,
  vibration: true,
  visualAlerts: true,
  volume: 70,
};

export const DEFAULT_DEVICE: DeviceDefinition = {
  deviceId: "AG-001",
  deviceName: "AI Guardian Band",
  connectionStatus: "Connected",
  battery: 87,
  lastSync: new Date().toISOString(),
  firmware: "Demo / Simulation",
  status: "Simulation",
  sensors: {
    accelerometer: "Simulation",
    gyroscope: "Simulation",
    heartRate: "Simulation",
    gps: "Simulation",
  },
};

export function validateProfilePhone(value: string): boolean {
  if (!value || !value.trim()) return false;
  return /^\+?[0-9()\-\s.]{8,}$/.test(value.trim());
}

export function validateProfile(input: Partial<UserProfile>) {
  const errors: Record<string, string> = {};

  if (!input.fullName || !input.fullName.trim()) {
    errors.fullName = "Name is required.";
  }

  if (input.email && input.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    errors.email = "Please provide a valid email format.";
  }

  if (input.phone && input.phone.trim() && !validateProfilePhone(input.phone)) {
    errors.phone = "Please provide a reasonable phone number.";
  }

  if (input.age !== undefined && input.age !== null && String(input.age).trim() !== "") {
    const ageString = typeof input.age === "string" ? input.age.trim() : String(input.age).trim();
    const ageNumber = Number(ageString);
    if (!Number.isFinite(ageNumber) || ageNumber < 1 || ageNumber > 120) {
      errors.age = "Age must be a realistic value.";
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function getEnabledContactsSorted(contacts: EmergencyContact[]) {
  return [...contacts]
    .filter(contact => contact.enabled)
    .sort((a, b) => {
      const priorityWeight: Record<ProfilePriority, number> = {
        PRIMARY: 0,
        SECONDARY: 1,
        TERTIARY: 2,
      };
      return priorityWeight[a.priority] - priorityWeight[b.priority];
    });
}

export function buildEmergencyNotificationPlan(contacts: EmergencyContact[]): NotificationPlan {
  const recipients = getEnabledContactsSorted(contacts);

  if (!recipients.length) {
    return {
      notificationType: "DEMO NOTIFICATION",
      recipients: [],
      warning: "⚠ NO EMERGENCY CONTACTS CONFIGURED",
      message: "No real message was sent.",
    };
  }

  return {
    notificationType: "DEMO NOTIFICATION",
    recipients,
    message: "No real message was sent.",
  };
}

export type Phase4Store = {
  profile: UserProfile;
  contacts: EmergencyContact[];
  safetySettings: SafetySettings;
  alertSettings: AlertSettings;
  device: DeviceDefinition;
  incidents: PersistedIncident[];
};

const PHASE4_DATA_FILE = path.resolve(process.cwd(), "server", ".phase4-data.json");

export const DEFAULT_PHASE4_STORE: Phase4Store = {
  profile: DEFAULT_PROFILE,
  contacts: DEFAULT_CONTACTS,
  safetySettings: DEFAULT_SAFETY_SETTINGS,
  alertSettings: DEFAULT_ALERT_SETTINGS,
  device: DEFAULT_DEVICE,
  incidents: [],
};

export function readPhase4Store(): Phase4Store {
  try {
    if (!existsSync(PHASE4_DATA_FILE)) {
      writePhase4Store(DEFAULT_PHASE4_STORE);
      return DEFAULT_PHASE4_STORE;
    }
    const raw = readFileSync(PHASE4_DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<Phase4Store>;
    return {
      profile: { ...DEFAULT_PROFILE, ...(parsed.profile ?? {}) },
      contacts: Array.isArray(parsed.contacts) && parsed.contacts.length ? parsed.contacts : DEFAULT_CONTACTS,
      safetySettings: { ...DEFAULT_SAFETY_SETTINGS, ...(parsed.safetySettings ?? {}) },
      alertSettings: { ...DEFAULT_ALERT_SETTINGS, ...(parsed.alertSettings ?? {}) },
      device: { ...DEFAULT_DEVICE, ...(parsed.device ?? {}) },
      incidents: Array.isArray(parsed.incidents) ? parsed.incidents : [],
    };
  } catch (error) {
    console.warn("[Phase 4] Failed to read persisted state, falling back to defaults.", error);
    return DEFAULT_PHASE4_STORE;
  }
}

export function writePhase4Store(next: Phase4Store) {
  try {
    const dir = path.dirname(PHASE4_DATA_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(PHASE4_DATA_FILE, JSON.stringify(next, null, 2), "utf8");
    return next;
  } catch (error) {
    console.warn("[Phase 4] Failed to persist state.", error);
    return next;
  }
}
