import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBus } from "./useBus.js";

const BUS_URL = import.meta.env.VITE_BUS_URL || "http://localhost:8000";
const ZONES = ["front_door", "back_door", "garage"];
const pretty = (s) => String(s).replace(/_/g, " ");

const META = {
  "cli.command": { icon: "⌨️", label: "Command", color: "#90be6d" },
  "voice.utterance": { icon: "🎙️", label: "Heard", color: "#ffe66d" },
  "voice.say": { icon: "🔊", label: "Spoke", color: "#ffe66d" },
  "sensor.doorbell": { icon: "🔔", label: "Doorbell", color: "#ff8a8a" },
  "sensor.motion": { icon: "👁️", label: "Motion", color: "#ff8a8a" },
  "cv.detection": { icon: "📷", label: "Detection", color: "#ffb454" },
  "home.mode": { icon: "🛡️", label: "Mode", color: "#2dd4bf" },
  "agent.thought": { icon: "🧠", label: "Thought", color: "#7db2ff" },
  "agent.action": { icon: "⚙️", label: "Action", color: "#7db2ff" },
};

const clock = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

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

const argsText = (args) =>
  Object.entries(args || {})
    .filter(([k]) => k !== "reason")
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
    .join("  ·  ");

function Step({ e, latest }) {
  const p = e.payload || {};
  const cls = latest ? " latest" : "";
  if (e.type === "agent.thought") {
    return (
      <div className={`step thought${cls}`}>
        <span className="dot" />
        <div className="body">
          <div className="meta">THOUGHT · {clock(e.ts)}</div>
          <p>{p.text}</p>
        </div>
      </div>
    );
  }
  if (e.type === "agent.action") {
    return (
      <div className={`step action${cls}`}>
        <span className="dot" />
        <div className="body">
          <div className="meta">TOOL CALL · {clock(e.ts)}</div>
          <div className="tool">
            <code>{p.tool}</code>
            {argsText(p.args) && <span className="args">{argsText(p.args)}</span>}
            <span className="result">✓ {typeof p.result === "string" ? p.result : "done"}</span>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={`step say${cls}`}>
      <span className="dot" />
      <div className="body">
        <div className="meta">VOICE · {clock(e.ts)}</div>
        <div className="bubble">🔊 {p.text}</div>
      </div>
    </div>
  );
}

const CARDS = [
  { key: "perception", name: "Perception", icon: "📷", idle: "watching feeds" },
  { key: "security", name: "Security", icon: "🛡️", idle: "on watch" },
  { key: "comms", name: "Comms", icon: "🔊", idle: "standing by" },
];

export default function App() {
  const [mode, setMode] = useState("normal");
  const [events, setEvents] = useState([]); // newest first
  const [active, setActive] = useState({});
  const [alerts, setAlerts] = useState([]);
  const seen = useRef(new Set());
  const timers = useRef({});
  const listRef = useRef(null);

  const pulse = useCallback((key) => {
    setActive((a) => ({ ...a, [key]: true }));
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => setActive((a) => ({ ...a, [key]: false })), 3000);
  }, []);

  const addEvent = useCallback(
    (e, fromState = false) => {
      const key = `${e.id}|${e.ts}`;
      if (seen.current.has(key)) return;
      seen.current.add(key);
      setEvents((prev) => [e, ...prev].sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 100));
      if (fromState) return;
      const p = e.payload || {};
      if (e.type === "home.mode" && p.mode) setMode(p.mode);
      if (e.type === "agent.action" && p.tool === "notify") {
        const a = p.args || {};
        const id = `${e.id}|${e.ts}`;
        const sev = a.severity || "info";
        setAlerts((prev) => [{ id, title: a.title, body: a.body, severity: sev }, ...prev].slice(0, 3));
        const ttl = sev === "critical" ? 30000 : sev === "warning" ? 12000 : 8000;
        setTimeout(() => setAlerts((prev) => prev.filter((x) => x.id !== id)), ttl);
      }
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
    [pulse]
  );

  const connected = useBus(BUS_URL, addEvent);

  useEffect(() => {
    if (!connected) return;
    fetch(`${BUS_URL}/state`)
      .then((r) => r.json())
      .then((s) => {
        if (s.mode) setMode(s.mode);
        (s.events || []).forEach((e) => addEvent(e, true));
      })
      .catch((err) => console.error("state load failed", err));
  }, [connected, addEvent]);

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

  const reasoning = events
    .filter((e) => ["agent.thought", "agent.action", "voice.say"].includes(e.type))
    .slice(0, 40)
    .reverse();

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [reasoning.length]);

  return (
    <div className={`app mode-${mode}${alerts.some((a) => a.severity === "critical") ? " flash" : ""}`}>
      <header>
        <div className="brand">
          <span className="logo">◈</span>
          <h1>HOME OPS</h1>
        </div>
        <div className="right">
          <span className={`conn ${connected ? "on" : "off"}`}>
            <i /> {connected ? "LIVE" : "RECONNECTING"}
          </span>
          <div className="badge">{mode === "security" ? "🔒 SECURITY" : "🏠 NORMAL"}</div>
        </div>
      </header>

      {alerts.length > 0 && (
        <div className="alerts">
          {alerts.map((a) => (
            <div key={a.id} className={`alert ${a.severity}`}>
              <span className="aicon">{a.severity === "critical" ? "🚨" : a.severity === "warning" ? "⚠️" : "ℹ️"}</span>
              <div>
                <div className="atitle">{a.title}</div>
                <div className="abody">{a.body}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="zones">
        <div className="zones-label">PERIMETER</div>
        {ZONES.map((z) => {
          const a = zoneArmed(z);
          return (
            <div key={z} className={`zone ${a ? "armed" : "clear"}`}>
              <span className="zicon">{a ? "🔒" : "🔓"}</span>
              <div>
                <div className="zname">{pretty(z)}</div>
                <small>{a ? "ARMED" : "DISARMED"}</small>
              </div>
            </div>
          );
        })}
      </section>

      <main>
        <section className="col feed">
          <h2>LIVE FEED</h2>
          <div className="list">
            {events.map((e) => {
              const m = META[e.type] || { icon: "•", label: e.type, color: "#9aa5b1" };
              return (
                <div className="row" key={`${e.id}|${e.ts}`}>
                  <span className="ricon">{m.icon}</span>
                  <span className="rlabel" style={{ color: m.color }}>{m.label}</span>
                  <span className="rsum">{summary(e)}</span>
                  <span className="rtime">{clock(e.ts)}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="col reasoning">
          <h2>AGENT REASONING</h2>
          <div className="list timeline" ref={listRef}>
            {reasoning.length === 0 && <div className="empty">Waiting for the agent…</div>}
            {reasoning.map((e, i) => (
              <Step key={`${e.id}|${e.ts}`} e={e} latest={i === reasoning.length - 1} />
            ))}
          </div>
        </section>
      </main>

      <footer>
        {CARDS.map((c) => (
          <div key={c.key} className={`card${active[c.key] ? " glow" : ""}`}>
            <span className="cicon">{c.icon}</span>
            <div>
              <div className="cname">{c.name}</div>
              <small>{active[c.key] ? "ACTIVE" : c.idle}</small>
            </div>
          </div>
        ))}
      </footer>
    </div>
  );
}
