import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  Bell,
  BrainCircuit,
  Check,
  ChevronRight,
  Circle,
  Clock3,
  Cpu,
  Crosshair,
  Gauge,
  HeartPulse,
  Home as HomeIcon,
  Layers3,
  MapPin,
  Menu,
  MoreHorizontal,
  Navigation,
  Network,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Route,
  Search,
  Settings,
  Shield,
  Smartphone,
  Siren,
  UserRound,
  Users,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { RealSafetyPanel } from "@/components/RealSafetyPanel";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Scenario =
  | "normal"
  | "running"
  | "impact"
  | "fall"
  | "distress"
  | "emergency";
type Page =
  | "dashboard"
  | "monitoring"
  | "emergency"
  | "location"
  | "contacts"
  | "device"
  | "incidents"
  | "analysis"
  | "settings"
  | "about";
type RiskLevel = "SAFE" | "MONITORING" | "POSSIBLE DISTRESS" | "HIGH RISK";
type EmergencyState =
  | "safe"
  | "monitoring"
  | "fallDetected"
  | "awaitingResponse"
  | "userSafe"
  | "helpRequested"
  | "emergencyCountdown"
  | "noResponse"
  | "escalating"
  | "confirmed"
  | "responseInProgress"
  | "completed"
  | "cancelled";
type EmergencyTrigger = "fall" | "help" | "noResponse" | "manual";

const FALL_VERIFICATION_SECONDS = 20;
const SEVERE_FALL_VERIFICATION_SECONDS = 10;
const EMERGENCY_COUNTDOWN_SECONDS = 10;

type SensorState = {
  heartRate: number;
  accel: number;
  gyro: number;
  movement: string;
  fall: boolean;
  battery: number;
  latitude: number;
  longitude: number;
  connected: boolean;
  signal: number;
  updatedAt: Date;
};
type Contact = {
  id: number | string;
  name: string;
  relation: string;
  phone: string;
  priority: string;
  enabled: boolean;
  primary?: boolean;
};

type ProfileState = {
  fullName: string;
  displayName: string;
  email: string;
  phone: string;
  age: string;
  bloodGroup?: string;
  medicalInfo?: string;
  homeLocation?: string;
};
type Incident = {
  id: string;
  time: string;
  score: number;
  level: RiskLevel;
  trigger: string;
  location: string;
  response: string;
};

type DatasetQueryResult = {
  dataset: string;
  selectedTable: string | null;
  availableTables: string[];
  tableCounts: { table: string; records: number }[];
  columns: string[];
  records: Record<string, string | number | boolean | null | undefined>[];
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

const navItems: { id: Page; label: string; icon: typeof HomeIcon }[] = [
  { id: "dashboard", label: "Dashboard", icon: HomeIcon },
  { id: "monitoring", label: "Live monitoring", icon: Activity },
  { id: "emergency", label: "Emergency center", icon: Siren },
  { id: "location", label: "Location", icon: MapPin },
  { id: "contacts", label: "Emergency contacts", icon: Users },
  { id: "device", label: "Device", icon: Smartphone },
  { id: "incidents", label: "Incidents", icon: Layers3 },
  { id: "analysis", label: "AI analysis", icon: BrainCircuit },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "about", label: "About project", icon: Shield },
];

const scenarios: { id: Scenario; label: string; short: string }[] = [
  { id: "normal", label: "Normal activity", short: "Normal" },
  { id: "running", label: "Running", short: "Running" },
  { id: "impact", label: "Sudden impact", short: "Impact" },
  { id: "fall", label: "Fall", short: "Fall" },
  { id: "distress", label: "Possible distress", short: "Distress" },
  { id: "emergency", label: "Emergency simulation", short: "Emergency" },
];

const scenarioData: Record<
  Scenario,
  {
    score: number;
    hr: number;
    accel: number;
    gyro: number;
    movement: string;
    fall: boolean;
    level: RiskLevel;
    reason: string;
    factors: string[];
  }
> = {
  normal: {
    score: 18,
    hr: 78,
    accel: 0.9,
    gyro: 0.5,
    movement: "Normal",
    fall: false,
    level: "SAFE",
    reason:
      "No abnormal activity detected. Sensors are consistent and the device is connected.",
    factors: ["Stable heart rate", "Low movement", "No fall pattern"],
  },
  running: {
    score: 42,
    hr: 128,
    accel: 2.1,
    gyro: 1.7,
    movement: "High activity",
    fall: false,
    level: "MONITORING",
    reason:
      "Elevated activity is consistent with running. Context is required before escalating.",
    factors: ["Elevated heart rate", "High activity", "No impact detected"],
  },
  impact: {
    score: 67,
    hr: 104,
    accel: 4.8,
    gyro: 3.2,
    movement: "Abnormal",
    fall: false,
    level: "POSSIBLE DISTRESS",
    reason:
      "A sudden acceleration spike was detected. Monitoring remains active for follow-up movement.",
    factors: ["Sudden acceleration", "Gyroscope spike", "Abnormal movement"],
  },
  fall: {
    score: 84,
    hr: 112,
    accel: 5.9,
    gyro: 4.3,
    movement: "Inactivity after impact",
    fall: true,
    level: "HIGH RISK",
    reason:
      "The simulator detected a fall-like pattern followed by low movement and elevated heart rate.",
    factors: [
      "Fall-like pattern",
      "Prolonged inactivity",
      "Elevated heart rate",
    ],
  },
  distress: {
    score: 73,
    hr: 118,
    accel: 3.4,
    gyro: 2.6,
    movement: "Erratic",
    fall: false,
    level: "POSSIBLE DISTRESS",
    reason:
      "Elevated heart rate and irregular movement may indicate distress. Verify the user's condition.",
    factors: ["Heart-rate deviation", "Erratic movement", "Sensor variance"],
  },
  emergency: {
    score: 96,
    hr: 138,
    accel: 6.7,
    gyro: 5.4,
    movement: "Critical pattern",
    fall: true,
    level: "HIGH RISK",
    reason:
      "Multiple abnormal signals are present in this demonstration. Emergency workflow is ready to be simulated.",
    factors: [
      "Critical heart rate",
      "Impact + fall pattern",
      "No movement after event",
    ],
  },
};

const initialContacts: Contact[] = [
  {
    id: 1,
    name: "Anita Sharma",
    relation: "Parent",
    phone: "+91 98••• 12742",
    priority: "1st",
    enabled: true,
    primary: true,
  },
  {
    id: 2,
    name: "Rohan Mehta",
    relation: "Friend",
    phone: "+91 90••• 84912",
    priority: "2nd",
    enabled: true,
  },
  {
    id: 3,
    name: "Campus Security",
    relation: "Campus",
    phone: "+91 23••• 60001",
    priority: "3rd",
    enabled: false,
  },
];

const chartSeed = [18, 22, 20, 25, 21, 23, 19, 18, 24, 20, 18, 18];
const timeLabel = (date: Date) =>
  date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const riskClass = (score: number) =>
  score >= 80 ? "danger" : score >= 60 ? "warning" : "safe";
const levelBadge = (level: RiskLevel) =>
  level === "HIGH RISK"
    ? "badge-danger"
    : level === "POSSIBLE DISTRESS"
      ? "badge-warning"
      : level === "MONITORING"
        ? "badge-neutral"
        : "badge-safe";

function Logo() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <Shield size={19} strokeWidth={2.5} />
      </div>
      <div>
        <div className="brand-name">AI Guardian</div>
        <div className="brand-sub">Intelligent protection</div>
      </div>
    </div>
  );
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "safe" | "warning" | "danger" | "neutral";
}) {
  return (
    <span className={`badge badge-${tone}`}>
      <Circle size={6} fill="currentColor" />
      {children}
    </span>
  );
}

function StatCard({
  label,
  value,
  unit,
  foot,
  icon,
}: {
  label: string;
  value: string | number;
  unit?: string;
  foot: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="panel stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <div className="stat-value">
        {value}
        <span className="stat-unit">{unit}</span>
      </div>
      <div className="stat-foot">{foot}</div>
    </div>
  );
}

function ChartTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <p>{label}</p>
      <strong>{payload[0].value} risk</strong>
    </div>
  );
}

export default function Home() {
  const [page, setPage] = useState<Page>("dashboard");
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [sensor, setSensor] = useState<SensorState>(() => ({
    heartRate: 78,
    accel: 0.9,
    gyro: 0.5,
    movement: "Normal",
    fall: false,
    battery: 87,
    latitude: 16.7049,
    longitude: 74.2433,
    connected: true,
    signal: 92,
    updatedAt: new Date(),
  }));
  const [monitoring, setMonitoring] = useState(true);
  const [profile, setProfile] = useState<ProfileState>({
    fullName: "Alex Rivera",
    displayName: "Alex",
    email: "alex@example.com",
    phone: "+1 (415) 555-0102",
    age: "21",
    bloodGroup: "O+",
    medicalInfo: "No known allergies.",
    homeLocation: "San Francisco, CA",
  });
  const [safetySettings, setSafetySettings] = useState<{
    fallDetection: boolean;
    automaticEscalation: boolean;
    safetyVerificationTimer: number;
    emergencyCountdown: number;
    severeEventTimer: number;
    postFallMonitoring: boolean;
    persistentMonitoring: boolean;
    severeEventDetection: boolean;
    safetyMode: "NORMAL" | "HIGH SENSITIVITY";
  }>({
    fallDetection: true,
    automaticEscalation: true,
    safetyVerificationTimer: 20,
    emergencyCountdown: 10,
    severeEventTimer: 10,
    postFallMonitoring: true,
    persistentMonitoring: true,
    severeEventDetection: true,
    safetyMode: "NORMAL",
  });
  const [alertSettings, setAlertSettings] = useState({
    sound: true,
    vibration: true,
    visualAlerts: true,
    volume: 70,
  });
  const [emergencyState, setEmergencyState] = useState<EmergencyState>("safe");
  const [emergencyTrigger, setEmergencyTrigger] =
    useState<EmergencyTrigger | null>(null);
  const [fallCountdown, setFallCountdown] = useState<number | null>(null);
  const [fallVerificationSeconds, setFallVerificationSeconds] = useState(
    FALL_VERIFICATION_SECONDS
  );
  const [emergencyCountdown, setEmergencyCountdown] = useState<number | null>(
    null
  );
  const [alertSoundStatus, setAlertSoundStatus] = useState<
    "inactive" | "blocked" | "active" | "unavailable"
  >("inactive");
  const audioContextRef = useRef<AudioContext | null>(null);
  const alertIntervalRef = useRef<number | null>(null);
  const [showMobileMore, setShowMobileMore] = useState(false);
  const [workflowStep, setWorkflowStep] = useState(0);
  const [incidents, setIncidents] = useState<Incident[]>([
    {
      id: "AG-240918-01",
      time: "Today, 09:42",
      score: 67,
      level: "POSSIBLE DISTRESS",
      trigger: "Sudden impact",
      location: "Demo location",
      response: "Reviewed",
    },
    {
      id: "AG-240917-02",
      time: "Yesterday, 18:10",
      score: 42,
      level: "MONITORING",
      trigger: "Running",
      location: "Demo location",
      response: "No action",
    },
    {
      id: "AG-240915-01",
      time: "Sep 15, 12:26",
      score: 18,
      level: "SAFE",
      trigger: "Normal activity",
      location: "Demo location",
      response: "Logged",
    },
  ]);
  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [contactForm, setContactForm] = useState({
    name: "",
    relation: "",
    phone: "",
  });
  const [showContactForm, setShowContactForm] = useState(false);
  const [search, setSearch] = useState("");
  const [datasetPrompt, setDatasetPrompt] = useState(
    "Show me all the data in my AI Guardian dataset."
  );
  const [datasetResult, setDatasetResult] = useState<DatasetQueryResult | null>(
    null
  );
  const [datasetSearch, setDatasetSearch] = useState("");
  const [locationHistory, setLocationHistory] = useState<
    { time: string; coords: string; accuracy: string }[]
  >([
    { time: "09:48:12", coords: "16.7049, 74.2433", accuracy: "± 12 m" },
    { time: "09:47:57", coords: "16.7047, 74.2431", accuracy: "± 12 m" },
    { time: "09:47:42", coords: "16.7045, 74.2429", accuracy: "± 15 m" },
  ]);
  const data = scenarioData[scenario];
  const [riskHistory, setRiskHistory] = useState(chartSeed);
  const profileQuery = trpc.profile.get.useQuery();
  const profileMutation = trpc.profile.update.useMutation();
  const settingsQuery = trpc.settings.get.useQuery();
  const settingsMutation = trpc.settings.update.useMutation();
  const alertSettingsQuery = trpc.alertSettings.get.useQuery();
  const alertSettingsMutation = trpc.alertSettings.update.useMutation();
  const contactsQuery = trpc.contacts.list.useQuery();
  const contactCreateMutation = trpc.contacts.create.useMutation();
  const contactUpdateMutation = trpc.contacts.update.useMutation();
  const contactRemoveMutation = trpc.contacts.remove.useMutation();
  const deviceConfigQuery = trpc.deviceConfig.get.useQuery();
  const deviceConfigMutation = trpc.deviceConfig.update.useMutation();
  const now = sensor.updatedAt;
  const scenarioMutation = trpc.simulation.scenario.useMutation();
  const telemetryMutation = trpc.telemetry.ingest.useMutation();
  const emergencyMutation = trpc.emergency.activate.useMutation();
  const cancelEmergencyMutation = trpc.emergency.cancel.useMutation();
  const incidentMutation = trpc.incidents.create.useMutation();
  const incidentsQuery = trpc.incidents.list.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const datasetMutation = trpc.database.inspect.useMutation();

  const submitDatasetQuery = (prompt: string, tableName?: string, page = 1) => {
    datasetMutation.mutate(
      { query: prompt, table: tableName, page, search: datasetSearch },
      {
        onSuccess: result => {
          setDatasetResult(result as DatasetQueryResult);
        },
      }
    );
  };

  useEffect(() => {
    if (profileQuery.data) {
      setProfile({
        fullName: profileQuery.data.fullName ?? "",
        displayName: profileQuery.data.displayName ?? "",
        email: profileQuery.data.email ?? "",
        phone: profileQuery.data.phone ?? "",
        age: profileQuery.data.age ?? "",
        bloodGroup: profileQuery.data.bloodGroup ?? "",
        medicalInfo: profileQuery.data.medicalInfo ?? "",
        homeLocation: profileQuery.data.homeLocation ?? "",
      });
    }
  }, [profileQuery.data]);

  useEffect(() => {
    if (settingsQuery.data)
      setSafetySettings(previous => ({ ...previous, ...settingsQuery.data }));
    if (alertSettingsQuery.data)
      setAlertSettings(previous => ({
        ...previous,
        ...alertSettingsQuery.data,
      }));
  }, [settingsQuery.data, alertSettingsQuery.data]);

  useEffect(() => {
    if (!contactsQuery.data) return;
    setContacts(
      contactsQuery.data.map(contact => ({
        id: contact.id,
        name: contact.name,
        relation: contact.relationship,
        phone: contact.phone,
        priority: contact.priority,
        enabled: contact.enabled,
      }))
    );
  }, [contactsQuery.data]);

  useEffect(() => {
    if (!deviceConfigQuery.data) return;
    setSensor(previous => ({
      ...previous,
      connected: deviceConfigQuery.data.connectionStatus === "Connected",
      battery: deviceConfigQuery.data.battery ?? previous.battery,
      updatedAt: deviceConfigQuery.data.lastSync
        ? new Date(deviceConfigQuery.data.lastSync)
        : previous.updatedAt,
    }));
  }, [deviceConfigQuery.data]);

  useEffect(() => {
    if (!incidentsQuery.data?.length) return;
    setIncidents(
      incidentsQuery.data.map(incident => ({
        id: incident.id,
        time: new Date(incident.createdAt).toLocaleString(),
        score: incident.score,
        level: incident.level as RiskLevel,
        trigger: incident.trigger,
        location: incident.location,
        response: incident.responseStatus,
      }))
    );
  }, [incidentsQuery.data]);

  useEffect(() => {
    if (!monitoring) return;
    const interval = window.setInterval(() => {
      const current = scenarioData[scenario];
      const jitter =
        scenario === "normal"
          ? Math.round((Math.random() - 0.5) * 6)
          : Math.round((Math.random() - 0.5) * 10);
      setSensor(previous => ({
        ...previous,
        heartRate: Math.max(55, current.hr + jitter),
        accel: Number(
          Math.max(0.2, current.accel + (Math.random() - 0.5) * 0.35).toFixed(1)
        ),
        gyro: Number(
          Math.max(0.1, current.gyro + (Math.random() - 0.5) * 0.25).toFixed(1)
        ),
        battery: Math.max(
          72,
          previous.battery - (Math.random() > 0.88 ? 1 : 0)
        ),
        updatedAt: new Date(),
      }));
      setRiskHistory(previous => [
        ...previous.slice(-11),
        Math.max(
          0,
          Math.min(100, current.score + Math.round((Math.random() - 0.5) * 7))
        ),
      ]);
      telemetryMutation.mutate({
        deviceId: "AG-001",
        timestamp: new Date().toISOString(),
        heartRate: Math.max(55, current.hr + jitter),
        accelX: current.accel * 0.45,
        accelY: current.accel * 0.35,
        accelZ: current.accel,
        gyroX: current.gyro * 0.45,
        gyroY: current.gyro * 0.35,
        gyroZ: current.gyro,
        movement: current.movement,
        fallDetected: current.fall,
        latitude: sensor.latitude,
        longitude: sensor.longitude,
        battery: sensor.battery,
        connected: sensor.connected,
        scenario,
      });
    }, 3200);
    return () => window.clearInterval(interval);
  }, [monitoring, scenario]);

  useEffect(() => {
    if (fallCountdown === null) return;
    if (fallCountdown === 0) {
      setFallCountdown(null);
      setEmergencyTrigger("noResponse");
      setEmergencyState("noResponse");
      toast.error("No response detected", {
        description: "Safety response is being escalated automatically.",
      });
      return;
    }
    const timeout = window.setTimeout(
      () => setFallCountdown(value => (value === null ? null : value - 1)),
      1000
    );
    return () => window.clearTimeout(timeout);
  }, [fallCountdown]);

  useEffect(() => {
    if (emergencyCountdown === null) return;
    if (emergencyCountdown === 0) {
      setEmergencyCountdown(null);
      setEmergencyState(current =>
        current === "helpRequested" ? "confirmed" : current
      );
      activateEmergency();
      return;
    }
    const timeout = window.setTimeout(
      () => setEmergencyCountdown(value => (value === null ? null : value - 1)),
      1000
    );
    return () => window.clearTimeout(timeout);
  }, [emergencyCountdown]);

  useEffect(() => {
    if (emergencyState !== "noResponse") return;
    const escalate = window.setTimeout(() => {
      setEmergencyState("escalating");
      window.setTimeout(() => {
        setEmergencyTrigger("noResponse");
        activateEmergency();
      }, 900);
    }, 700);
    return () => window.clearTimeout(escalate);
  }, [emergencyState]);

  useEffect(() => {
    const alerting =
      emergencyState === "fallDetected" ||
      emergencyState === "awaitingResponse" ||
      emergencyState === "helpRequested" ||
      emergencyState === "emergencyCountdown" ||
      emergencyState === "noResponse" ||
      emergencyState === "escalating";
    if (!alerting) {
      if (alertIntervalRef.current !== null) {
        window.clearInterval(alertIntervalRef.current);
        alertIntervalRef.current = null;
      }
      if (audioContextRef.current) void audioContextRef.current.suspend();
      setAlertSoundStatus("inactive");
      return;
    }

    if (!alertSettings.sound && audioContextRef.current) {
      void audioContextRef.current.suspend();
      if (alertIntervalRef.current !== null) {
        window.clearInterval(alertIntervalRef.current);
        alertIntervalRef.current = null;
      }
      setAlertSoundStatus("inactive");
    }

    if (alertSettings.vibration && "vibrate" in navigator)
      navigator.vibrate([120, 180, 120, 180, 300]);
    else
      setAlertSoundStatus(previous =>
        previous === "inactive" ? "unavailable" : previous
      );
    return () => {
      if ("vibrate" in navigator) navigator.vibrate(0);
    };
  }, [alertSettings.sound, alertSettings.vibration, emergencyState]);

  const beep = () => {
    const context = audioContextRef.current;
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.value = 0.045;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.16);
  };

  const enableAlertSound = () => {
    if (!alertSettings.sound) {
      setAlertSoundStatus("inactive");
      return;
    }
    try {
      const context = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = context;
      void context.resume().then(() => {
        beep();
        setAlertSoundStatus("active");
        if (alertIntervalRef.current === null) {
          alertIntervalRef.current = window.setInterval(beep, 2400);
        }
      });
    } catch {
      setAlertSoundStatus("blocked");
    }
  };

  const silenceAlert = () => {
    if (alertIntervalRef.current !== null) {
      window.clearInterval(alertIntervalRef.current);
      alertIntervalRef.current = null;
    }
    if (audioContextRef.current) void audioContextRef.current.suspend();
    if (alertSettings.vibration && "vibrate" in navigator) navigator.vibrate(0);
    setAlertSoundStatus("inactive");
  };

  const graphData = useMemo(
    () =>
      riskHistory.map((value, index) => ({
        time: `${9 + Math.floor(index / 4)}:${String((index % 4) * 15).padStart(2, "0")}`,
        value,
      })),
    [riskHistory]
  );
  const filteredIncidents = incidents.filter(item =>
    `${item.id} ${item.trigger} ${item.level}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const changeScenario = (next: Scenario) => {
    setScenario(next);
    const nextData = scenarioData[next];
    setFallCountdown(null);
    setEmergencyCountdown(null);
    setWorkflowStep(0);
    if (next === "fall") {
      setPage("emergency");
      setEmergencyTrigger("fall");
      setEmergencyState("fallDetected");
      const severeFall = false;
      const verificationSeconds = severeFall
        ? safetySettings.severeEventTimer
        : safetySettings.safetyVerificationTimer;
      setFallVerificationSeconds(verificationSeconds);
      setFallCountdown(verificationSeconds);
      setTimeout(() => {
        setEmergencyState("awaitingResponse");
        toast.warning("Are you okay?", {
          description: "Automatic safety escalation is active.",
        });
      }, 500);
    } else if (next === "emergency") {
      setPage("emergency");
      setEmergencyTrigger("fall");
      setEmergencyState("emergencyCountdown");
      setEmergencyCountdown(
        safetySettings.emergencyCountdown ?? EMERGENCY_COUNTDOWN_SECONDS
      );
    } else {
      setEmergencyTrigger(null);
      setEmergencyState(
        nextData.level === "MONITORING" ? "monitoring" : "safe"
      );
    }
    setSensor(previous => ({
      ...previous,
      heartRate: nextData.hr,
      accel: nextData.accel,
      gyro: nextData.gyro,
      movement: nextData.movement,
      fall: nextData.fall,
      updatedAt: new Date(),
    }));
    scenarioMutation.mutate(
      { scenario: next },
      {
        onSuccess: response => {
          setSensor(previous => ({
            ...previous,
            heartRate: response.telemetry.heartRate,
            accel: Number(
              Math.sqrt(
                response.telemetry.accelX ** 2 +
                  response.telemetry.accelY ** 2 +
                  response.telemetry.accelZ ** 2
              ).toFixed(1)
            ),
            gyro: Number(
              Math.sqrt(
                response.telemetry.gyroX ** 2 +
                  response.telemetry.gyroY ** 2 +
                  response.telemetry.gyroZ ** 2
              ).toFixed(1)
            ),
            movement: response.telemetry.movement,
            fall: response.telemetry.fallDetected,
            latitude: response.telemetry.latitude,
            longitude: response.telemetry.longitude,
            updatedAt: new Date(response.telemetry.timestamp),
          }));
          setRiskHistory(previous => [
            ...previous.slice(-11),
            response.risk.score,
          ]);
        },
        onError: () =>
          toast.error("Backend unavailable", {
            description:
              "The local simulator remains visible, but telemetry was not accepted.",
          }),
      }
    );
    if (next === "fall")
      toast.warning("Fall detected: user verification required", {
        description: "No emergency response has been confirmed.",
      });
    else if (next === "emergency")
      toast.warning(`${nextData.level}: demo workflow ready`, {
        description: "No real emergency services are contacted.",
      });
    else
      toast.success(`${nextData.level} scenario active`, {
        description: "Simulated telemetry updated.",
      });
  };

  const beginEmergencyCountdown = (
    reason: string,
    trigger: EmergencyTrigger = "noResponse"
  ) => {
    setPage("emergency");
    setEmergencyTrigger(trigger);
    setEmergencyState(
      trigger === "help" ? "helpRequested" : "emergencyCountdown"
    );
    setEmergencyCountdown(
      safetySettings.emergencyCountdown ?? EMERGENCY_COUNTDOWN_SECONDS
    );
    toast.warning("Potential emergency", {
      description: `${reason}. The system will escalate automatically if there is no response.`,
    });
  };

  const markUserSafe = () => {
    silenceAlert();
    setFallCountdown(null);
    setEmergencyCountdown(null);
    setEmergencyState("userSafe");
    const responseTime = `${fallVerificationSeconds - (fallCountdown ?? 0)}s`;
    setScenario("normal");
    setSensor(previous => ({
      ...previous,
      heartRate: scenarioData.normal.hr,
      accel: scenarioData.normal.accel,
      gyro: scenarioData.normal.gyro,
      movement: "Recovered",
      fall: false,
      updatedAt: new Date(),
    }));
    incidentMutation.mutate(
      {
        score: data.score,
        level: data.level,
        trigger: "Fall detected · user confirmed safe",
        location: `${sensor.latitude}, ${sensor.longitude}`,
        sensorSummary: `${sensor.heartRate} BPM · ${sensor.movement} · ${sensor.accel} g · response ${responseTime}`,
        responseStatus: "Recovered / false alarm",
      },
      {
        onSuccess: incident =>
          setIncidents(previous => [
            {
              id: incident.id,
              time: "Just now",
              score: incident.score,
              level: incident.level as RiskLevel,
              trigger: incident.trigger,
              location: incident.location,
              response: incident.responseStatus,
            },
            ...previous,
          ]),
      }
    );
    toast.success("You're marked safe", {
      description: "Emergency response cancelled.",
    });
  };

  const requestHelp = () => {
    silenceAlert();
    setFallCountdown(null);
    setEmergencyTrigger("help");
    setEmergencyState("helpRequested");
    setEmergencyCountdown(
      safetySettings.emergencyCountdown ?? EMERGENCY_COUNTDOWN_SECONDS
    );
    setPage("emergency");
    toast.warning("Help requested", {
      description: "Preparing emergency response automatically.",
    });
  };

  const confirmHelp = () => {
    setEmergencyCountdown(null);
    activateEmergency();
  };

  const activateEmergency = () => {
    const trigger = emergencyTrigger ?? "manual";
    setEmergencyState("confirmed");
    setWorkflowStep(1);
    setPage("emergency");
    setLocationHistory(previous => [
      {
        time: timeLabel(new Date()),
        coords: `${sensor.latitude.toFixed(4)}, ${sensor.longitude.toFixed(4)}`,
        accuracy: "± 12 m",
      },
      ...previous.slice(0, 2),
    ]);
    toast.error("Emergency workflow activated", {
      description:
        trigger === "manual"
          ? "Manual help request accepted. This is a simulation; no messages were sent."
          : trigger === "help"
            ? "Helping response is being prepared automatically."
            : trigger === "noResponse"
              ? "No response was detected. Emergency escalation is in progress."
              : "This is a simulation. No messages were sent.",
    });
  };

  useEffect(() => {
    if (
      emergencyState !== "confirmed" &&
      emergencyState !== "responseInProgress"
    )
      return;
    if (workflowStep >= 6) return;

    const transitionDelay = workflowStep === 1 ? 500 : 700;
    const timeout = window.setTimeout(() => {
      const nextStep = Math.min(6, workflowStep + 1);
      setEmergencyState("responseInProgress");
      setWorkflowStep(nextStep);
      if (nextStep < 6) return;

      const trigger = emergencyTrigger ?? "manual";
      emergencyMutation.mutate(
        {
          trigger:
            trigger === "manual"
              ? "Manual help request"
              : trigger === "help"
                ? "User requested assistance"
                : trigger === "noResponse"
                  ? "No response after fall"
                  : "Fall escalation",
        },
        {
          onSuccess: response => {
            setIncidents(previous => [
              {
                id: response.incident.id,
                time: "Just now",
                score: response.incident.score,
                level: response.incident.level as RiskLevel,
                trigger: response.incident.trigger,
                location: response.incident.location,
                response: response.incident.responseStatus,
              },
              ...previous.filter(item => item.id !== response.incident.id),
            ]);
            setEmergencyState("completed");
          },
          onError: error => {
            const details =
              error instanceof Error
                ? error.message
                : "The backend API is unavailable.";
            console.error("[Emergency API] activation failed:", error);
            toast.error("Emergency workflow could not reach the backend", {
              description: details,
            });
            setEmergencyState("completed");
          },
        }
      );
    }, transitionDelay);
    return () => window.clearTimeout(timeout);
  }, [emergencyState, emergencyTrigger, workflowStep]);
  const beginEmergency = () => {
    setPage("emergency");
    setEmergencyTrigger("manual");
    setEmergencyState("emergencyCountdown");
    setEmergencyCountdown(
      safetySettings.emergencyCountdown ?? EMERGENCY_COUNTDOWN_SECONDS
    );
    toast.warning("Emergency confirmation started", {
      description: "Demo only. Cancel before the countdown ends.",
    });
  };
  const cancelEmergency = () => {
    silenceAlert();
    setFallCountdown(null);
    setEmergencyCountdown(null);
    setEmergencyState("cancelled");
    setWorkflowStep(0);
    cancelEmergencyMutation.mutate(undefined, {
      onSuccess: response => {
        const cancelled = response.incident;
        setIncidents(previous => [
          {
            id: cancelled.id,
            time: "Just now",
            score: cancelled.score,
            level: cancelled.level as RiskLevel,
            trigger: cancelled.trigger,
            location: cancelled.location,
            response: cancelled.responseStatus,
          },
          ...previous,
        ]);
      },
    });
    toast.success("Emergency workflow cancelled");
  };
  const addContact = () => {
    if (
      !contactForm.name ||
      !contactForm.phone ||
      !/^\+?[0-9\s•-]{8,}$/.test(contactForm.phone)
    ) {
      toast.error("Enter a name and valid phone number");
      return;
    }
    const priority =
      contacts.length === 0
        ? "PRIMARY"
        : contacts.length === 1
          ? "SECONDARY"
          : "TERTIARY";
    contactCreateMutation.mutate(
      {
        name: contactForm.name,
        relationship: contactForm.relation || "Contact",
        phone: contactForm.phone,
        priority,
        enabled: true,
      },
      {
        onSuccess: contact => {
          setContacts(previous => [
            ...previous,
            {
              id: contact.id,
              name: contact.name,
              relation: contact.relationship,
              phone: contact.phone,
              priority: contact.priority,
              enabled: contact.enabled,
            },
          ]);
          setContactForm({ name: "", relation: "", phone: "" });
          setShowContactForm(false);
          toast.success("Emergency contact added");
        },
        onError: () => toast.error("Emergency contact could not be saved"),
      }
    );
  };
  const toggleContact = (id: number | string) => {
    const contact = contacts.find(item => item.id === id);
    if (!contact) return;
    contactUpdateMutation.mutate(
      { id: String(id), enabled: !contact.enabled },
      {
        onSuccess: () =>
          setContacts(previous =>
            previous.map(item =>
              item.id === id ? { ...item, enabled: !item.enabled } : item
            )
          ),
        onError: () => toast.error("Contact could not be updated"),
      }
    );
  };

  const saveProfile = () => {
    profileMutation.mutate(profile, {
      onSuccess: () => toast.success("✓ Profile updated"),
      onError: () => toast.error("Profile could not be saved"),
    });
  };

  const saveSettings = () => {
    settingsMutation.mutate(safetySettings, {
      onSuccess: () => {
        alertSettingsMutation.mutate(alertSettings, {
          onSuccess: () => toast.success("✓ Settings saved"),
          onError: () => toast.error("Alert settings could not be saved"),
        });
      },
      onError: () => toast.error("Safety settings could not be saved"),
    });
  };

  const renderHeader = (title: string, eyebrow = "Command center") => (
    <div className="topbar">
      <div>
        <div className="eyebrow">
          {eyebrow} / {timeLabel(now)}
        </div>
        <h1 className="page-title">{title}</h1>
      </div>
      <div className="top-actions">
        <button
          className="icon-button"
          onClick={() => toast.info("Notifications are simulated in demo mode")}
          aria-label="Notifications"
        >
          <Bell size={16} />
        </button>
        <div className="profile-chip">
          <div className="avatar">AR</div>
          <span>Demo user</span>
          <ChevronRight size={13} />
        </div>
      </div>
    </div>
  );

  const renderSimulator = () => (
    <div className="panel panel-pad simulator">
      <div className="sim-title">
        <Radio size={15} /> SIMULATION MODE — NOT REAL DEVICE DATA
      </div>
      <p className="sim-copy">
        Select a scenario to drive changing telemetry and the transparent risk
        engine. No emergency services or real contacts are contacted.
      </p>
      <div className="control-row">
        {scenarios.map(item => (
          <button
            key={item.id}
            className={`scenario-button ${scenario === item.id ? "selected" : ""}`}
            onClick={() => changeScenario(item.id)}
          >
            {item.short}
          </button>
        ))}
      </div>
    </div>
  );

  const renderRiskCard = () => (
    <div className={`status-banner ${riskClass(data.score)}`}>
      <div>
        <div className="status-kicker">SYSTEM STATUS · AI RISK ENGINE</div>
        <div className="status-value">
          {data.level === "HIGH RISK" ? "EMERGENCY" : data.level}
        </div>
        <div className="status-desc">{data.reason}</div>
        <button
          className="button button-danger mobile-quick-sos"
          onClick={beginEmergency}
        >
          <Siren size={15} /> Activate emergency
        </button>
      </div>
      <div className="status-right">
        <div className="score-big">{data.score}%</div>
        <div className="score-label">Current risk score</div>
        <div style={{ marginTop: 10 }}>
          <Badge
            tone={
              data.level === "HIGH RISK"
                ? "danger"
                : data.level === "POSSIBLE DISTRESS"
                  ? "warning"
                  : "safe"
            }
          >
            {data.level}
          </Badge>
        </div>
      </div>
    </div>
  );

  const renderDashboard = () => (
    <>
      {renderHeader(
        `Good morning${profile.displayName ? ", " + profile.displayName : ""}`,
        "Overview"
      )}
      {renderRiskCard()}
      <div className="grid grid-4" style={{ marginBottom: 14 }}>
        <StatCard
          label="Heart rate"
          value={sensor.heartRate}
          unit="BPM"
          foot="Within expected range"
          icon={<HeartPulse size={15} />}
        />
        <StatCard
          label="Movement"
          value={sensor.movement}
          foot={`${sensor.accel} g acceleration`}
          icon={<Activity size={15} />}
        />
        <StatCard
          label="Device battery"
          value={sensor.battery}
          unit="%"
          foot="AI Guardian Band"
          icon={<BatteryCharging size={15} />}
        />
        <StatCard
          label="Network"
          value={sensor.connected ? "Online" : "Offline"}
          foot={`GPS ${sensor.connected ? "connected" : "unavailable"}`}
          icon={<Wifi size={15} />}
        />
      </div>
      <div className="grid grid-2" style={{ marginBottom: 14 }}>
        <div className="panel panel-pad">
          <div className="section-head">
            <div>
              <h2 className="section-title">Risk score over time</h2>
              <div className="section-caption">
                Last 45 minutes · live simulation
              </div>
            </div>
            <Badge tone={data.score > 59 ? "warning" : "safe"}>Live</Badge>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={graphData}>
                <defs>
                  <linearGradient id="riskFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#70e1c4" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#70e1c4" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="#1a3843"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  tick={{ fill: "#6f8c96", fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: "#6f8c96", fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                  width={25}
                />
                <Tooltip content={<ChartTip />} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#70e1c4"
                  fill="url(#riskFill)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel panel-pad">
          <div className="section-head">
            <div>
              <h2 className="section-title">Detection factors</h2>
              <div className="section-caption">
                Transparent rule-based analysis
              </div>
            </div>
            <BrainCircuit size={17} color="#70e1c4" />
          </div>
          <div className="risk-layout">
            <div
              className="risk-ring"
              style={{
                background: `conic-gradient(${data.score > 79 ? "#ff6b6b" : data.score > 59 ? "#f6b85b" : "#70e1c4"} ${data.score}%, #183641 0)`,
              }}
            >
              <div className="risk-content">
                <div className="risk-number">{data.score}</div>
                <div className="risk-unit">out of 100</div>
              </div>
            </div>
            <div className="risk-details">
              <h3>{data.level}</h3>
              <p>{data.reason}</p>
              <div className="factor-list">
                {data.factors.map(factor => (
                  <span className="factor" key={factor}>
                    {factor}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-2" style={{ marginBottom: 14 }}>
        <div>{renderSimulator()}</div>
        <div className="panel panel-pad">
          <div className="section-head">
            <div>
              <h2 className="section-title">Recent activity</h2>
              <div className="section-caption">Latest system events</div>
            </div>
            <button
              className="button button-ghost"
              onClick={() => setPage("incidents")}
            >
              View all <ChevronRight size={13} />
            </button>
          </div>
          <div className="activity-list">
            {incidents.slice(0, 3).map(incident => (
              <div className="activity-item" key={incident.id}>
                <div className="activity-icon">
                  {incident.score > 59 ? (
                    <AlertTriangle size={14} />
                  ) : (
                    <Check size={14} />
                  )}
                </div>
                <div>
                  <div className="activity-title">{incident.trigger}</div>
                  <div className="activity-time">
                    {incident.time} · {incident.response}
                  </div>
                </div>
                <div
                  className="activity-score"
                  style={{ color: incident.score > 59 ? "#f6bd70" : "#78ddc4" }}
                >
                  {incident.score}%
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="callout">
        <strong>Prototype safety note:</strong> AI Guardian uses a transparent
        rule-based engine for demonstration. Scores are not medically validated,
        and the prototype does not contact law enforcement or emergency
        services.
      </div>
    </>
  );

  const renderMonitoring = () => (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">
            Telemetry /{" "}
            {sensor.connected ? "Device connected" : "Device disconnected"}
          </div>
          <h1 className="page-title">Live monitoring</h1>
        </div>
        <button
          className={`button ${monitoring ? "button-secondary" : "button-primary"}`}
          onClick={() => setMonitoring(value => !value)}
        >
          {monitoring ? <Pause size={14} /> : <Play size={14} />}
          {monitoring ? "Pause monitoring" : "Resume monitoring"}
        </button>
      </div>
      {renderSimulator()}
      <div className="live-grid" style={{ marginTop: 14 }}>
        <div className="panel panel-pad">
          <div className="section-head">
            <div>
              <h2 className="section-title">Current sensor telemetry</h2>
              <div className="section-caption">
                Updated {timeLabel(sensor.updatedAt)} ·{" "}
                {monitoring ? "streaming" : "paused"}
              </div>
            </div>
            <Badge tone={monitoring ? "safe" : "neutral"}>
              {monitoring ? "Streaming" : "Paused"}
            </Badge>
          </div>
          <div className="sensor-grid">
            <div className="sensor-tile">
              <div className="sensor-label">Heart rate</div>
              <div className="sensor-value">{sensor.heartRate} BPM</div>
              <div className="sensor-meta">
                Δ {sensor.heartRate - 78 > 0 ? "+" : ""}
                {sensor.heartRate - 78} from baseline
              </div>
            </div>
            <div className="sensor-tile">
              <div className="sensor-label">Accelerometer</div>
              <div className="sensor-value">{sensor.accel} g</div>
              <div className="sensor-meta">
                X 0.4 · Y 0.3 · Z {sensor.accel}
              </div>
            </div>
            <div className="sensor-tile">
              <div className="sensor-label">Gyroscope</div>
              <div className="sensor-value">{sensor.gyro} rad/s</div>
              <div className="sensor-meta">X 0.2 · Y 0.1 · Z {sensor.gyro}</div>
            </div>
            <div className="sensor-tile">
              <div className="sensor-label">Motion state</div>
              <div className="sensor-value" style={{ fontSize: 15 }}>
                {sensor.movement}
              </div>
              <div className="sensor-meta">
                Scenario: {scenarios.find(item => item.id === scenario)?.label}
              </div>
            </div>
            <div className="sensor-tile">
              <div className="sensor-label">Fall detection</div>
              <div
                className="sensor-value"
                style={{ color: sensor.fall ? "#ff9494" : "#8af0d3" }}
              >
                {sensor.fall ? "DETECTED" : "Clear"}
              </div>
              <div className="sensor-meta">Rule-based pattern match</div>
            </div>
            <div className="sensor-tile">
              <div className="sensor-label">GPS location</div>
              <div className="sensor-value" style={{ fontSize: 14 }}>
                {sensor.latitude.toFixed(4)}, {sensor.longitude.toFixed(4)}
              </div>
              <div className="sensor-meta">Fictional demo coordinates</div>
            </div>
          </div>
        </div>
        <div className="panel panel-pad">
          <div className="section-head">
            <div>
              <h2 className="section-title">Risk signal</h2>
              <div className="section-caption">Risk engine output</div>
            </div>
            <Gauge size={17} color="#70e1c4" />
          </div>
          <div
            className="risk-layout"
            style={{ display: "flex", flexDirection: "column" }}
          >
            <div
              className="risk-ring"
              style={{
                background: `conic-gradient(#${data.score > 79 ? "ff6b6b" : data.score > 59 ? "f6b85b" : "70e1c4"} ${data.score}%, #183641 0)`,
              }}
            >
              <div className="risk-content">
                <div className="risk-number">{data.score}%</div>
                <div className="risk-unit">risk score</div>
              </div>
            </div>
            <div className="risk-details" style={{ textAlign: "center" }}>
              <h3>{data.level}</h3>
              <p>{data.reason}</p>
              <div className="factor-list" style={{ justifyContent: "center" }}>
                {data.factors.map(factor => (
                  <span className="factor" key={factor}>
                    {factor}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-2" style={{ marginTop: 14 }}>
        <div className="panel panel-pad chart-panel">
          <div className="section-head">
            <div>
              <h2 className="section-title">Heart rate history</h2>
              <div className="section-caption">
                BPM · simulated rolling window
              </div>
            </div>
            <HeartPulse size={16} color="#e88f9a" />
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={graphData.map((item, i) => ({
                  ...item,
                  value: Math.max(55, sensor.heartRate + ((i % 3) - 1) * 8),
                }))}
              >
                <CartesianGrid
                  stroke="#1a3843"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  tick={{ fill: "#6f8c96", fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fill: "#6f8c96", fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                  width={25}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#e88f9a"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel panel-pad chart-panel">
          <div className="section-head">
            <div>
              <h2 className="section-title">Acceleration history</h2>
              <div className="section-caption">g-force · impact visibility</div>
            </div>
            <Zap size={16} color="#f6bd70" />
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={graphData.map((item, i) => ({
                  ...item,
                  value: Number(
                    Math.max(0.3, sensor.accel + Math.sin(i) * 0.7).toFixed(1)
                  ),
                }))}
              >
                <CartesianGrid
                  stroke="#1a3843"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  tick={{ fill: "#6f8c96", fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fill: "#6f8c96", fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                  width={25}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#f6bd70"
                  fill="#f6bd70"
                  fillOpacity={0.12}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </>
  );

  const renderEmergency = () => {
    const showWorkflow =
      emergencyState === "confirmed" ||
      emergencyState === "responseInProgress" ||
      emergencyState === "completed";
    const fallWaiting =
      emergencyState === "fallDetected" ||
      emergencyState === "awaitingResponse";
    const emergencyWaiting = emergencyState === "emergencyCountdown";
    const manualLowRiskRequest =
      emergencyState === "confirmed" &&
      emergencyTrigger === "manual" &&
      data.score < 80;
    const currentStatus =
      emergencyState === "cancelled"
        ? "Cancelled"
        : emergencyState === "userSafe"
          ? "Recovered / false alarm"
          : emergencyState === "noResponse"
            ? "No response detected"
            : emergencyState === "escalating"
              ? "Escalating safety response"
              : fallWaiting
                ? "Fall detected — awaiting response"
                : emergencyWaiting
                  ? "Potential emergency"
                  : emergencyState === "completed"
                    ? "Completed"
                    : emergencyState === "confirmed"
                      ? manualLowRiskRequest
                        ? "Manual help request"
                        : "Emergency response activated"
                      : data.level === "HIGH RISK"
                        ? "High risk detected"
                        : data.level === "POSSIBLE DISTRESS"
                          ? "Warning"
                          : data.level === "MONITORING"
                            ? "Monitoring"
                            : "No active emergency";
    const statusTone =
      emergencyState === "cancelled" || emergencyState === "userSafe"
        ? "neutral"
        : showWorkflow ||
            emergencyWaiting ||
            fallWaiting ||
            data.level === "HIGH RISK"
          ? "danger"
          : data.level === "POSSIBLE DISTRESS"
            ? "warning"
            : "safe";

    return (
      <>
        <div className="topbar">
          <div>
            <div className="eyebrow">Safety workflow / Demo controls</div>
            <h1 className="page-title">Emergency center</h1>
          </div>
          <Badge tone={statusTone}>{currentStatus}</Badge>
        </div>
        <div
          className="panel panel-pad"
          style={{
            marginBottom: 14,
            borderColor: showWorkflow ? "rgba(255,107,107,.35)" : undefined,
          }}
        >
          <div className="section-head">
            <div>
              <h2 className="section-title">Emergency response control</h2>
              <div className="section-caption">
                All actions below are simulated for evaluation
              </div>
            </div>
            <Siren size={21} color={showWorkflow ? "#ff8585" : "#70e1c4"} />
          </div>
          {!showWorkflow ? (
            <>
              {fallWaiting ? (
                <div
                  className="fall-prompt"
                  role="alertdialog"
                  aria-labelledby="fall-prompt-title"
                  aria-describedby="fall-prompt-description"
                >
                  <div className="status-kicker">LEVEL 1 · FALL DETECTED</div>
                  <h2 id="fall-prompt-title" className="fall-prompt-title">
                    Are you safe?
                  </h2>
                  <p id="fall-prompt-description" className="fall-prompt-copy">
                    Possible fall detected by AI Guardian. Verify your condition
                    before the grace period ends.
                  </p>
                  <div className="fall-snapshot">
                    <span>
                      Acceleration <strong>{sensor.accel} g</strong>
                    </span>
                    <span>
                      Movement <strong>{sensor.movement}</strong>
                    </span>
                    <span>
                      Orientation <strong>{sensor.gyro} rad/s anomaly</strong>
                    </span>
                    <span>
                      Heart rate <strong>{sensor.heartRate} BPM</strong>
                    </span>
                    <span>
                      Risk <strong>{data.score}%</strong>
                    </span>
                  </div>
                  <div className="fall-countdown-label">
                    Automatic emergency response in
                  </div>
                  <div className="countdown-number">
                    {fallCountdown ?? fallVerificationSeconds}
                  </div>
                  <div className="fall-actions">
                    <button
                      className="button button-primary button-wide"
                      onClick={markUserSafe}
                    >
                      <Check size={16} /> I&apos;M SAFE
                    </button>
                    <button
                      className="button button-danger button-wide"
                      onClick={requestHelp}
                    >
                      <Siren size={16} /> I NEED HELP
                    </button>
                  </div>
                  <div className="alert-controls">
                    <span>
                      {alertSoundStatus === "active"
                        ? "🔊 Audible alert ACTIVE"
                        : alertSoundStatus === "unavailable"
                          ? "Vibration unavailable on this device"
                          : "Visual alert active"}
                    </span>
                    {alertSoundStatus !== "active" ? (
                      <button
                        className="button button-secondary"
                        onClick={enableAlertSound}
                      >
                        Enable Alert Sound
                      </button>
                    ) : (
                      <button
                        className="button button-ghost"
                        onClick={silenceAlert}
                      >
                        Silence alert
                      </button>
                    )}
                  </div>
                </div>
              ) : emergencyWaiting && emergencyCountdown !== null ? (
                <div className="countdown-panel">
                  <div className="status-kicker">
                    LEVEL 4 · POTENTIAL EMERGENCY
                  </div>
                  <div className="countdown-copy">
                    Emergency response will begin in
                  </div>
                  <div className="countdown-number">{emergencyCountdown}</div>
                  <div className="fall-actions">
                    <button
                      className="button button-secondary button-wide"
                      onClick={cancelEmergency}
                    >
                      <X size={15} /> CANCEL
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className={`status-banner ${riskClass(data.score)}`}
                    style={{ marginBottom: 15 }}
                  >
                    <div>
                      <div className="status-kicker">CURRENT SYSTEM STATE</div>
                      <div className="status-value">{currentStatus}</div>
                      <div className="status-desc">
                        {emergencyState === "cancelled"
                          ? "The previous emergency verification was cancelled. No notification was sent."
                          : data.level === "POSSIBLE DISTRESS"
                            ? "Potential distress detected. Verify the situation before starting the demo response."
                            : data.level === "MONITORING"
                              ? "Elevated activity is being monitored. No emergency workflow is active."
                              : "No active emergency. Current telemetry is within the demo safety range."}
                      </div>
                    </div>
                    <div className="status-right">
                      <div className="score-big">{data.score}%</div>
                      <div className="score-label">Current risk score</div>
                    </div>
                  </div>
                  <div
                    className="callout"
                    style={{ borderColor: "#f6bd70", marginBottom: 15 }}
                  >
                    DEMO / SIMULATION. No emergency services or real contacts
                    are contacted.
                  </div>
                  <button
                    className="button button-danger button-wide"
                    onClick={beginEmergency}
                  >
                    <Siren size={15} />{" "}
                    {data.level === "POSSIBLE DISTRESS"
                      ? "BEGIN EMERGENCY VERIFICATION"
                      : "ACTIVATE EMERGENCY SIMULATION"}
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <div
                className="status-banner danger"
                style={{ marginBottom: 15 }}
              >
                <div>
                  <div className="status-kicker">
                    {emergencyState === "completed"
                      ? "COMPLETED DEMO RESPONSE"
                      : manualLowRiskRequest
                        ? "MANUAL HELP REQUEST"
                        : "EMERGENCY RESPONSE ACTIVATED"}
                  </div>
                  <div className="status-value">
                    {emergencyState === "completed"
                      ? "Response completed"
                      : manualLowRiskRequest
                        ? "Manual help request accepted"
                        : "Emergency response activated"}
                  </div>
                  <div className="status-desc">
                    The system is walking through a safe, local-only response
                    workflow using the current sensor snapshot.
                  </div>
                </div>
                <div className="status-right">
                  <div className="score-big">{data.score}%</div>
                  <div className="score-label">Risk score</div>
                </div>
              </div>
              <div className="workflow">
                {[
                  "Detect event",
                  "Verify / confirm emergency state",
                  "Capture current location",
                  "Prepare emergency notification",
                  "Notify configured contacts",
                  "Record incident",
                ].map((step, index) => (
                  <div
                    className={`workflow-step ${index < workflowStep ? "done" : ""}`}
                    key={step}
                  >
                    <div className="step-number">
                      {index < workflowStep ? <Check size={12} /> : index + 1}
                    </div>
                    <div className="step-text">
                      {step}
                      {index < workflowStep && (
                        <span style={{ color: "#72d7c0", marginLeft: 8 }}>
                          Complete
                        </span>
                      )}
                      {index === workflowStep && workflowStep < 6 && (
                        <span style={{ color: "#f6bd70", marginLeft: 8 }}>
                          Processing...
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="response-automation-note">
                {emergencyState === "completed"
                  ? "✓ Emergency response completed"
                  : "Automatic response in progress · DEMO / SIMULATION"}
              </div>
            </>
          )}
        </div>
        <div className="grid grid-2">
          <div className="panel panel-pad">
            <div className="section-head">
              <div>
                <h2 className="section-title">Selected contacts</h2>
                <div className="section-caption">Enabled recipients only</div>
              </div>
              <button
                className="button button-ghost"
                onClick={() => setPage("contacts")}
              >
                Manage
              </button>
            </div>
            {contacts
              .filter(contact => contact.enabled)
              .map(contact => (
                <div className="device-row" key={contact.id}>
                  <span className="device-label">
                    {contact.name} · {contact.relation}
                  </span>
                  <span className="device-value">{contact.phone}</span>
                </div>
              ))}
          </div>
          <div className="panel panel-pad">
            <div className="section-head">
              <div>
                <h2 className="section-title">Event snapshot</h2>
                <div className="section-caption">Captured from simulation</div>
              </div>
              <Crosshair size={16} color="#70e1c4" />
            </div>
            <div className="device-row">
              <span className="device-label">Trigger</span>
              <span className="device-value">
                {scenarios.find(item => item.id === scenario)?.label}
              </span>
            </div>
            <div className="device-row">
              <span className="device-label">Location</span>
              <span className="device-value">16.7049, 74.2433</span>
            </div>
            <div className="device-row">
              <span className="device-label">Sensor summary</span>
              <span className="device-value">
                {sensor.heartRate} BPM · {sensor.accel} g
              </span>
            </div>
          </div>
        </div>
      </>
    );
  };

  const renderLocation = () => (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Telemetry / Fictional coordinates</div>
          <h1 className="page-title">Location</h1>
        </div>
        <Badge tone="safe">Simulated location</Badge>
      </div>
      <div className="grid grid-2">
        <div className="panel panel-pad">
          <div className="section-head">
            <div>
              <h2 className="section-title">Current location</h2>
              <div className="section-caption">
                Safe fictional/default location for demonstration
              </div>
            </div>
            <Navigation size={17} color="#70e1c4" />
          </div>
          <div className="map-box">
            <MapPin className="map-pin" size={28} fill="#ff8989" />
            <div className="map-label">
              AI Guardian Band
              <br />
              <span className="mono">LIVE SIMULATION</span>
            </div>
          </div>
          <div className="grid grid-3" style={{ marginTop: 12 }}>
            <StatCard
              label="Latitude"
              value="16.7049"
              foot="Fictional coordinate"
              icon={<MapPin size={14} />}
            />
            <StatCard
              label="Longitude"
              value="74.2433"
              foot="Fictional coordinate"
              icon={<MapPin size={14} />}
            />
            <StatCard
              label="Accuracy"
              value="± 12"
              unit="m"
              foot="Placeholder estimate"
              icon={<Crosshair size={14} />}
            />
          </div>
        </div>
        <div className="panel panel-pad">
          <div className="section-head">
            <div>
              <h2 className="section-title">Location history</h2>
              <div className="section-caption">Latest device pings</div>
            </div>
            <button
              className="icon-button"
              onClick={() => {
                setLocationHistory(history => [
                  {
                    time: timeLabel(new Date()),
                    coords: "16.7052, 74.2436",
                    accuracy: "± 10 m",
                  },
                  ...history.slice(0, 2),
                ]);
                toast.success("Simulated location refreshed");
              }}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          {locationHistory.map(record => (
            <div className="device-row" key={record.time}>
              <span>
                <span
                  className="device-value"
                  style={{ display: "block", textAlign: "left" }}
                >
                  {record.coords}
                </span>
                <span className="device-label">{record.time}</span>
              </span>
              <span className="device-label">{record.accuracy}</span>
            </div>
          ))}
          <div className="callout" style={{ marginTop: 15 }}>
            Privacy by design: this prototype never reads or exposes the
            developer's actual private location.
          </div>
        </div>
      </div>
    </>
  );

  const renderContacts = () => (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">
            Response configuration /{" "}
            {contacts.filter(contact => contact.enabled).length} enabled
          </div>
          <h1 className="page-title">Emergency contacts</h1>
        </div>
        <button
          className="button button-primary"
          onClick={() => setShowContactForm(value => !value)}
        >
          <Plus size={14} /> Add contact
        </button>
      </div>
      {showContactForm && (
        <div className="panel panel-pad" style={{ marginBottom: 14 }}>
          <div className="section-head">
            <div>
              <h2 className="section-title">Add emergency contact</h2>
              <div className="section-caption">Use demo data only</div>
            </div>
            <button
              className="icon-button"
              onClick={() => setShowContactForm(false)}
            >
              <X size={14} />
            </button>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Name</label>
              <input
                className="form-input"
                value={contactForm.name}
                onChange={event =>
                  setContactForm({ ...contactForm, name: event.target.value })
                }
                placeholder="e.g. Priya Shah"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Relationship</label>
              <input
                className="form-input"
                value={contactForm.relation}
                onChange={event =>
                  setContactForm({
                    ...contactForm,
                    relation: event.target.value,
                  })
                }
                placeholder="e.g. Parent"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Phone number</label>
              <input
                className="form-input"
                value={contactForm.phone}
                onChange={event =>
                  setContactForm({ ...contactForm, phone: event.target.value })
                }
                placeholder="+91 98••• 00000"
              />
            </div>
            <div style={{ display: "flex", alignItems: "end" }}>
              <button
                className="button button-primary button-wide"
                onClick={addContact}
              >
                Save contact
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="panel panel-pad">
        <div className="section-head">
          <div>
            <h2 className="section-title">Configured contacts</h2>
            <div className="section-caption">
              Contacts are only used inside this local demonstration
            </div>
          </div>
          <Badge tone="neutral">CRUD ready</Badge>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Relationship</th>
                <th>Phone</th>
                <th>Priority</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {contacts.map(contact => (
                <tr key={contact.id}>
                  <td>
                    <strong>{contact.name}</strong>
                    {contact.primary && (
                      <span
                        style={{ color: "#70e1c4", fontSize: 9, marginLeft: 7 }}
                      >
                        PRIMARY
                      </span>
                    )}
                  </td>
                  <td>{contact.relation}</td>
                  <td className="mono">{contact.phone}</td>
                  <td>{contact.priority}</td>
                  <td>
                    <button
                      className={`switch ${contact.enabled ? "on" : ""}`}
                      onClick={() => toggleContact(contact.id)}
                      aria-label={`Toggle ${contact.name}`}
                    >
                      <div className="switch-dot" />
                    </button>
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      style={{ width: 30, height: 30 }}
                      onClick={() => {
                        contactRemoveMutation.mutate(
                          { id: String(contact.id) },
                          {
                            onSuccess: response => {
                              if (response.removed) {
                                setContacts(previous =>
                                  previous.filter(
                                    item => item.id !== contact.id
                                  )
                                );
                                toast.success("Contact removed");
                              }
                            },
                            onError: () =>
                              toast.error("Contact could not be removed"),
                          }
                        );
                      }}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );

  const renderDevice = () => (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Hardware bridge / Prototype</div>
          <h1 className="page-title">Device</h1>
        </div>
        <Badge tone={sensor.connected ? "safe" : "danger"}>
          {sensor.connected ? "Connected" : "Disconnected"}
        </Badge>
      </div>
      <div className="grid grid-2">
        <div className="panel panel-pad">
          <div className="section-head">
            <div>
              <h2 className="section-title">AI Guardian Band</h2>
              <div className="section-caption">
                Simulated wearable endpoint · AG-001
              </div>
            </div>
            <div className="brand-mark" style={{ width: 31, height: 31 }}>
              <Smartphone size={16} />
            </div>
          </div>
          <div className="device-row">
            <span className="device-label">Device ID</span>
            <span className="device-value mono">AG-001</span>
          </div>
          <div className="device-row">
            <span className="device-label">Connection</span>
            <span className="device-value">
              <Badge tone={sensor.connected ? "safe" : "danger"}>
                {sensor.connected ? "Online" : "Offline"}
              </Badge>
            </span>
          </div>
          <div className="device-row">
            <span className="device-label">Battery</span>
            <span className="device-value">{sensor.battery}%</span>
          </div>
          <div className="device-row">
            <span className="device-label">Firmware</span>
            <span className="device-value">Prototype bridge v0.1</span>
          </div>
          <div className="device-row">
            <span className="device-label">Signal strength</span>
            <span className="device-value">{sensor.signal}%</span>
          </div>
          <div className="device-row">
            <span className="device-label">Last sync</span>
            <span className="device-value">{timeLabel(sensor.updatedAt)}</span>
          </div>
          <button
            className="button button-secondary button-wide"
            style={{ marginTop: 15 }}
            onClick={() => {
              const connected = !sensor.connected;
              setSensor(previous => ({
                ...previous,
                connected,
              }));
              deviceConfigMutation.mutate({
                deviceId: "AG-001",
                deviceName: "AI Guardian Band",
                connectionStatus: connected ? "Connected" : "Disconnected",
                battery: sensor.battery,
                firmware: "Prototype bridge v0.1",
                lastSync: new Date().toISOString(),
              });
              toast.info(
                `Demo device ${sensor.connected ? "disconnected" : "reconnected"}`
              );
            }}
          >
            <Wifi size={14} /> Toggle simulated connection
          </button>
        </div>
        <div className="panel panel-pad">
          <div className="section-head">
            <div>
              <h2 className="section-title">Hardware integration path</h2>
              <div className="section-caption">
                Designed for future ESP32 telemetry
              </div>
            </div>
            <Cpu size={17} color="#70e1c4" />
          </div>
          {[
            "ESP32 controller",
            "GPS module",
            "MPU6050 motion sensor",
            "Heart-rate sensor",
            "Buzzer",
            "GSM / Wi-Fi / Bluetooth",
          ].map(item => (
            <div className="device-row" key={item}>
              <span className="device-label">{item}</span>
              <span className="device-value">
                <Badge tone="neutral">Planned</Badge>
              </span>
            </div>
          ))}
          <div className="callout" style={{ marginTop: 15 }}>
            Future endpoint:{" "}
            <span className="mono">POST /api/device/telemetry</span>. The
            current project accepts simulation data only; it does not fake
            hardware communication.
          </div>
        </div>
      </div>
    </>
  );

  const renderIncidents = () => (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Audit log / {incidents.length} records</div>
          <h1 className="page-title">Incident history</h1>
        </div>
        <div className="top-actions">
          <div style={{ position: "relative" }}>
            <Search
              size={14}
              color="#6f8c96"
              style={{ position: "absolute", left: 10, top: 10 }}
            />
            <input
              className="search-input"
              style={{ width: 190, paddingLeft: 29 }}
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search incidents"
            />
          </div>
          <button
            className="button button-secondary"
            onClick={() => {
              setIncidents([]);
              toast.success("Simulated incident log cleared");
            }}
          >
            Clear demo data
          </button>
        </div>
      </div>
      <div className="panel panel-pad">
        <div className="section-head">
          <div>
            <h2 className="section-title">Recorded incidents</h2>
            <div className="section-caption">
              Every record is generated locally by the simulator or demo
              workflow
            </div>
          </div>
          <Badge tone="neutral">Searchable</Badge>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Incident ID</th>
                <th>Timestamp</th>
                <th>Risk</th>
                <th>Trigger</th>
                <th>Location</th>
                <th>Response</th>
              </tr>
            </thead>
            <tbody>
              {filteredIncidents.length ? (
                filteredIncidents.map(incident => (
                  <tr key={incident.id}>
                    <td className="mono">{incident.id}</td>
                    <td>{incident.time}</td>
                    <td>
                      <span className={`badge ${levelBadge(incident.level)}`}>
                        {incident.score}%
                      </span>
                    </td>
                    <td>{incident.trigger}</td>
                    <td>{incident.location}</td>
                    <td>{incident.response}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state">
                      No incidents match this search.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );

  const renderDatasetViewer = () => (
    <div className="panel panel-pad" style={{ marginTop: 18 }}>
      <div className="section-head" style={{ marginBottom: 12 }}>
        <div>
          <h2 className="section-title">Database dataset viewer</h2>
          <div className="section-caption">
            Real data from the connected AI Guardian database
          </div>
        </div>
      </div>

      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}
      >
        {[
          "Show me all the data in my AI Guardian dataset.",
          "Show all records",
          "Show first 10 records",
          "Show latest 10 records",
          "Show table names",
          "Count total records",
        ].map(prompt => (
          <button
            key={prompt}
            type="button"
            className="button button-secondary"
            onClick={() => submitDatasetQuery(prompt)}
            style={{ padding: "8px 12px", fontSize: 12 }}
          >
            {prompt}
          </button>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <input
          value={datasetPrompt}
          onChange={event => setDatasetPrompt(event.target.value)}
          placeholder="Ask for dataset data, tables, filters, or counts"
          style={{
            flex: 1,
            minWidth: 220,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(148, 163, 184, 0.35)",
            background: "rgba(15, 23, 42, 0.3)",
            color: "#e2e8f0",
          }}
        />
        <button
          type="button"
          className="button"
          onClick={() => submitDatasetQuery(datasetPrompt)}
          disabled={datasetMutation.isPending}
        >
          {datasetMutation.isPending ? "Loading..." : "Run query"}
        </button>
      </div>

      {datasetResult?.tableCounts?.length ? (
        <div style={{ marginBottom: 14, overflowX: "auto" }}>
          <strong style={{ display: "block", marginBottom: 8 }}>
            Available datasets
          </strong>
          <table
            style={{ width: "100%", maxWidth: 560, borderCollapse: "collapse" }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: "left",
                    padding: "7px 10px",
                    borderBottom: "1px solid rgba(148,163,184,0.25)",
                  }}
                >
                  Table
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "7px 10px",
                    borderBottom: "1px solid rgba(148,163,184,0.25)",
                  }}
                >
                  Records
                </th>
              </tr>
            </thead>
            <tbody>
              {datasetResult.tableCounts.map(({ table, records }) => (
                <tr key={table}>
                  <td
                    style={{
                      padding: "6px 10px",
                      borderBottom: "1px solid rgba(148,163,184,0.15)",
                    }}
                  >
                    <button
                      type="button"
                      className={
                        datasetResult.selectedTable === table
                          ? "button"
                          : "button button-secondary"
                      }
                      onClick={() =>
                        submitDatasetQuery(
                          datasetPrompt || "Show all records",
                          table
                        )
                      }
                      style={{ padding: "5px 9px", fontSize: 12 }}
                    >
                      {table}
                    </button>
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      padding: "6px 10px",
                      borderBottom: "1px solid rgba(148,163,184,0.15)",
                    }}
                  >
                    {records}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {datasetResult?.error ? (
        <div className="alert alert-error" style={{ marginBottom: 12 }}>
          <strong>Database connection error:</strong> {datasetResult.error}
          <div style={{ marginTop: 8 }}>
            Fix the DATABASE_URL value in the project environment and confirm
            that the MySQL server is running.
          </div>
        </div>
      ) : null}

      {datasetResult ? (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <div>
              <strong>Dataset:</strong> {datasetResult.dataset}
            </div>
            <div>
              <strong>Total Records:</strong> {datasetResult.totalRecords}
            </div>
          </div>

          <div style={{ marginBottom: 12, color: "#cbd5e1" }}>
            {datasetResult.message}
          </div>

          {datasetResult.selectedTable ? (
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                marginBottom: 12,
                flexWrap: "wrap",
              }}
            >
              <input
                aria-label="Search selected dataset"
                value={datasetSearch}
                onChange={event => setDatasetSearch(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Enter")
                    submitDatasetQuery(
                      datasetPrompt,
                      datasetResult.selectedTable ?? undefined
                    );
                }}
                placeholder="Filter this dataset"
                style={{
                  minWidth: 200,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(148,163,184,0.35)",
                  background: "rgba(15, 23, 42, 0.3)",
                  color: "#e2e8f0",
                }}
              />
              <button
                type="button"
                className="button button-secondary"
                onClick={() =>
                  submitDatasetQuery(
                    datasetPrompt,
                    datasetResult.selectedTable ?? undefined
                  )
                }
                disabled={datasetMutation.isPending}
              >
                <Search size={15} aria-hidden="true" /> Search
              </button>
            </div>
          ) : null}

          {datasetResult.columns.length ? (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  minWidth: 720,
                  borderCollapse: "collapse",
                }}
              >
                <thead>
                  <tr>
                    {datasetResult.columns.map(column => (
                      <th
                        key={column}
                        style={{
                          textAlign: "left",
                          padding: "8px 10px",
                          borderBottom: "1px solid rgba(148,163,184,0.25)",
                          color: "#e2e8f0",
                        }}
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {datasetResult.records.length ? (
                    datasetResult.records.map((record, rowIndex) => (
                      <tr key={`${datasetResult.dataset}-${rowIndex}`}>
                        {datasetResult.columns.map(column => (
                          <td
                            key={`${datasetResult.dataset}-${rowIndex}-${column}`}
                            style={{
                              padding: "8px 10px",
                              borderBottom: "1px solid rgba(148,163,184,0.15)",
                              verticalAlign: "top",
                              color: "#f8fafc",
                            }}
                          >
                            {record[column] == null
                              ? "—"
                              : String(record[column])}
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={datasetResult.columns.length}
                        style={{ padding: "12px", color: "#cbd5e1" }}
                      >
                        No records were returned for this query.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : null}

          {datasetResult.pagination &&
          datasetResult.pagination.totalRecords >
            datasetResult.pagination.limit ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 10,
                marginTop: 12,
              }}
            >
              <span style={{ color: "#cbd5e1", fontSize: 13 }}>
                Page {datasetResult.pagination.page} of{" "}
                {Math.ceil(
                  datasetResult.pagination.totalRecords /
                    datasetResult.pagination.limit
                )}
              </span>
              <button
                type="button"
                className="button button-secondary"
                disabled={
                  datasetMutation.isPending ||
                  datasetResult.pagination.page <= 1
                }
                onClick={() =>
                  submitDatasetQuery(
                    datasetPrompt,
                    datasetResult.selectedTable ?? undefined,
                    datasetResult.pagination!.page - 1
                  )
                }
              >
                Previous
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={
                  datasetMutation.isPending || !datasetResult.pagination.hasMore
                }
                onClick={() =>
                  submitDatasetQuery(
                    datasetPrompt,
                    datasetResult.selectedTable ?? undefined,
                    datasetResult.pagination!.page + 1
                  )
                }
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );

  const renderAnalysis = () => (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Explainability / Rule-based engine</div>
          <h1 className="page-title">AI analysis</h1>
        </div>
        <Badge tone="neutral">Transparent model</Badge>
      </div>
      {renderDatasetViewer()}

      <div className="grid grid-3" style={{ marginBottom: 14 }}>
        <div className="panel panel-pad">
          <div className="section-caption">Current risk</div>
          <div className="score-big" style={{ marginTop: 8 }}>
            {data.score}%
          </div>
          <div style={{ marginTop: 8 }}>
            <Badge
              tone={
                data.score > 79
                  ? "danger"
                  : data.score > 59
                    ? "warning"
                    : "safe"
              }
            >
              {data.level}
            </Badge>
          </div>
        </div>
        <div className="panel panel-pad">
          <div className="section-caption">Risk distribution</div>
          <div
            style={{
              marginTop: 17,
              display: "flex",
              gap: 4,
              alignItems: "end",
              height: 55,
            }}
          >
            {[18, 26, 12, 33, 21, 38, 29, 56, 43, 72, 49, data.score].map(
              (height, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    height: `${Math.max(14, height)}%`,
                    borderRadius: "4px 4px 2px 2px",
                    background: height > 60 ? "#f6b85b" : "#4a9e98",
                  }}
                />
              )
            )}
          </div>
          <div className="section-caption" style={{ marginTop: 9 }}>
            Event score frequency
          </div>
        </div>
        <div className="panel panel-pad">
          <div className="section-caption">Recent events</div>
          <div className="activity-list" style={{ marginTop: 12 }}>
            <div className="activity-item">
              <div className="activity-icon">
                <Radio size={13} />
              </div>
              <div>
                <div className="activity-title">
                  {scenarios.find(item => item.id === scenario)?.label}
                </div>
                <div className="activity-time">Now · simulator</div>
              </div>
              <div className="activity-score">{data.score}%</div>
            </div>
            <div className="activity-item">
              <div className="activity-icon">
                <Check size={13} />
              </div>
              <div>
                <div className="activity-title">Device heartbeat</div>
                <div className="activity-time">
                  {timeLabel(sensor.updatedAt)}
                </div>
              </div>
              <div className="activity-score" style={{ color: "#78ddc4" }}>
                OK
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-2">
        <div className="panel panel-pad chart-panel">
          <div className="section-head">
            <div>
              <h2 className="section-title">Risk score over time</h2>
              <div className="section-caption">
                Thresholds are illustrative, not validated
              </div>
            </div>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={graphData}>
                <CartesianGrid
                  stroke="#1a3843"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  tick={{ fill: "#6f8c96", fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: "#6f8c96", fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                  width={25}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#70e1c4"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel panel-pad">
          <div className="section-head">
            <div>
              <h2 className="section-title">Model explanation</h2>
              <div className="section-caption">
                Why the current score is {data.score}
              </div>
            </div>
            <BrainCircuit size={16} color="#70e1c4" />
          </div>
          <div className="factor-list" style={{ marginBottom: 14 }}>
            {data.factors.map(factor => (
              <span className="factor" key={factor}>
                {factor}
              </span>
            ))}
          </div>
          <p
            style={{
              color: "#9db7ba",
              fontSize: 11,
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            {data.reason}
          </p>
          <div className="callout" style={{ marginTop: 15 }}>
            This prototype uses a transparent rule-based risk engine for
            demonstration. It is not a clinically validated or
            law-enforcement-certified emergency detection system.
          </div>
        </div>
      </div>
    </>
  );

  const renderSettings = () => (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Configuration / Demo profile</div>
          <h1 className="page-title">Settings</h1>
        </div>
        <button className="button button-primary" onClick={saveSettings}>
          Save changes
        </button>
      </div>
      <div className="panel panel-pad">
        <div className="settings-section">
          <h2 className="section-title">Profile</h2>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <div className="form-group">
              <label className="form-label">Full name</label>
              <input
                className="form-input"
                value={profile.fullName}
                onChange={event =>
                  setProfile(previous => ({
                    ...previous,
                    fullName: event.target.value,
                  }))
                }
              />
            </div>
            <div className="form-group">
              <label className="form-label">Display name</label>
              <input
                className="form-input"
                value={profile.displayName}
                onChange={event =>
                  setProfile(previous => ({
                    ...previous,
                    displayName: event.target.value,
                  }))
                }
              />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                className="form-input"
                value={profile.email}
                onChange={event =>
                  setProfile(previous => ({
                    ...previous,
                    email: event.target.value,
                  }))
                }
              />
            </div>
            <div className="form-group">
              <label className="form-label">Phone</label>
              <input
                className="form-input"
                value={profile.phone}
                onChange={event =>
                  setProfile(previous => ({
                    ...previous,
                    phone: event.target.value,
                  }))
                }
              />
            </div>
            <div className="form-group">
              <label className="form-label">Age</label>
              <input
                className="form-input"
                value={profile.age}
                onChange={event =>
                  setProfile(previous => ({
                    ...previous,
                    age: event.target.value,
                  }))
                }
              />
            </div>
            <div className="form-group">
              <label className="form-label">Home / city</label>
              <input
                className="form-input"
                value={profile.homeLocation ?? ""}
                onChange={event =>
                  setProfile(previous => ({
                    ...previous,
                    homeLocation: event.target.value,
                  }))
                }
              />
            </div>
            <div className="form-group">
              <label className="form-label">Blood group (optional)</label>
              <input
                className="form-input"
                value={profile.bloodGroup ?? ""}
                onChange={event =>
                  setProfile(previous => ({
                    ...previous,
                    bloodGroup: event.target.value,
                  }))
                }
              />
            </div>
            <div className="form-group">
              <label className="form-label">
                Emergency medical information (optional)
              </label>
              <input
                className="form-input"
                value={profile.medicalInfo ?? ""}
                onChange={event =>
                  setProfile(previous => ({
                    ...previous,
                    medicalInfo: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="button button-primary" onClick={saveProfile}>
              ✓ Profile updated
            </button>
          </div>
        </div>
        <div className="settings-section">
          <h2 className="section-title">Safety response</h2>
          <div className="setting-row">
            <div>
              <div className="setting-title">Fall detection</div>
              <div className="setting-caption">
                Prototype fall detection active
              </div>
            </div>
            <button
              className={`switch ${safetySettings.fallDetection ? "on" : ""}`}
              onClick={() =>
                setSafetySettings(previous => ({
                  ...previous,
                  fallDetection: !previous.fallDetection,
                }))
              }
            >
              <div className="switch-dot" />
            </button>
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-title">Automatic escalation</div>
              <div className="setting-caption">
                Continuously escalate if no response is received
              </div>
            </div>
            <button
              className={`switch ${safetySettings.automaticEscalation ? "on" : ""}`}
              onClick={() =>
                setSafetySettings(previous => ({
                  ...previous,
                  automaticEscalation: !previous.automaticEscalation,
                }))
              }
            >
              <div className="switch-dot" />
            </button>
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-title">Safety verification timer</div>
              <div className="setting-caption">
                Current default {safetySettings.safetyVerificationTimer}s
              </div>
            </div>
            <select
              className="form-input"
              value={safetySettings.safetyVerificationTimer}
              onChange={event =>
                setSafetySettings(previous => ({
                  ...previous,
                  safetyVerificationTimer: Number(event.target.value),
                }))
              }
              style={{ maxWidth: 110 }}
            >
              {[10, 15, 20, 30].map(option => (
                <option key={option} value={option}>
                  {option}s
                </option>
              ))}
            </select>
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-title">Severe event timer</div>
              <div className="setting-caption">
                Current default {safetySettings.severeEventTimer}s
              </div>
            </div>
            <select
              className="form-input"
              value={safetySettings.severeEventTimer}
              onChange={event =>
                setSafetySettings(previous => ({
                  ...previous,
                  severeEventTimer: Number(event.target.value),
                }))
              }
              style={{ maxWidth: 110 }}
            >
              {[5, 10, 15].map(option => (
                <option key={option} value={option}>
                  {option}s
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="settings-section">
          <h2 className="section-title">Alerts</h2>
          <div className="setting-row">
            <div>
              <div className="setting-title">Alert sound</div>
              <div className="setting-caption">
                Uses browser audio when allowed
              </div>
            </div>
            <button
              className={`switch ${alertSettings.sound ? "on" : ""}`}
              onClick={() =>
                setAlertSettings(previous => ({
                  ...previous,
                  sound: !previous.sound,
                }))
              }
            >
              <div className="switch-dot" />
            </button>
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-title">Vibration</div>
              <div className="setting-caption">
                Haptic feedback when supported
              </div>
            </div>
            <button
              className={`switch ${alertSettings.vibration ? "on" : ""}`}
              onClick={() =>
                setAlertSettings(previous => ({
                  ...previous,
                  vibration: !previous.vibration,
                }))
              }
            >
              <div className="switch-dot" />
            </button>
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-title">Visual alerts</div>
              <div className="setting-caption">
                Foreground banner and local notices
              </div>
            </div>
            <button
              className={`switch ${alertSettings.visualAlerts ? "on" : ""}`}
              onClick={() =>
                setAlertSettings(previous => ({
                  ...previous,
                  visualAlerts: !previous.visualAlerts,
                }))
              }
            >
              <div className="switch-dot" />
            </button>
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-title">Alert volume</div>
              <div className="setting-caption">
                Current {alertSettings.volume}%
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={alertSettings.volume}
              onChange={event =>
                setAlertSettings(previous => ({
                  ...previous,
                  volume: Number(event.target.value),
                }))
              }
              style={{ width: 120 }}
            />
          </div>
        </div>
        <div className="settings-section">
          <h2 className="section-title">Device</h2>
          <div className="setting-row">
            <div>
              <div className="setting-title">Connected device</div>
              <div className="setting-caption">
                AI Guardian Band · simulated
              </div>
            </div>
            <button className="switch on">
              <div className="switch-dot" />
            </button>
          </div>
        </div>
        <div className="settings-section">
          <h2 className="section-title">Data</h2>
          <div className="control-row" style={{ marginTop: 12 }}>
            <button
              className="button button-secondary"
              onClick={() => {
                setRiskHistory(chartSeed);
                setIncidents([]);
                toast.success("Simulated data reset");
              }}
            >
              Clear simulated data
            </button>
            <button
              className="button button-danger"
              onClick={() => {
                setScenario("normal");
                setSensor(previous => ({
                  ...previous,
                  ...scenarioData.normal,
                  updatedAt: new Date(),
                }));
                toast.info("Application reset to safe state");
              }}
            >
              Reset application
            </button>
          </div>
        </div>
      </div>
    </>
  );

  const renderAbout = () => (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Project information / BCA prototype</div>
          <h1 className="page-title">About AI Guardian</h1>
        </div>
        <Badge tone="safe">Production-quality prototype</Badge>
      </div>
      <div className="grid grid-2">
        <div className="panel panel-pad">
          <div className="section-head">
            <div>
              <h2 className="section-title">
                Intelligent protection. Faster response.
              </h2>
              <div className="section-caption">
                A technically honest academic safety platform
              </div>
            </div>
            <Shield size={19} color="#70e1c4" />
          </div>
          <p
            style={{
              color: "#a1b9bd",
              fontSize: 12,
              lineHeight: 1.7,
              marginTop: 0,
            }}
          >
            AI Guardian combines simulated wearable signals, contextual inputs,
            and an explainable risk engine to demonstrate how a future personal
            safety device could support faster response.
          </p>
          <div className="callout">
            The current build is intentionally simulation-first because ESP32
            hardware has not yet been purchased. Hardware integration points are
            documented and clearly separated from demo telemetry.
          </div>
        </div>
        <div className="panel panel-pad">
          <div className="section-head">
            <div>
              <h2 className="section-title">System architecture</h2>
              <div className="section-caption">
                The complete software workflow
              </div>
            </div>
            <Route size={17} color="#70e1c4" />
          </div>
          {[
            "Device / ESP32",
            "Sensor data",
            "Backend API",
            "AI risk analysis",
            "Risk score + explanation",
            "Emergency response workflow",
          ].map((item, i) => (
            <div className="workflow-step done" key={item}>
              <div className="step-number">{i + 1}</div>
              <div className="step-text">{item}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel panel-pad" style={{ marginTop: 14 }}>
        <div className="section-head">
          <div>
            <h2 className="section-title">Technology & limitations</h2>
            <div className="section-caption">
              Free/open-source friendly architecture
            </div>
          </div>
        </div>
        <div className="grid grid-3">
          <div>
            <div className="sensor-label">Frontend</div>
            <p style={{ color: "#abc0c3", fontSize: 11, lineHeight: 1.6 }}>
              React, TypeScript, Vite, Tailwind CSS, Recharts, Lucide.
            </p>
          </div>
          <div>
            <div className="sensor-label">Backend</div>
            <p style={{ color: "#abc0c3", fontSize: 11, lineHeight: 1.6 }}>
              Node/Express tRPC bridge in this WebDev build, with typed
              contracts and database-ready schema.
            </p>
          </div>
          <div>
            <div className="sensor-label">Safety boundary</div>
            <p style={{ color: "#abc0c3", fontSize: 11, lineHeight: 1.6 }}>
              No real emergency notification, medical accuracy, law-enforcement
              integration, or actual private location access.
            </p>
          </div>
        </div>
      </div>
    </>
  );

  const pageContent =
    page === "dashboard"
      ? renderDashboard()
      : page === "monitoring"
        ? renderMonitoring()
        : page === "emergency"
          ? renderEmergency()
          : page === "location"
            ? renderLocation()
            : page === "contacts"
              ? renderContacts()
              : page === "device"
                ? renderDevice()
                : page === "incidents"
                  ? renderIncidents()
                  : page === "analysis"
                    ? renderAnalysis()
                    : page === "settings"
                      ? renderSettings()
                      : renderAbout();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Logo />
        <div className="nav-section">Workspace</div>
        <nav className="nav-list">
          {navItems.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${page === item.id ? "active" : ""}`}
                onClick={() => setPage(item.id)}
              >
                <Icon size={15} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="mode-card">
            <div className="mode-label">
              <span className="mode-dot" />
              DEMO MODE
            </div>
            <p className="mode-copy">
              Simulation active. No real device data or emergency notifications.
            </p>
          </div>
          <div className="footer-note">
            AI Guardian v0.1 · BCA project prototype
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="mobile-header">
          <Logo />
          <div className="mobile-header-status">
            <span className="mode-dot" />{" "}
            {sensor.connected ? "Online" : "Offline"}
          </div>
          <button
            className="icon-button"
            onClick={() =>
              toast.info("Notifications are simulated in demo mode")
            }
            aria-label="Notifications"
          >
            <Bell size={16} />
          </button>
        </header>
        {!sensor.connected && (
          <div className="connection-lost" role="status">
            <Wifi size={15} />
            <div>
              <strong>CONNECTION LOST</strong>
              <span>
                Showing last known demo data · Last synchronized{" "}
                {timeLabel(sensor.updatedAt)}
              </span>
            </div>
          </div>
        )}
        {pageContent}
        <RealSafetyPanel
          mode={
            page === "emergency"
              ? "emergency"
              : page === "contacts"
                ? "contacts"
                : page === "location"
                  ? "location"
                  : page === "device"
                    ? "device"
                    : page === "incidents"
                      ? "incidents"
                      : page === "settings"
                        ? "settings"
                        : null
          }
        />
        <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
          {[
            { id: "dashboard" as Page, label: "Home", icon: HomeIcon },
            { id: "monitoring" as Page, label: "Monitor", icon: Activity },
            { id: "emergency" as Page, label: "Emergency", icon: Siren },
            { id: "location" as Page, label: "Location", icon: MapPin },
          ].map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`mobile-tab ${page === item.id ? "active" : ""} ${item.id === "emergency" ? "mobile-tab-danger" : ""}`}
                onClick={() => setPage(item.id)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
          <button
            className={`mobile-tab ${showMobileMore ? "active" : ""}`}
            onClick={() => setShowMobileMore(value => !value)}
          >
            <MoreHorizontal size={18} />
            <span>More</span>
          </button>
        </nav>
        {showMobileMore && (
          <div
            className="mobile-more-panel"
            role="dialog"
            aria-label="More sections"
          >
            {navItems.slice(4).map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className={`mobile-more-item ${page === item.id ? "active" : ""}`}
                  onClick={() => {
                    setPage(item.id);
                    setShowMobileMore(false);
                  }}
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
