import { useEffect, useRef, useState } from "react";
import { Check, MapPin, RefreshCw, Siren, X } from "lucide-react";
import { COOKIE_NAME } from "@shared/const";

type PanelMode =
  | "emergency"
  | "contacts"
  | "location"
  | "device"
  | "incidents"
  | "settings"
  | null;
type SafetyStatus = {
  phone: {
    verified: boolean;
    verifiedAt: string | null;
    masked: string | null;
  };
  contacts: { total: number; enabled: number; verifiedEnabled: number };
  provider: {
    otpConfigured: boolean;
    publicUrlConfigured: boolean;
  };
  locationUpdateIntervalSeconds: number;
  location: {
    deviceId: string;
    latitude: number;
    longitude: number;
    accuracyMeters: number | null;
    recordedAt: string | null;
    isStale: boolean;
  } | null;
  activeIncident: {
    id: string;
    status: string;
    sharing: boolean;
    startedAt: string | null;
  } | null;
};
type RealContact = {
  id: number;
  name: string;
  relationship: string;
  phone: string;
  priority: number;
  enabled: boolean;
  phoneVerifiedAt: string | null;
  trusted?: boolean;
};
type IncidentView = {
  id: string;
  status: string;
  trigger: string;
  responseStatus: string;
  startedAt: string | null;
  notifications: {
    attemptId: number;
    contactId: number;
    status: string;
    providerMessageId: string | null;
    canRetry: boolean;
  }[];
  timeline: {
    type: string;
    details: string | null;
    timestamp: string | null;
  }[];
};

async function safetyRequest<T>(
  path: string,
  body?: unknown,
  method?: string
): Promise<T> {
  const headers = new Headers({ "content-type": "application/json" });
  try {
    const raw = sessionStorage.getItem("manus-cookie");
    if (raw) {
      const prefix = `${COOKIE_NAME}=`;
      const pair = raw
        .split(";")
        .find(value => value.trim().startsWith(prefix));
      const token = pair?.trim().slice(prefix.length);
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }
  } catch {
    // The secure session cookie remains the normal authentication mechanism.
  }
  let response: globalThis.Response;
  try {
    response = await fetch(path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers,
      credentials: "include",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error("Could not reach AI Guardian. Check your network and try again.");
  }
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(data.error ?? `Request failed (${response.status}).`);
  return data;
}

function getBrowserLocation(): Promise<GeolocationPosition> {
  if (!navigator.geolocation)
    return Promise.reject(
      new Error("This browser does not provide GPS location.")
    );
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(
      resolve,
      error => {
        const reason =
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied."
            : error.code === error.POSITION_UNAVAILABLE
              ? "GPS location is unavailable."
              : "GPS location request timed out.";
        reject(new Error(reason));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    )
  );
}

function locationPayload(position: GeolocationPosition) {
  let deviceId = "ai-guardian-browser";
  try {
    deviceId = localStorage.getItem("ai-guardian-device-id") ?? "";
    if (!deviceId) {
      deviceId = `web-${crypto.randomUUID()}`;
      localStorage.setItem("ai-guardian-device-id", deviceId);
    }
  } catch {
    deviceId = "ai-guardian-browser";
  }
  return {
    deviceId,
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMeters: Number.isFinite(position.coords.accuracy)
      ? position.coords.accuracy
      : null,
    recordedAt: new Date(position.timestamp).toISOString(),
  };
}

function when(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not available";
}

export function RealSafetyPanel({ mode }: { mode: PanelMode }) {
  const [status, setStatus] = useState<SafetyStatus | null>(null);
  const [contacts, setContacts] = useState<RealContact[]>([]);
  const [incidents, setIncidents] = useState<IncidentView[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [otpContext, setOtpContext] = useState<"account" | null>(null);
  const [challengeId, setChallengeId] = useState("");
  const [otp, setOtp] = useState("");
  const [phone, setPhone] = useState("");
  const [accountPhone, setAccountPhone] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [contactForm, setContactForm] = useState({
    name: "",
    relationship: "",
    phone: "",
    priority: 1,
    trusted: false,
  });
  const [trackingUrl, setTrackingUrl] = useState("");
  const locationConsented = useRef(false);

  const reload = async () => {
    try {
      const [nextStatus, nextContacts, nextIncidents] = await Promise.all([
        safetyRequest<SafetyStatus>("/api/safety/status"),
        safetyRequest<RealContact[]>("/api/safety/contacts"),
        safetyRequest<IncidentView[]>("/api/safety/incidents"),
      ]);
      setStatus(nextStatus);
      setContacts(nextContacts);
      setIncidents(nextIncidents);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Safety service is unavailable."
      );
    }
  };

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!status?.activeIncident || !locationConsented.current) return;
    const timer = window.setInterval(() => {
      void getBrowserLocation()
        .then(position =>
          safetyRequest("/api/safety/location", locationPayload(position))
        )
        .then(() => reload())
        .catch(cause =>
          setError(
            cause instanceof Error ? cause.message : "Location update failed."
          )
        );
    }, status.locationUpdateIntervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [status?.activeIncident?.id, status?.locationUpdateIntervalSeconds]);

  if (!mode) return null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The safety request failed."
      );
    } finally {
      setBusy(false);
    }
  };

  const requestOtp = (targetPhone: string) =>
    run(async () => {
      const response = await safetyRequest<{
        challengeId: string;
        message?: string;
      }>(
        "/api/auth/otp/send",
        {
          phone: targetPhone,
          purpose: "account",
        }
      );
      setChallengeId(response.challengeId);
      setPhone(targetPhone);
      setOtpContext("account");
      setOtp("");
      setNotice(
        response.message ??
          "The verification request was accepted. Check your phone for the provider's message."
      );
    });

  const verifyOtp = () =>
    run(async () => {
      await safetyRequest("/api/auth/otp/verify", {
        challengeId,
        phone,
        otp,
        purpose: "account",
      });
      setOtpContext(null);
      setOtp("");
      setAccountPhone("");
      await reload();
      setNotice("Your account phone number is verified.");
    });

  const saveContact = () =>
    run(async () => {
      const phone = contactForm.phone.trim().replace(/[()\s-]/g, "");
      if (!/^\+[1-9]\d{7,14}$/.test(phone))
        throw new Error(
          "Enter a valid international phone number, for example +919876543210."
        );
      const path =
        editId === null
          ? "/api/safety/contacts"
          : `/api/safety/contacts/${editId}`;
      const result = await safetyRequest<{ message: string }>(
        path,
        {
          ...contactForm,
          phone,
          enabled: contactForm.trusted,
        },
        editId === null ? "POST" : "PATCH"
      );
      setEditId(null);
      setOtpContext(null);
      setChallengeId("");
      setContactForm({
        name: "",
        relationship: "",
        phone: "",
        priority: 1,
        trusted: false,
      });
      await reload();
      setNotice(result.message);
    });

  const submitLocation = () =>
    run(async () => {
      const position = await getBrowserLocation();
      locationConsented.current = true;
      await safetyRequest("/api/safety/location", locationPayload(position));
      await reload();
    });

  const activateSos = () =>
    run(async () => {
      let location: ReturnType<typeof locationPayload> | undefined;
      let gpsWarning = "";
      try {
        const position = await getBrowserLocation();
        location = locationPayload(position);
        locationConsented.current = true;
      } catch (cause) {
        gpsWarning =
          cause instanceof Error ? cause.message : "GPS unavailable.";
      }
      const result = await safetyRequest<{
        liveLocationUrl: string;
        notifications: { status: string }[];
        message: string;
      }>("/api/safety/sos", {
        trigger: "SOS",
        ...(location ? { location } : {}),
      });
      setTrackingUrl(result.liveLocationUrl);
      await reload();
      setNotice(result.message);
      if (gpsWarning)
        setError(`SOS was recorded without a fresh GPS fix. ${gpsWarning}`);
    });

  const resolveIncident = (id: string) =>
    run(async () => {
      await safetyRequest(`/api/safety/incidents/${id}/resolve`, {
        resolution: "User marked safe",
      });
      locationConsented.current = false;
      await reload();
    });

  const revokeSharing = (id: string) =>
    run(async () => {
      await safetyRequest(`/api/safety/incidents/${id}/sharing/revoke`, {});
      await reload();
    });

  const editContact = (contact: RealContact) => {
    setEditId(contact.id);
    setOtpContext(null);
    setChallengeId("");
    setContactForm({
      name: contact.name,
      relationship: contact.relationship,
      phone: contact.phone,
      priority: contact.priority,
      trusted: contact.enabled,
    });
  };

  const cardStyle = { marginTop: 14 };

  return (
    <section
      className="panel panel-pad"
      style={cardStyle}
      aria-label="Real safety integrations"
    >
      <div className="section-head">
        <div>
          <div className="eyebrow">Authenticated provider integrations</div>
          <h2 className="section-title">
            {mode === "contacts"
              ? "Trusted emergency contacts"
              : mode === "location"
                ? "Device location sharing"
                : mode === "device"
                  ? "Authorized device status"
                  : mode === "settings"
                    ? "Phone verification"
                    : mode === "incidents"
                      ? "Real incident outcomes"
                      : "Real SOS"}
          </h2>
          <div className="section-caption">
            Separate from the local simulation. Emergency SMS is prepared in
            Android's messaging app; sending and delivery are never inferred by
            the website.
          </div>
        </div>
        <button
          className="icon-button"
          onClick={() => void reload()}
          aria-label="Refresh safety status"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {error && (
        <div
          className="callout"
          role="alert"
          style={{ margin: "12px 0", borderColor: "#ff8989" }}
        >
          {error}
        </div>
      )}
      {notice && (
        <div className="callout" role="status" style={{ margin: "12px 0" }}>
          {notice}
        </div>
      )}
      {!status && !error && (
        <div className="device-label">Loading authenticated safety status…</div>
      )}
      {status && (
        <div className="grid grid-3" style={{ marginTop: 12 }}>
          <div className="device-row">
            <span className="device-label">Account-phone OTP</span>
            <span className="device-value">
              {status.provider.otpConfigured ? "Configured" : "Not configured"}
            </span>
          </div>
          <div className="device-row">
            <span className="device-label">Emergency SMS</span>
            <span className="device-value">Android phone messaging app</span>
          </div>
          <div className="device-row">
            <span className="device-label">Public tracking origin</span>
            <span className="device-value">
              {status.provider.publicUrlConfigured
                ? "Configured"
                : "Not configured"}
            </span>
          </div>
          <div className="device-row">
            <span className="device-label">Trusted contacts</span>
            <span className="device-value">
              {status.contacts.enabled}
            </span>
          </div>
          <div className="device-row">
            <span className="device-label">Trusted numbers verified</span>
            <span className="device-value">
              {status.contacts.verifiedEnabled}
            </span>
          </div>
        </div>
      )}

      {mode === "emergency" && (
        <>
          <div className="callout" style={{ marginTop: 12 }}>
            SOS records the incident and live-location link on the website but
            does not send SMS. Use the Android app to select a trusted contact,
            obtain device location, and review and confirm the message in your
            phone's messaging app. No server-side SMS gateway is used.
          </div>
          {status?.activeIncident ? (
            <div style={{ marginTop: 12 }}>
              <div className="device-row">
                <span className="device-label">Active incident</span>
                <span className="device-value">{status.activeIncident.id}</span>
              </div>
              <div className="device-row">
                <span className="device-label">Live sharing</span>
                <span className="device-value">
                  {status.activeIncident.sharing
                    ? "Active"
                    : "Stopped / expired"}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  marginTop: 12,
                }}
              >
                <button
                  className="button button-danger"
                  disabled={busy}
                  onClick={() =>
                    void resolveIncident(status.activeIncident!.id)
                  }
                >
                  <Check size={14} /> Resolve emergency
                </button>
                {status.activeIncident.sharing && (
                  <button
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() =>
                      void revokeSharing(status.activeIncident!.id)
                    }
                  >
                    <X size={14} /> Revoke live link
                  </button>
                )}
              </div>
            </div>
          ) : (
            <button
              className="button button-danger button-wide"
              style={{ marginTop: 14 }}
              disabled={busy || !status}
              onClick={() => void activateSos()}
            >
              <Siren size={15} /> {busy ? "Recording SOS…" : "Record SOS"}
            </button>
          )}
          {trackingUrl && (
            <div className="device-row" style={{ marginTop: 12 }}>
              <span className="device-label">Expiring recipient link</span>
              <a
                className="device-value"
                href={trackingUrl}
                target="_blank"
                rel="noreferrer"
              >
                {trackingUrl}
              </a>
            </div>
          )}
          {incidents[0] && (
            <div className="device-row" style={{ marginTop: 12 }}>
              <span className="device-label">Latest notification status</span>
              <span className="device-value">
                {incidents[0].notifications
                  .map(item => item.status)
                  .join(", ") || "No SMS sent from the website"}
              </span>
            </div>
          )}
        </>
      )}

      {mode === "contacts" && (
        <>
          <div className="callout" style={{ marginTop: 12 }}>
            Add a number in international format (for example
            +919876543210). Marking a contact as trusted is your consent to use
            it for SOS in the Android app; this does not verify ownership of
            that phone number. Android opens the phone's messaging app, and you
            must confirm sending.
          </div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            {(
              [
                ["Name", "name"],
                ["Relationship", "relationship"],
                ["Phone (+country code)", "phone"],
              ] as const
            ).map(([label, field]) => (
              <label className="form-group" key={field}>
                <span className="form-label">{label}</span>
                <input
                  className="form-input"
                  value={contactForm[field]}
                  onChange={event =>
                    setContactForm({
                      ...contactForm,
                      [field]: event.target.value,
                      ...(field === "phone" &&
                      editId !== null &&
                      event.target.value !==
                        contacts.find(contact => contact.id === editId)?.phone
                        ? { trusted: false }
                        : {}),
                    })
                  }
                />
              </label>
            ))}
            <label className="form-group">
              <span className="form-label">Priority</span>
              <select
                className="form-input"
                value={contactForm.priority}
                onChange={event =>
                  setContactForm({
                    ...contactForm,
                    priority: Number(event.target.value),
                  })
                }
              >
                <option value={1}>1 · Highest</option>
                <option value={2}>2</option>
                <option value={3}>3 · Lowest</option>
              </select>
            </label>
          </div>
          <label
            className="form-group"
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              marginTop: 10,
            }}
          >
            <input
              type="checkbox"
              checked={contactForm.trusted}
              onChange={event =>
                setContactForm({
                  ...contactForm,
                  trusted: event.target.checked,
                })
              }
            />
            <span className="form-label">
              I trust this contact and authorize this number for Android SOS messages
            </span>
          </label>
          <div
            style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}
          >
            {editId === null && (
              <button
                className="button button-primary"
                disabled={busy}
                onClick={() => void saveContact()}
              >
                {busy ? "Saving contact…" : "Add emergency contact"}
              </button>
            )}
            {editId !== null && (
              <button
                className="button button-primary"
                disabled={busy}
                onClick={() => void saveContact()}
              >
                Save contact changes
              </button>
            )}
            {editId !== null && (
              <button
                className="button button-ghost"
                onClick={() => {
                  setEditId(null);
                  setContactForm({
                    name: "",
                    relationship: "",
                    phone: "",
                    priority: 1,
                    trusted: false,
                  });
                }}
              >
                Cancel edit
              </button>
            )}
          </div>
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table>
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Phone status</th>
                  <th>Priority</th>
                  <th>Trusted for SOS</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map(contact => (
                  <tr key={contact.id}>
                    <td>
                      <strong>{contact.name}</strong>
                      <div className="device-label">
                        {contact.relationship} · {contact.phone}
                      </div>
                    </td>
                    <td>
                      Phone {contact.phoneVerifiedAt ? "verified" : "unverified"}
                    </td>
                    <td>
                      <select
                        aria-label={`Priority for ${contact.name}`}
                        value={contact.priority}
                        onChange={event =>
                          void run(async () => {
                            await safetyRequest(
                              `/api/safety/contacts/${contact.id}`,
                              { priority: Number(event.target.value) },
                              "PATCH"
                            );
                            await reload();
                          })
                        }
                      >
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                        <option value={3}>3</option>
                      </select>
                    </td>
                    <td>
                      <button
                        className={`switch ${contact.enabled ? "on" : ""}`}
                        aria-label={`${contact.enabled ? "Stop trusting" : "Trust"} ${contact.name} for Android SOS`}
                        onClick={() =>
                          void run(async () => {
                            await safetyRequest(
                              `/api/safety/contacts/${contact.id}`,
                              { enabled: !contact.enabled },
                              "PATCH"
                            );
                            await reload();
                          })
                        }
                      >
                        <span className="switch-dot" />
                      </button>
                    </td>
                    <td>
                      <button
                        className="button button-ghost"
                        onClick={() => editContact(contact)}
                      >
                        Edit
                      </button>
                      <button
                        className="button button-ghost"
                        onClick={() =>
                          void run(async () => {
                            await safetyRequest(
                              `/api/safety/contacts/${contact.id}`,
                              undefined,
                              "DELETE"
                            );
                            await reload();
                          })
                        }
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {(mode === "location" || mode === "device") && (
        <>
          <div className="callout" style={{ marginTop: 12 }}>
            A browser or mobile device must explicitly grant location access and
            transmit fixes. A text-message link alone cannot track a phone.
            Browser reporting is foreground-only. The Android app currently
            reports a one-time SOS fix; periodic background Android tracking is
            not implemented.
          </div>
          <div className="device-row" style={{ marginTop: 12 }}>
            <span className="device-label">Latest fix</span>
            <span className="device-value">
              {status?.location
                ? `${status.location.latitude}, ${status.location.longitude}`
                : "No location reported"}
            </span>
          </div>
          {mode === "device" && (
            <div className="device-row">
              <span className="device-label">Reporting device</span>
              <span className="device-value">
                {status?.location?.deviceId ??
                  "No authenticated device has reported"}
              </span>
            </div>
          )}
          <div className="device-row">
            <span className="device-label">Updated</span>
            <span className="device-value">
              {when(status?.location?.recordedAt)}
            </span>
          </div>
          <div className="device-row">
            <span className="device-label">Accuracy / freshness</span>
            <span className="device-value">
              {status?.location?.accuracyMeters == null
                ? "Unknown"
                : `± ${Math.round(status.location.accuracyMeters)} m`}{" "}
              ·{" "}
              {status?.location?.isStale
                ? "stale"
                : status?.location
                  ? "recent"
                  : "unavailable"}
            </span>
          </div>
          {status?.location && (
            <a
              className="button button-secondary"
              style={{ marginTop: 10, display: "inline-flex" }}
              href={`https://maps.google.com/?q=${status.location.latitude},${status.location.longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              <MapPin size={14} /> Open latest reported location
            </a>
          )}
          <div>
            <button
              className="button button-primary"
              style={{ marginTop: 12 }}
              disabled={busy}
              onClick={() => void submitLocation()}
            >
              <MapPin size={14} /> Share current device location
            </button>
          </div>
        </>
      )}

      {mode === "settings" && (
        <>
          <div className="device-row" style={{ marginTop: 12 }}>
            <span className="device-label">Verified account phone</span>
            <span className="device-value">
              {status?.phone.masked ?? "Not verified"}
            </span>
          </div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="form-group">
              <span className="form-label">Phone (+country code)</span>
              <input
                className="form-input"
                value={accountPhone}
                onChange={event => setAccountPhone(event.target.value)}
                placeholder="+919876543210"
              />
            </label>
            <button
              className="button button-secondary"
              style={{ alignSelf: "end" }}
              disabled={busy || !accountPhone}
              onClick={() => void requestOtp(accountPhone)}
            >
              Send account OTP
            </button>
          </div>
          {otpContext === "account" && challengeId && (
            <div className="form-grid" style={{ marginTop: 10 }}>
              <label className="form-group">
                <span className="form-label">Six-digit code</span>
                <input
                  className="form-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otp}
                  onChange={event =>
                    setOtp(event.target.value.replace(/\D/g, ""))
                  }
                />
              </label>
              <button
                className="button button-primary"
                style={{ alignSelf: "end" }}
                disabled={busy || otp.length !== 6}
                onClick={() => void verifyOtp()}
              >
                Verify account phone
              </button>
            </div>
          )}
        </>
      )}

      {mode === "incidents" && (
        <div style={{ marginTop: 12 }}>
          {incidents.map(incident => (
            <div
              key={incident.id}
              style={{
                padding: "10px 0",
                borderBottom: "1px solid rgba(255,255,255,.08)",
              }}
            >
              <div className="device-row">
                <span>
                  <span className="device-value">
                    {incident.trigger} · {incident.status}
                  </span>
                  <span className="device-label" style={{ display: "block" }}>
                    {when(incident.startedAt)}
                  </span>
                </span>
              </div>
              <div className="device-label" style={{ marginTop: 4 }}>
                Actual response status: {incident.responseStatus}
              </div>
              {incident.notifications.length ? (
                incident.notifications.map(item => (
                  <div className="device-row" key={item.attemptId}>
                    <span className="device-label">
                      Contact {item.contactId}
                    </span>
                    <span
                      style={{ display: "flex", gap: 8, alignItems: "center" }}
                    >
                      <span className="device-value">{item.status}</span>
                      {item.canRetry && (
                        <button
                          className="button button-secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const result = await safetyRequest<{
                                status: string;
                                message: string;
                              }>(
                                `/api/safety/notifications/${item.attemptId}/retry`,
                                {}
                              );
                              setNotice(result.message);
                              await reload();
                            })
                          }
                        >
                          Retry safe failure
                        </button>
                      )}
                    </span>
                  </div>
                ))
              ) : incident.timeline.some(
                  event => event.type === "android_sos_started"
                ) ? (
                <div className="device-label">
                  SMS is prepared by the Android phone. User action is recorded
                  separately; carrier delivery is unconfirmed.
                </div>
              ) : (
                <div className="device-label">
                  No SMS was sent from the website. Use the Android app to prepare a message in the phone's messaging app.
                </div>
              )}
            </div>
          ))}
          {!incidents.length && (
            <div className="device-label">
              No authenticated emergency incidents recorded.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
