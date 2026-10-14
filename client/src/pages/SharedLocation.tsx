import { useEffect, useState } from "react";
import { MapPin, RefreshCw, ShieldAlert } from "lucide-react";

type SharedLocationData = {
  status: string;
  event: string;
  startedAt: string | null;
  expiresAt: string | null;
  location: {
    latitude: number;
    longitude: number;
    accuracyMeters: number | null;
    recordedAt: string | null;
    mapUrl: string;
    isStale: boolean;
  } | null;
};

export default function SharedLocation({ token }: { token: string }) {
  const [data, setData] = useState<SharedLocationData | null>(null);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/safety/share/${encodeURIComponent(token)}`,
          {
            cache: "no-store",
            headers: { Accept: "application/json" },
          }
        );
        const result = (await response.json()) as SharedLocationData & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(
            result.error || "This live-location link is no longer available."
          );
        if (!mounted) return;
        setData(result);
        setError("");
        setUpdatedAt(new Date());
      } catch (cause) {
        if (mounted) {
          setData(null);
          setError(
            cause instanceof Error
              ? cause.message
              : "Live location is temporarily unavailable."
          );
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [token]);

  const format = (value: string | null | undefined) =>
    value ? new Date(value).toLocaleString() : "Not available";

  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "24px 16px",
        color: "#eaf0f5",
      }}
    >
      <meta name="robots" content="noindex,nofollow,noarchive" />
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <ShieldAlert size={24} color="#ff8989" />
        <div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            AI GUARDIAN · PRIVATE EMERGENCY SHARE
          </div>
          <h1 style={{ margin: "4px 0", fontSize: 24 }}>Live location</h1>
        </div>
        <button
          type="button"
          aria-label="Refresh location"
          onClick={() => window.location.reload()}
          style={{
            marginLeft: "auto",
            padding: 10,
            background: "transparent",
            color: "inherit",
            border: "1px solid #49616e",
            borderRadius: 8,
          }}
        >
          <RefreshCw size={16} />
        </button>
      </header>
      {error && (
        <div
          role="alert"
          style={{ padding: 14, border: "1px solid #ff8989", borderRadius: 10 }}
        >
          {error}
        </div>
      )}
      {data && (
        <section
          style={{
            background: "#17232b",
            border: "1px solid #30434d",
            borderRadius: 12,
            padding: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <strong>Emergency status: {data.status}</strong>
            <span>Event: {data.event}</span>
          </div>
          <p style={{ opacity: 0.75 }}>
            Started: {format(data.startedAt)} · Link expires:{" "}
            {format(data.expiresAt)}
          </p>
          {data.location ? (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  margin: "16px 0",
                }}
              >
                <MapPin size={18} color="#70e1c4" />
                <strong>
                  {data.location.latitude}, {data.location.longitude}
                </strong>
              </div>
              <p>
                {data.location.isStale
                  ? "Last reported location · "
                  : "Last reported location · "}
                Updated: {format(data.location.recordedAt)} · Accuracy:{" "}
                {data.location.accuracyMeters == null
                  ? "unknown"
                  : `± ${Math.round(data.location.accuracyMeters)} m`}
              </p>
              {data.location.isStale && (
                <p role="status">
                  This fix is stale; it may not represent the person&apos;s
                  current position.
                </p>
              )}
              <iframe
                title="Shared emergency location map"
                src={`${data.location.mapUrl}&output=embed`}
                referrerPolicy="no-referrer"
                loading="lazy"
                style={{
                  width: "100%",
                  height: 320,
                  border: 0,
                  borderRadius: 8,
                  background: "#0f171c",
                }}
              />
              <a
                href={data.location.mapUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-block",
                  marginTop: 12,
                  color: "#70e1c4",
                }}
              >
                Open in Google Maps
              </a>
            </>
          ) : (
            <p role="status">
              No GPS fix has been reported yet. This page will refresh when the
              authorized device uploads a location.
            </p>
          )}
          <p style={{ marginTop: 18, fontSize: 12, opacity: 0.65 }}>
            Page refreshed: {updatedAt?.toLocaleTimeString() ?? "Loading"} ·
            Link access is private to its recipients and can be revoked by the
            account holder.
          </p>
        </section>
      )}
    </main>
  );
}
