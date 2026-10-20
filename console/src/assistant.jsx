import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useBus } from "./useBus.js";
import "./assistant.css";

const BUS_URL = import.meta.env.VITE_BUS_URL || "http://localhost:8000";
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const SUGGESTIONS = ["I'm leaving", "I'm home", "Arm the security system", "Say hello"];

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

  const finish = useCallback(
    (id) => {
      const t = turnsRef.current.find((x) => x.id === id);
      if (!t) return;
      if (!t.reply && t.thought) {
        patchTurn(id, (x) => ({ ...x, reply: x.thought, status: "done" }));
        speak(t.thought, mutedRef.current);
      } else {
        patchTurn(id, (x) => ({ ...x, status: "done" }));
      }
      if (pendingId.current === id) pendingId.current = null;
    },
    [patchTurn]
  );

  const bump = useCallback(
    (id) => {
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
        if (id) {
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
      setError("");
      if (pendingId.current) finish(pendingId.current);
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      const id = `u-${Date.now()}`;
      setTurns((prev) => [
        ...prev,
        { id, user: clean, input, status: "thinking", tools: [], thought: "", reply: "" },
      ]);
      pendingId.current = id;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => finish(id), 30000);
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
        clearTimeout(timer.current);
        pendingId.current = null;
        setError(`Couldn't reach the bus (${err.message}). Is it running on ${BUS_URL}?`);
        patchTurn(id, (t) => ({ ...t, status: "done", failed: true }));
      }
    },
    [finish, patchTurn]
  );

  const toggleMic = () => {
    if (!SR) return;
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
    if (e.key === "Enter") {
      send(text, "text");
      setText("");
    }
  };

  return (
    <div className={`shell mode-${mode}`}>
      <header>
        <div className="brand">
          <span className={`orb${listening ? " listening" : ""}${pendingId.current ? " busy" : ""}`} />
          <h1>
            Voice Assistant <small>SIMULATED</small>
          </h1>
        </div>
        <div className="right">
          <span className={`conn ${connected ? "on" : "off"}`}>
            <i /> {connected ? "LIVE" : "RECONNECTING"}
          </span>
          <span className="modechip">{mode === "security" ? "🔒 SECURITY" : "🏠 NORMAL"}</span>
          <button className="mute" onClick={() => setMuted((m) => !m)} title="Mute spoken replies">
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
            {(t.reply || t.status === "thinking" || t.tools.length > 0 || t.failed) && (
              <div className="bubble bot">
                {t.status === "thinking" && !t.reply && (
                  <div className="thinking">
                    <span className="dots"><i /><i /><i /></span>
                    {t.thought && <em>{t.thought}</em>}
                  </div>
                )}
                {t.reply && <div className="reply">{t.reply}</div>}
                {t.failed && <div className="reply">Sorry, I couldn't reach the home.</div>}
                {t.tools.length > 0 && (
                  <div className="tools">
                    {t.tools.map((n, i) => (
                      <code key={i}>{n}</code>
                    ))}
                  </div>
                )}
              </div>
            )}
            {t.status === "done" && !t.reply && !t.failed && t.user && (
              <div className="bubble bot muted">No response from the agent.</div>
            )}
          </div>
        ))}
      </main>

      <footer>
        <div className="chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => send(s, "text")}>{s}</button>
          ))}
        </div>
        {interim && <div className="interim">🎙️ {interim}</div>}
        {error && <div className="error">{error}</div>}
        <div className="composer">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type a request and press Enter…"
          />
          <button className="send" onClick={() => { send(text, "text"); setText(""); }}>Send</button>
          {SR ? (
            <button className={`mic${listening ? " on" : ""}`} onClick={toggleMic} title="Speak">
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
