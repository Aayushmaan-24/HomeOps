import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useBus } from "./useBus.js";
import { modeLabel } from "./eventMeta.js";
import "./tokens.css";
import "./assistant.css";

const BUS_URL = import.meta.env.VITE_BUS_URL || "http://localhost:8000";
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const SUGGESTIONS = ["I'm leaving", "I'm home", "Arm the security system", "Say hello"];
const STATUS_LABEL = { ready: "Ready", listening: "Listening", thinking: "Waiting for the agent" };

function speak(text, muted) {
  if (muted || !text || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  const v = window.speechSynthesis.getVoices().find((x) => x.lang && x.lang.startsWith("en"));
  if (v) u.voice = v;
  window.speechSynthesis.speak(u);
}

function Assistant() {
  const [turns, setTurns] = useState([]);
  const [mode, setMode] = useState("normal");
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const turnsRef = useRef([]);
  const mutedRef = useRef(false);
  const pendingId = useRef(null);
  const timer = useRef(null);
  const recRef = useRef(null);
  const listRef = useRef(null);
  turnsRef.current = turns;
  mutedRef.current = muted;

  const patchTurn = useCallback((id, fn) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));
  }, []);

  const releasePending = useCallback((id) => {
    if (pendingId.current !== id) return;
    pendingId.current = null;
    setBusy(false);
    clearTimeout(timer.current);
  }, []);

  const finish = useCallback(
    (id) => {
      const t = turnsRef.current.find((x) => x.id === id);
      if (!t) return;
      patchTurn(id, (x) => ({ ...x, status: "done" }));
      releasePending(id);
    },
    [patchTurn, releasePending]
  );

  // The UI gives up after 30s, but the agent keeps running: it must not be
  // reported as having answered, and a late reply arrives as a new message.
  const timeoutTurn = useCallback(
    (id) => {
      const t = turnsRef.current.find((x) => x.id === id);
      if (!t || t.status !== "thinking") return;
      patchTurn(id, (x) => ({ ...x, status: "done", timedOut: true }));
      releasePending(id);
    },
    [patchTurn, releasePending]
  );

  const cancelPending = useCallback(() => {
    const id = pendingId.current;
    if (!id) return;
    patchTurn(id, (x) => ({ ...x, status: "done", cancelled: true }));
    releasePending(id);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, [patchTurn, releasePending]);

  const bump = useCallback(
    (id) => {
      if (pendingId.current !== id) return;
      const t = turnsRef.current.find((x) => x.id === id);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => finish(id), t && t.reply ? 3000 : 6000);
    },
    [finish]
  );

  const onEvent = useCallback(
    (e) => {
      const p = e.payload || {};
      if (e.type === "home.mode" && p.mode) setMode(p.mode);
      const id = pendingId.current;
      if (e.type === "voice.say") {
        // There is no request id in the event contract, so replies can only be
        // matched while a turn is pending, and only the first reply claims it.
        // Anything else is shown as a standalone message rather than guessed.
        const pendingTurn = id ? turnsRef.current.find((x) => x.id === id) : null;
        if (pendingTurn && pendingTurn.status === "thinking" && !pendingTurn.reply) {
          patchTurn(id, (t) => ({ ...t, reply: p.text }));
          bump(id);
        } else {
          setTurns((prev) => [
            ...prev,
            { id: `sys-${e.id}-${e.ts}`, user: null, status: "done", tools: [], reply: p.text },
          ]);
        }
        speak(p.text, mutedRef.current);
      } else if (id && e.type === "agent.thought" && e.source === "agent") {
        patchTurn(id, (t) => ({ ...t, thought: p.text }));
        bump(id);
      } else if (id && e.type === "agent.action") {
        patchTurn(id, (t) => ({ ...t, tools: [...t.tools, p.tool] }));
        bump(id);
      }
    },
    [patchTurn, bump]
  );

  const connected = useBus(BUS_URL, onEvent);

  useEffect(() => {
    if (!connected) return;
    fetch(`${BUS_URL}/state`)
      .then((r) => r.json())
      .then((s) => s.mode && setMode(s.mode))
      .catch(() => {});
  }, [connected]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const send = useCallback(
    async (msg, input = "text") => {
      const clean = (msg || "").trim();
      if (!clean) return;
      if (pendingId.current) {
        setError("Hold on — the previous request is still waiting for the agent.");
        return;
      }
      setError("");
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      const id = `u-${Date.now()}`;
      setTurns((prev) => [
        ...prev,
        { id, user: clean, input, status: "thinking", tools: [], thought: "", reply: "" },
      ]);
      pendingId.current = id;
      setBusy(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => timeoutTurn(id), 30000);
      try {
        const r = await fetch(`${BUS_URL}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "voice.utterance",
            source: "alexa-sim",
            payload: { text: clean, input },
          }),
        });
        if (!r.ok) throw new Error(`bus returned ${r.status}`);
      } catch (err) {
        releasePending(id);
        setError(`Couldn't reach the bus (${err.message}). Is it running on ${BUS_URL}?`);
        patchTurn(id, (t) => ({ ...t, status: "done", failed: true }));
      }
    },
    [releasePending, timeoutTurn, patchTurn]
  );

  const toggleMic = () => {
    if (!SR || busy) return;
    if (listening) {
      recRef.current && recRef.current.stop();
      return;
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setError("");
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let finalText = "";
    rec.onresult = (ev) => {
      let interimText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      setInterim(finalText + interimText);
    };
    rec.onerror = (ev) => {
      const msgs = {
        "not-allowed": "Microphone permission was denied. Allow it in the browser's site settings.",
        "service-not-allowed": "Speech recognition is blocked in this browser. Use the text box.",
        network: "Speech recognition needs an internet connection. Use the text box.",
        "no-speech": "I didn't hear anything. Try again.",
      };
      setError(msgs[ev.error] || `Speech error: ${ev.error}`);
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
      if (finalText.trim()) send(finalText, "voice");
    };
    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch (err) {
      setListening(false);
    }
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !busy) {
      send(text, "text");
      setText("");
    }
  };

  const status = listening ? "listening" : busy ? "thinking" : "ready";

  return (
    <div className={`shell mode-${mode}`}>
      <header>
        <div className="brand">
          <span className={`orb${listening ? " listening" : ""}${busy ? " busy" : ""}`} aria-hidden="true" />
          <h1>
            Voice Assistant <small>SIMULATED</small>
          </h1>
          <span className={`state ${status}`} role="status" aria-live="polite">
            {STATUS_LABEL[status]}
          </span>
        </div>
        <div className="right">
          <span className={`conn ${connected ? "on" : "off"}`}>
            <i /> {connected ? "LIVE" : "RECONNECTING"}
          </span>
          <span className="modechip">{modeLabel(mode)}</span>
          <button
            className="mute"
            onClick={() => setMuted((m) => !m)}
            title={muted ? "Unmute spoken replies" : "Mute spoken replies"}
            aria-label={muted ? "Unmute spoken replies" : "Mute spoken replies"}
            aria-pressed={muted}
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
      </header>

      <main ref={listRef}>
        {turns.length === 0 && (
          <div className="hint">Press the mic, or type a request below.</div>
        )}
        {turns.map((t) => (
          <div key={t.id} className="turn">
            {t.user && (
              <div className="bubble user">
                <span className="via">{t.input === "voice" ? "🎙️" : "⌨️"}</span> {t.user}
              </div>
            )}
            {(t.reply || t.status === "thinking" || t.tools.length > 0 || t.failed || t.timedOut || t.cancelled) && (
              <div className="bubble bot">
                {t.status === "thinking" && !t.reply && (
                  <div className="thinking">
                    <span className="dots" aria-hidden="true"><i /><i /><i /></span>
                    <em>{t.thought || "Waiting for the agent…"}</em>
                    <button
                      type="button"
                      className="cancel"
                      onClick={cancelPending}
                      aria-label="Cancel this request in the UI; the agent keeps running"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {t.reply && <div className="reply">{t.reply}</div>}
                {t.failed && <div className="reply">Sorry, I couldn't reach the home.</div>}
                {t.timedOut && (
                  <div className="note warn">
                    No response after 30 seconds. The agent may still be running — a later reply will appear as a new message.
                  </div>
                )}
                {t.cancelled && (
                  <div className="note">Cancelled in the UI. The agent may still be working in the background.</div>
                )}
                {t.tools.length > 0 && (
                  <div className="tools">
                    {t.tools.map((n, i) => (
                      <code key={i}>{n}</code>
                    ))}
                  </div>
                )}
              </div>
            )}
            {t.status === "done" && !t.reply && !t.failed && !t.timedOut && !t.cancelled && t.user && (
              <div className="bubble bot muted">No response from the agent.</div>
            )}
          </div>
        ))}
      </main>

      <footer>
        <div className="chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => send(s, "text")} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
        {interim && (
          <div className="interim" role="status" aria-live="polite">
            🎙️ {interim}
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="composer">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type a request and press Enter…"
            aria-label="Type a request"
          />
          <button
            className="send"
            onClick={() => {
              if (busy) return;
              send(text, "text");
              setText("");
            }}
            disabled={busy}
            aria-label="Send request"
          >
            Send
          </button>
          {SR ? (
            <button
              className={`mic${listening ? " on" : ""}`}
              onClick={toggleMic}
              title={listening ? "Stop listening" : "Speak"}
              aria-label={listening ? "Stop voice input" : "Start voice input"}
              aria-pressed={listening}
              disabled={busy}
            >
              {listening ? "■" : "🎙️"}
            </button>
          ) : (
            <span className="nomic">Voice input isn't supported in this browser. Use Chrome.</span>
          )}
        </div>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Assistant />);
