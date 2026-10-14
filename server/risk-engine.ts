export type Scenario =
  | "normal"
  | "running"
  | "impact"
  | "fall"
  | "distress"
  | "emergency";
export type RiskLevel =
  | "SAFE"
  | "MONITORING"
  | "POSSIBLE DISTRESS"
  | "HIGH RISK";

export type TelemetryInput = {
  deviceId: string;
  timestamp: string;
  heartRate: number;
  accelX: number;
  accelY: number;
  accelZ: number;
  gyroX: number;
  gyroY: number;
  gyroZ: number;
  movement: string;
  fallDetected: boolean;
  latitude: number;
  longitude: number;
  battery: number;
  connected?: boolean;
  scenario: Scenario;
};

export type RiskFactor = { name: string; contribution: number };
export type RiskAssessment = {
  riskScore: number;
  riskLevel: RiskLevel;
  confidence: "DEMO";
  factors: RiskFactor[];
  explanation: string;
  timestamp: string;
  medicallyValidated: false;
};

export const RISK_CONFIG = {
  thresholds: { safe: 29, monitoring: 59, distress: 79 },
  weights: {
    heartRateDeviation: 12,
    accelerationAnomaly: 18,
    gyroscopeAnomaly: 12,
    fallDetection: 32,
    postFallInactivity: 25,
    movementAnomaly: 15,
    persistence: 10,
    sensorConsistency: 8,
    severeEvent: 10,
  },
  demo: { countdownSeconds: 5, maxHistory: 120, fallVerificationSeconds: 20, severeFallVerificationSeconds: 10 },
  scenarioBase: {
    normal: 8,
    running: 22,
    impact: 30,
    fall: -3,
    distress: 46,
    emergency: 8,
  },
} as const;

const profiles: Record<
  Scenario,
  Omit<
    TelemetryInput,
    | "deviceId"
    | "timestamp"
    | "latitude"
    | "longitude"
    | "battery"
    | "connected"
  >
> = {
  normal: {
    scenario: "normal",
    heartRate: 78,
    accelX: 0.2,
    accelY: 0.3,
    accelZ: 0.8,
    gyroX: 0.1,
    gyroY: 0.1,
    gyroZ: 0.4,
    movement: "Normal",
    fallDetected: false,
  },
  running: {
    scenario: "running",
    heartRate: 128,
    accelX: 1.2,
    accelY: 1.0,
    accelZ: 1.5,
    gyroX: 1.0,
    gyroY: 0.8,
    gyroZ: 1.3,
    movement: "Running",
    fallDetected: false,
  },
  impact: {
    scenario: "impact",
    heartRate: 104,
    accelX: 3.2,
    accelY: 2.4,
    accelZ: 3.5,
    gyroX: 1.8,
    gyroY: 1.5,
    gyroZ: 2.4,
    movement: "Abnormal",
    fallDetected: false,
  },
  fall: {
    scenario: "fall",
    heartRate: 112,
    accelX: 4.0,
    accelY: 3.7,
    accelZ: 4.2,
    gyroX: 2.8,
    gyroY: 2.4,
    gyroZ: 3.1,
    movement: "Inactivity after impact",
    fallDetected: true,
  },
  distress: {
    scenario: "distress",
    heartRate: 118,
    accelX: 1.8,
    accelY: 1.5,
    accelZ: 2.0,
    gyroX: 1.5,
    gyroY: 1.2,
    gyroZ: 1.9,
    movement: "Erratic",
    fallDetected: false,
  },
  emergency: {
    scenario: "emergency",
    heartRate: 138,
    accelX: 4.4,
    accelY: 4.0,
    accelZ: 4.8,
    gyroX: 3.4,
    gyroY: 3.0,
    gyroZ: 3.8,
    movement: "Critical pattern",
    fallDetected: true,
  },
};

export function scenarioTelemetry(
  scenario: Scenario,
  previous?: TelemetryInput
): TelemetryInput {
  const profile = profiles[scenario];
  const drift =
    previous?.scenario === scenario ? (scenario === "normal" ? 0.04 : 0.12) : 0;
  const vary = (value: number) =>
    Number((value + (Math.random() - 0.5) * drift).toFixed(2));
  return {
    ...profile,
    deviceId: previous?.deviceId ?? "AG-001",
    timestamp: new Date().toISOString(),
    latitude: Number(
      (
        (previous?.latitude ?? 16.7049) +
        (scenario === "running" ? 0.00008 : 0.00001)
      ).toFixed(6)
    ),
    longitude: Number(
      (
        (previous?.longitude ?? 74.2433) +
        (scenario === "running" ? 0.00006 : 0.00001)
      ).toFixed(6)
    ),
    battery: Math.max(0, previous?.battery ?? 87),
    connected: previous?.connected ?? true,
    heartRate: Math.round(
      profile.heartRate +
        (Math.random() - 0.5) * (scenario === "normal" ? 4 : 8)
    ),
    accelX: vary(profile.accelX),
    accelY: vary(profile.accelY),
    accelZ: vary(profile.accelZ),
    gyroX: vary(profile.gyroX),
    gyroY: vary(profile.gyroY),
    gyroZ: vary(profile.gyroZ),
  };
}

function magnitude(x: number, y: number, z: number) {
  return Math.sqrt(x * x + y * y + z * z);
}

export function detectFallEvidence(
  reading: TelemetryInput,
  history: TelemetryInput[] = []
): {
  isLikelyFall: boolean;
  isSevereEvent: boolean;
  factors: string[];
  signalCount: number;
} {
  const acceleration = magnitude(reading.accelX, reading.accelY, reading.accelZ);
  const gyro = magnitude(reading.gyroX, reading.gyroY, reading.gyroZ);
  const recent = history.slice(-5);
  const movementText = reading.movement.toLowerCase();
  const factors: string[] = [];

  if (acceleration >= 4.0) factors.push("acceleration anomaly");
  if (gyro >= 2.5) factors.push("orientation anomaly");
  if (reading.fallDetected) factors.push("fall-like movement");
  if (movementText.includes("inactivity") || movementText.includes("critical"))
    factors.push("post-impact inactivity");
  if (["abnormal", "erratic", "critical pattern"].includes(movementText))
    factors.push("movement anomaly");
  if (
    recent.filter(item => {
      const tracked = item.movement.toLowerCase();
      return tracked.includes("inactivity") || tracked.includes("abnormal") || tracked.includes("critical") || tracked.includes("erratic");
    }).length >= 2
  )
    factors.push("persistent abnormal activity");

  const uniqueFactors = Array.from(new Set(factors));
  const signalCount = uniqueFactors.length;
  const isLikelyFall =
    signalCount >= 3 &&
    (reading.fallDetected || acceleration >= 4 || gyro >= 2.5) &&
    (
      movementText.includes("inactivity") ||
      movementText.includes("impact") ||
      movementText.includes("critical") ||
      movementText.includes("fall")
    );
  const severeSignals = [
    acceleration >= 6,
    gyro >= 4,
    reading.heartRate >= 125,
    (reading.fallDetected && /critical|inactivity/.test(movementText)),
    recent.filter(item => item.movement.toLowerCase().includes("inactivity")).length >= 2,
  ].filter(Boolean).length;
  const isSevereEvent = isLikelyFall && severeSignals >= 3;

  return {
    isLikelyFall,
    isSevereEvent,
    factors: uniqueFactors,
    signalCount,
  };
}

export function getSafetyWindowSeconds(
  reading: TelemetryInput,
  history: TelemetryInput[] = []
): number {
  const evidence = detectFallEvidence(reading, history);
  return evidence.isSevereEvent
    ? RISK_CONFIG.demo.severeFallVerificationSeconds
    : evidence.isLikelyFall
      ? RISK_CONFIG.demo.fallVerificationSeconds
      : RISK_CONFIG.demo.fallVerificationSeconds;
}

export function assessRisk(
  reading: TelemetryInput,
  history: TelemetryInput[] = []
): RiskAssessment {
  const acceleration = magnitude(
    reading.accelX,
    reading.accelY,
    reading.accelZ
  );
  const gyro = magnitude(reading.gyroX, reading.gyroY, reading.gyroZ);
  const recent = history.slice(-5);
  const evidence = detectFallEvidence(reading, history);
  const factors: RiskFactor[] = [];
  const add = (name: string, contribution: number) =>
    factors.push({ name, contribution });

  if (reading.heartRate > 120 && reading.scenario !== "running")
    add("Elevated heart rate", RISK_CONFIG.weights.heartRateDeviation);
  if (acceleration > 4)
    add("Acceleration anomaly", RISK_CONFIG.weights.accelerationAnomaly);
  if (gyro > 4) add("Gyroscope anomaly", RISK_CONFIG.weights.gyroscopeAnomaly);
  if (evidence.isLikelyFall)
    add("Fall-like movement", RISK_CONFIG.weights.fallDetection);
  if (
    evidence.isLikelyFall &&
    (reading.movement.toLowerCase().includes("inactivity") ||
      reading.movement.toLowerCase().includes("critical"))
  )
    add("Post-impact inactivity", RISK_CONFIG.weights.postFallInactivity);
  if (["Abnormal", "Erratic", "Critical pattern"].includes(reading.movement))
    add("Movement anomaly", RISK_CONFIG.weights.movementAnomaly);
  if (
    recent.filter(
      item => item.movement !== "Normal" && item.movement !== "Running"
    ).length >= 3
  )
    add("Persistent abnormal activity", RISK_CONFIG.weights.persistence);
  if (Math.abs(acceleration - gyro) > 4 && !evidence.isLikelyFall)
    add("Sensor variance", RISK_CONFIG.weights.sensorConsistency);
  if (evidence.isSevereEvent)
    add("Severe-event indicators", RISK_CONFIG.weights.severeEvent);

  const rawScore =
    RISK_CONFIG.scenarioBase[reading.scenario] +
    factors.reduce((sum, factor) => sum + factor.contribution, 0);
  const baseRiskScore = evidence.isLikelyFall ? 82 : rawScore;
  const score =
    reading.scenario === "emergency"
      ? 100
      : Math.min(100, Math.max(0, baseRiskScore));
  const riskLevel: RiskLevel =
    score <= RISK_CONFIG.thresholds.safe
      ? "SAFE"
      : score <= RISK_CONFIG.thresholds.monitoring
        ? "MONITORING"
        : score <= RISK_CONFIG.thresholds.distress
          ? "POSSIBLE DISTRESS"
          : "HIGH RISK";
  const explanation =
    riskLevel === "SAFE"
      ? "Signals are stable and no abnormal pattern is persistent."
      : `${factors.map(factor => factor.name.toLowerCase()).join(", ") || "Recent sensor changes"} contributed to this prototype score.`;
  return {
    riskScore: score,
    riskLevel,
    confidence: "DEMO",
    factors,
    explanation,
    timestamp: reading.timestamp,
    medicallyValidated: false,
  };
}

export function riskToLegacy(assessment: RiskAssessment) {
  return {
    score: assessment.riskScore,
    level: assessment.riskLevel,
    explanation: assessment.explanation,
    factors: assessment.factors.map(factor =>
      factor.name === "Fall-like movement" ? "Fall-like pattern" : factor.name
    ),
  };
}
