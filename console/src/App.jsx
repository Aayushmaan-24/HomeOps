import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBus } from "./useBus.js";
import { modeLabel } from "./eventMeta.js";

const BUS_URL = import.meta.env.VITE_BUS_URL || "http://localhost:8000";
const ZONES = ["front_door", "back_door", "garage"];

// Simulation control panel state. Dropdown changes only update local state;
// the bus is touched once, by the Fire button, using the same payloads the CLI
// sim commands already post (sensor.doorbell / sensor.motion with optional who +
// when). Home/Leaving/Status map to the CLI commands the agent already knows.
const SIM_EVENT_TYPES = [
  { value: "sensor.doorbell", label: "Doorbell" },
  { value: "sensor.motion", label: "Motion" },
];
const SIM_WHO = [
  { value: "", label: "—" },
  { value: "friend", label: "Friend" },
  { value: "delivery", label: "Delivery" },
  { value: "unknown", label: "Unknown" },
];
const SIM_WHEN = [
  { value: "", label: "—" },
  { value: "day", label: "Day" },
  { value: "night", label: "Night" },
];

async function postEvent(eventType, source, payload) {
  const resp = await fetch(`${BUS_URL}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: eventType, source, payload }),
  });
  if (!resp.ok) {
    console.error(`event post failed: ${resp.status}`);
  }
}

function fireSimulation(eventType, who, when) {
  const payload = { zone: "front_door" };
  if (who) payload.who = who;
  if (when) payload.when = when;
  // Mirror the already-tested CLI sim payloads (event-sim source).
  postEvent(eventType, "event-sim", payload);
}
const pretty = (s) => String(s).replace(/_/g, " ");

// Per-type presentation only. Hues stay restrained: green for operator input,
// amber for voice/vision, red for sensors, teal for mode, blue for the agent.
const META = {
  "cli.command": { label: "Command", color: "#9ad1a0" },
  "voice.utterance": { label: "Heard", color: "#e3c46e" },
  "voice.say": { label: "Spoke", color: "#e3c46e" },
  "sensor.doorbell": { label: "Doorbell", color: "#ff8a8d" },
  "sensor.motion": { label: "Motion", color: "#ff8a8d" },
  "cv.detection": { label: "Detection", color: "#ffb454" },
  "home.mode": { label: "Mode", color: "#2dd4bf" },
  "agent.thought": { label: "Thought", color: "#8ab4f0" },
  "agent.action": { label: "Action", color: "#8ab4f0" },
};

const clock = (ts) => {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const stamp = (ts) => {
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
};

// Feed categories are derived from the existing event types only; each type
// belongs to exactly one bucket.
const CATEGORIES = [
  { key: "all", label: "All" },
  { key: "security", label: "Security" },
  { key: "camera", label: "Camera" },
  { key: "agent", label: "Agent" },
  { key: "system", label: "System" },
];

const CATEGORY_OF = {
  "sensor.doorbell": "security",
  "sensor.motion": "security",
  "home.mode": "security",
  "cv.detection": "camera",
  "agent.thought": "agent",
  "agent.action": "agent",
  "voice.say": "agent",
  "cli.command": "system",
  "voice.utterance": "system",
};

const categoryOf = (type) => CATEGORY_OF[type] || "system";

function summary(e) {
  const p = e.payload || {};
  switch (e.type) {
    case "cli.command": return `“${p.command}”`;
    case "voice.utterance": return `“${p.text}”`;
    case "voice.say": return p.text;
    case "sensor.doorbell":
    case "sensor.motion": return pretty(p.zone ?? "");
    case "cv.detection": return `${p.label ?? "object"}${p.zone ? " at " + pretty(p.zone) : ""}`;
    case "home.mode": return `→ ${String(p.mode).toUpperCase()}`;
    case "agent.action": return `${p.tool}${typeof p.result === "string" ? " · " + p.result : ""}`;
    case "agent.thought": return p.text;
    default: return JSON.stringify(p);
  }
}

// Tool arguments render as short key/value chips. Values are flattened and
// clipped so a large payload can never blow up the panel; the untruncated value
// stays available in the chip's title attribute.
const ARG_LIMIT = 90;
const RESULT_LIMIT = 160;

function truncate(value, limit) {
  const text = String(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function formatArg(value) {
  if (Array.isArray(value)) return value.map(formatArg).join(", ");
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[unreadable]";
    }
  }
  return String(value);
}

function argPairs(args) {
  return Object.entries(args || {}).filter(([key]) => key !== "reason");
}

// agent.action.payload.result is a plain string from the MCP tools today, so
// there is no success flag to trust and nothing is inferred from wording.
// Object-shaped results (and an explicit ok:false / error) are handled
// defensively in case the agent ever reports one.
function resultView(payload) {
  const result = payload.result;
  if (payload.error) return { tone: "error", text: String(payload.error) };
  if (payload.ok === false) return { tone: "error", text: "Tool reported failure" };
  if (result == null) return { tone: "muted", text: "no result" };
  if (typeof result === "string") return { tone: "ok", text: result || "no result" };
  if (typeof result === "object") {
    if (result.ok === false || result.error) {
      return { tone: "error", text: String(result.error ?? "Tool reported failure") };
    }
    try {
      return { tone: "ok", text: JSON.stringify(result) };
    } catch {
      return { tone: "muted", text: "unreadable result" };
    }
  }
  return { tone: "ok", text: String(result) };
}

const RESULT_MARK = { ok: "✓", error: "✕", muted: "•" };

// notify.severity is a closed set; anything else falls back to info so the
// alert-centre styling always has a known tone. The log is bounded because the
// UI has no backend persistence to lean on.
const SEVERITIES = ["info", "warning", "critical"];
const ALERT_LOG_LIMIT = 20;

function normalizeSeverity(value) {
  return SEVERITIES.includes(value) ? value : "info";
}

// cv.detection payload -> panel model. Missing fields stay null/empty so the UI
// can degrade instead of inventing values.
function detectionFromEvent(e) {
  const p = (e && e.payload) || {};
  return {
    frame: typeof p.frame === "string" && p.frame ? p.frame : null,
    label: typeof p.label === "string" && p.label ? p.label : "unknown",
    confidence: typeof p.confidence === "number" ? p.confidence : null,
    people: typeof p.people === "number" ? p.people : null,
    objects: Array.isArray(p.objects) ? p.objects.filter((o) => typeof o === "string") : [],
    when: typeof p.when === "string" && p.when ? p.when : null,
    zone: typeof p.zone === "string" && p.zone ? p.zone : null,
    ts: e.ts,
  };
}

// "nothing" only means the detector found no relevant object, not that the
// doorstep is empty, so it must not read as "no one there".
const DETECTION_LABELS = {
  person: { text: "Person detected", tone: "danger" },
  package: { text: "Package", tone: "info" },
  nothing: { text: "No detection", tone: "" },
};

function detectionLabel(label) {
  if (!label) return { text: "Unknown", tone: "" };
  return DETECTION_LABELS[label] || { text: pretty(label).toUpperCase(), tone: "" };
}

function detectionMeta(d) {
  const parts = [];
  if (typeof d.confidence === "number") parts.push(`conf ${Math.round(d.confidence * 100)}%`);
  if (typeof d.people === "number") parts.push(d.people === 1 ? "1 person" : `${d.people} people`);
  if (d.objects.length) parts.push(d.objects.join(", "));
  return parts.join(" · ");
}

function Step({ e, latest }) {
  const p = e.payload || {};
  const cls = latest ? " latest" : "";
  const source = typeof e.source === "string" && e.source ? e.source : null;

  if (e.type === "agent.thought") {
    return (
      <div className={`step thought${cls}`}>
        <span className="node" />
        <div className="body">
          <div className="meta">
            <span className="kind">Thought</span>
            <span className="mt">{clock(e.ts)}</span>
            {source && <span className="src">{source}</span>}
          </div>
          <p>{p.text}</p>
        </div>
      </div>
    );
  }
  if (e.type === "agent.action") {
    const tool = typeof p.tool === "string" && p.tool ? p.tool : "unknown tool";
    const reason = typeof p.args?.reason === "string" && p.args.reason ? p.args.reason : null;
    const pairs = argPairs(p.args);
    const res = resultView(p);
    return (
      <div className={`step action${cls}`}>
        <span className="node" />
        <div className="body">
          <div className="meta">
            <span className="kind">Tool call</span>
            <span className="mt">{clock(e.ts)}</span>
            {source && <span className="src">{source}</span>}
          </div>
          <div className="tool">
            <div className="tool-head">
              <code>{tool}</code>
              {pairs.map(([key, value]) => {
                const text = formatArg(value);
                return (
                  <span className="arg" key={key} title={`${key}: ${text}`}>
                    <b>{key}</b> {truncate(text, ARG_LIMIT)}
                  </span>
                );
              })}
              <span className={`result ${res.tone}`} title={res.text}>
                {RESULT_MARK[res.tone]} {truncate(res.text, RESULT_LIMIT)}
              </span>
            </div>
            {reason && (
              <p className="reason" title={reason}>
                <span>Reason</span> {reason}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={`step say${cls}`}>
      <span className="node" />
      <div className="body">
        <div className="meta">
          <span className="kind">Voice</span>
          <span className="mt">{clock(e.ts)}</span>
          {source && <span className="src">{source}</span>}
        </div>
        <div className="bubble">{p.text}</div>
      </div>
    </div>
  );
}

const CARDS = [
  { key: "perception", name: "Perception", idle: "watching feeds" },
  { key: "security", name: "Security", idle: "on watch" },
  { key: "comms", name: "Comms", idle: "standing by" },
];

export default function App() {
  const [mode, setMode] = useState("normal");
  const [simEventType, setSimEventType] = useState("sensor.doorbell");
  const [simWho, setSimWho] = useState("");
  const [simWhen, setSimWhen] = useState("");
  const [events, setEvents] = useState([]); // newest first
  const [feedCategory, setFeedCategory] = useState("all");
  const [feedQuery, setFeedQuery] = useState("");
  const [feedPaused, setFeedPaused] = useState(false);
  const [frozenEvents, setFrozenEvents] = useState([]);
  const [active, setActive] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [alertLog, setAlertLog] = useState([]);
  const [camera, setCamera] = useState(null);
  const [failedFrame, setFailedFrame] = useState(null); // ts of a frame that failed to load
  const [now, setNow] = useState(() => new Date());
  const [following, setFollowing] = useState(true);
  const seen = useRef(new Set());
  const timers = useRef({});
  const listRef = useRef(null);
  const logRef = useRef(null);
  const autoScroll = useRef(false);

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);

  const pulse = useCallback((key) => {
    setActive((a) => ({ ...a, [key]: true }));
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => setActive((a) => ({ ...a, [key]: false })), 3000);
  }, []);

  // Pausing freezes a snapshot of the feed only; addEvent keeps updating mode,
  // camera, alerts and the trace, and resume switches back to the live list.
  const toggleFeedPause = useCallback(() => {
    if (feedPaused) {
      setFeedPaused(false);
      setFrozenEvents([]);
    } else {
      setFrozenEvents(events);
      setFeedPaused(true);
    }
  }, [feedPaused, events]);

  const resetFeedFilters = useCallback(() => {
    setFeedCategory("all");
    setFeedQuery("");
  }, []);

  const dismissAlert = useCallback((key) => {
    setAlertLog((prev) => prev.filter((a) => a.key !== key));
    // The focused button disappears with its row, so hand focus back to the
    // region to keep keyboard and screen-reader position predictable.
    requestAnimationFrame(() => {
      if (logRef.current) logRef.current.focus();
    });
  }, []);

  // Newest-wins, so a replayed /state detection can never replace a live one
  // that arrived while the initial fetch was still in flight (or vice versa).
  const applyDetection = useCallback((next) => {
    setCamera((cur) => {
      const curTs = cur ? Date.parse(cur.ts) : NaN;
      const nextTs = Date.parse(next.ts);
      return curTs > nextTs ? cur : next;
    });
  }, []);

  const addEvent = useCallback(
    (e, fromState = false) => {
      const key = `${e.id}|${e.ts}`;
      if (seen.current.has(key)) return;
      seen.current.add(key);
      setEvents((prev) => [e, ...prev].sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 100));
      const p = e.payload || {};

      // Notifications feed the alert centre for replayed and live events alike;
      // only live events also raise a transient banner. The event's own id+ts is
      // the stable dedupe key, and the log stays bounded.
      if (e.type === "agent.action" && p.tool === "notify") {
        const args = p.args || {};
        const entry = {
          key,
          severity: normalizeSeverity(args.severity),
          title: typeof args.title === "string" && args.title ? args.title : "Notification",
          body: typeof args.body === "string" ? args.body : "",
          ts: typeof e.ts === "string" && !Number.isNaN(Date.parse(e.ts)) ? e.ts : null,
        };
        setAlertLog((prev) =>
          prev.some((a) => a.key === entry.key) ? prev : [entry, ...prev].slice(0, ALERT_LOG_LIMIT)
        );
        if (!fromState) {
          setAlerts((prev) =>
            [{ id: entry.key, title: entry.title, body: entry.body, severity: entry.severity }, ...prev].slice(0, 3)
          );
          const ttl = entry.severity === "critical" ? 30000 : entry.severity === "warning" ? 12000 : 8000;
          setTimeout(() => setAlerts((prev) => prev.filter((x) => x.id !== entry.key)), ttl);
        }
      }

      if (fromState) return;
      if (e.type === "home.mode" && p.mode) setMode(p.mode);
      if (e.type === "cv.detection") applyDetection(detectionFromEvent(e));
      if (e.type === "home.mode" && p.mode === "normal") {
        setAlerts((prev) => prev.filter((x) => x.severity !== "critical"));
      }
      if (e.type.startsWith("sensor.") || e.type.startsWith("cv.")) pulse("perception");
      if (
        e.type === "home.mode" ||
        (e.type === "agent.action" && ["arm_security", "disarm_security", "set_mode"].includes(p.tool))
      ) pulse("security");
      if (e.type === "voice.say" || (e.type === "agent.action" && p.tool === "speak")) pulse("comms");
    },
    [pulse, applyDetection]
  );

  const connected = useBus(BUS_URL, addEvent);

  useEffect(() => {
    if (!connected) return;
    fetch(`${BUS_URL}/state`)
      .then((r) => r.json())
      .then((s) => {
        if (s.mode) setMode(s.mode);
        const history = Array.isArray(s.events) ? s.events : [];
        history.forEach((e) => addEvent(e, true));
        // Restore the newest perception snapshot in the history. applyDetection()
        // ignores it when a live detection already delivered a newer timestamp.
        const latest = history.reduce((best, e) => {
          if (!e || e.type !== "cv.detection") return best;
          if (!best) return e;
          return Date.parse(e.ts) >= Date.parse(best.ts) ? e : best;
        }, null);
        if (latest) applyDetection(detectionFromEvent(latest));
      })
      .catch((err) => console.error("state load failed", err));
  }, [connected, addEvent, applyDetection]);

  const armed = useMemo(() => {
    let set = new Set();
    [...events].reverse().forEach((e) => {
      const p = e.payload || {};
      if (e.type === "agent.action" && p.tool === "arm_security") set = new Set(p.args?.zones || []);
      if (
        (e.type === "agent.action" && p.tool === "disarm_security") ||
        (e.type === "home.mode" && p.mode === "normal")
      ) set = new Set();
    });
    return set;
  }, [events]);
  const zoneArmed = (z) => mode === "security" && (armed.size === 0 || armed.has(z));

  const feedSource = feedPaused ? frozenEvents : events;
  const feedNeedle = feedQuery.trim().toLowerCase();
  const feedFiltered = feedSource.filter((e) => {
    if (feedCategory !== "all" && categoryOf(e.type) !== feedCategory) return false;
    if (!feedNeedle) return true;
    return `${e.type} ${typeof e.source === "string" ? e.source : ""} ${summary(e)}`
      .toLowerCase()
      .includes(feedNeedle);
  });
  const feedHasFilters = feedCategory !== "all" || feedNeedle !== "";

  const reasoning = events
    .filter((e) => ["agent.thought", "agent.action", "voice.say"].includes(e.type))
    .slice(0, 40)
    .reverse();

  // Follow new steps only while the user is parked near the bottom. The jump is
  // instant and flagged, so its own scroll event cannot pause following.
  useEffect(() => {
    const el = listRef.current;
    if (!el || !following) return;
    autoScroll.current = true;
    el.scrollTop = el.scrollHeight;
    const raf = requestAnimationFrame(() => {
      autoScroll.current = false;
    });
    return () => {
      cancelAnimationFrame(raf);
      autoScroll.current = false;
    };
  }, [reasoning.length, following]);

  const onTraceScroll = () => {
    const el = listRef.current;
    if (!el || autoScroll.current) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setFollowing(atBottom);
  };

  const nowLabel = now.toLocaleTimeString([], { hour12: false });
  const det = camera ? detectionLabel(camera.label) : null;
  const frameSrc = camera && camera.frame ? `${camera.frame}?t=${encodeURIComponent(camera.ts)}` : null;
  const frameFailed = camera ? failedFrame === camera.ts : false;
  const detMeta = camera ? detectionMeta(camera) : "";

  return (
    <div className={`app mode-${mode}${alerts.some((a) => a.severity === "critical") ? " flash" : ""}`}>
      <header>
        <div className="brand">
          <span className="logo">◈</span>
          <div className="brandtext">
            <h1>HOME OPS</h1>
            <small>operations console</small>
          </div>
        </div>
        <div className="hstatus">
          <span className={`conn ${connected ? "on" : "off"}`}>
            <i /> {connected ? "LIVE" : "RECONNECTING"}
          </span>
          <span className="clock" title="local time">{nowLabel}</span>
          <div className="badge">{modeLabel(mode)}</div>
        </div>
      </header>

      <div className="board">
        <aside className="rail">
          <div className="panel sim-panel">
            <div className="panel-head">
              <span>Simulation</span>
              <span className="pmeta">fire once</span>
            </div>
            <div className="sim-row">
              <span className="sim-quick">
                <button
                  type="button"
                  className="qa-button"
                  onClick={() => postEvent("cli.command", "cli", { command: "home" })}
                >
                  Home
                </button>
                <button
                  type="button"
                  className="qa-button"
                  onClick={() => postEvent("cli.command", "cli", { command: "leaving" })}
                >
                  Leaving
                </button>
                <button
                  type="button"
                  className="qa-button"
                  onClick={() => postEvent("cli.command", "cli", { command: "status" })}
                >
                  Status
                </button>
              </span>
            </div>
            <div className="sim-spacer" />
            <div className="sim-row">
              <label>Event</label>
              <label>Person</label>
            </div>
            <div className="sim-row">
              <select
                value={simEventType}
                onChange={(e) => setSimEventType(e.target.value)}
                aria-label="Event type to simulate"
              >
                {SIM_EVENT_TYPES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                value={simWho}
                onChange={(e) => setSimWho(e.target.value)}
                aria-label="Person at the door"
              >
                {SIM_WHO.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="sim-row">
              <label>Time</label>
              <label />
            </div>
            <div className="sim-row">
              <select
                value={simWhen}
                onChange={(e) => setSimWhen(e.target.value)}
                aria-label="Time of day"
              >
                {SIM_WHEN.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <div className="sim-spacer" />
            </div>
            <div className="sim-spacer" />
            <div className="sim-fire">
              <button
                type="button"
                onClick={() => fireSimulation(simEventType, simWho, simWhen)}
              >
                Fire
              </button>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <span>Home mode</span>
            </div>
            <div className="modebody">
              <span className={`modedot ${mode === "security" ? "armed" : "clear"}`} />
              <div>
                <div className="modename">{String(mode).toUpperCase()}</div>
                <div className="modenote">
                  {mode === "security" ? "perimeter armed" : "perimeter disarmed"}
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <span>Perimeter</span>
              <span className="pmeta">{ZONES.length} zones</span>
            </div>
            {ZONES.map((z) => {
              const a = zoneArmed(z);
              return (
                <div key={z} className={`zrow ${a ? "armed" : "clear"}`}>
                  <span className="zdot" />
                  <span className="zname">{pretty(z)}</span>
                  <span className="zstate">{a ? "ARMED" : "DISARMED"}</span>
                </div>
              );
            })}
          </div>

          <div className="panel alerts-panel">
            <div className="panel-head">
              <span>Alert centre</span>
              <span className="pmeta">{alertLog.length}</span>
            </div>
            <div
              className="alog"
              ref={logRef}
              tabIndex={-1}
              role="region"
              aria-label="Alert centre"
            >
              {alertLog.length === 0 && (
                <div className="aempty">
                  <span className="anoalerts">No alerts</span>
                  <p>
                    Notifications from <code>notify</code> stay here after their banners clear.
                  </p>
                </div>
              )}
              {alertLog.map((a) => (
                <div key={a.key} className={`aitem ${a.severity}`}>
                  <div className="ahead">
                    <span className="asev">{a.severity}</span>
                    {a.ts && (
                      <time className="atime" dateTime={a.ts}>
                        {clock(a.ts)}
                      </time>
                    )}
                    <button
                      type="button"
                      className="adismiss"
                      aria-label={`Dismiss alert: ${a.title}`}
                      title="Dismiss"
                      onClick={() => dismissAlert(a.key)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="atitle">{a.title}</div>
                  {a.body && <div className="abody">{a.body}</div>}
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <span>Systems</span>
              <span className="pmeta">{connected ? "bus linked" : "bus down"}</span>
            </div>
            {CARDS.map((c) => (
              <div key={c.key} className={`sys${active[c.key] ? " live" : ""}`}>
                <span className="sysdot" />
                <span className="sysname">{c.name}</span>
                <span className="sysstate">{active[c.key] ? "active" : c.idle}</span>
              </div>
            ))}
          </div>
        </aside>

        <section className="center">
          <section className="panel perception">
            <div className="panel-head">
              <span>Perception</span>
              {camera && (
                <span className="pmeta">
                  {camera.zone ? pretty(camera.zone) : "unknown zone"}
                  {camera.when ? ` · ${camera.when}` : ""}
                </span>
              )}
            </div>
            {frameSrc && !frameFailed ? (
              <div className={`frame ${camera.label}`}>
                <img
                  src={frameSrc}
                  alt={`Camera frame (${det.text})`}
                  onError={() => setFailedFrame(camera.ts)}
                />
              </div>
            ) : (
              <div className="frame none">
                <span>{camera ? "Frame unavailable" : "No frame yet"}</span>
              </div>
            )}
            {camera && (
              <div className="frame-cap">
                <span className={`tag ${det.tone}`}>{det.text}</span>
                {detMeta && <span className="fmeta">{detMeta}</span>}
                <span className="ftime">{clock(camera.ts)}</span>
              </div>
            )}
          </section>

          <section className="panel feed">
            <div className="panel-head">
              <span>Event feed</span>
              <span className="pmeta">
                {feedPaused || feedHasFilters
                  ? `${feedFiltered.length} of ${events.length}`
                  : `${events.length} events`}
              </span>
            </div>
            <div className="feedtools">
              <div className="fchips" role="group" aria-label="Filter events by category">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className="fchip"
                    aria-pressed={feedCategory === c.key}
                    onClick={() => setFeedCategory(c.key)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <input
                className="fsearch"
                type="search"
                value={feedQuery}
                onChange={(ev) => setFeedQuery(ev.target.value)}
                placeholder="Search"
                aria-label="Search events by type, source or summary"
              />
              <button
                type="button"
                className="fpause"
                aria-pressed={feedPaused}
                onClick={toggleFeedPause}
              >
                {feedPaused ? "Resume" : "Pause"}
              </button>
            </div>
            <div className="list">
              {feedFiltered.length === 0 && (
                <div className={`empty${feedHasFilters && feedSource.length > 0 ? " nomatch" : ""}`}>
                  <span>
                    {feedHasFilters && feedSource.length > 0
                      ? "No events match these filters."
                      : feedPaused
                        ? "Feed paused — resume to see incoming events."
                        : "No events yet — waiting for the bus…"}
                  </span>
                  {feedHasFilters && feedSource.length > 0 && (
                    <button type="button" className="clearfilters" onClick={resetFeedFilters}>
                      Clear filters
                    </button>
                  )}
                </div>
              )}
              {feedFiltered.map((e) => {
                const m = META[e.type] || { label: e.type, color: "#8a99a8" };
                return (
                  <div className="row" key={`${e.id}|${e.ts}`}>
                    <time className="rtime" dateTime={e.ts} title={stamp(e.ts)}>
                      {clock(e.ts)}
                    </time>
                    <span className="rtag" style={{ color: m.color }}>
                      {m.label}
                    </span>
                    <span className="rsum">{summary(e)}</span>
                    {typeof e.source === "string" && e.source && (
                      <span className="rsrc" title={e.source}>
                        {e.source}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </section>

        <aside className="trace">
          <div className="panel">
            <div className="panel-head">
              <span>Agent trace</span>
              <span className="pmeta">{reasoning.length} steps</span>
            </div>
            <div className="tracebody">
              <div
                className={`list timeline${reasoning.length === 0 ? " empty-trace" : ""}`}
                ref={listRef}
                onScroll={onTraceScroll}
              >
                {reasoning.length === 0 && (
                  <div className="waiting">
                    <span className="wdots">
                      <i />
                      <i />
                      <i />
                    </span>
                    <div className="wtitle">Waiting for the agent</div>
                    <p>Thoughts, tool calls and spoken replies appear here as events arrive.</p>
                  </div>
                )}
                {reasoning.map((e, i) => (
                  <Step key={`${e.id}|${e.ts}`} e={e} latest={i === reasoning.length - 1} />
                ))}
              </div>
              {!following && reasoning.length > 0 && (
                <button
                  className="follow"
                  type="button"
                  onClick={() => setFollowing(true)}
                  aria-label="Scroll to the latest agent activity"
                >
                  Follow latest ↓
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>

      {alerts.length > 0 && (
        <div className="alerts">
          {alerts.map((a) => (
            <div key={a.id} className={`alert ${a.severity}`}>
              <span className="asev">{a.severity}</span>
              <div>
                <div className="atitle">{a.title}</div>
                <div className="abody">{a.body}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
