import { useEffect, useRef, useState } from "react";

// Subscribes to the bus SSE stream. Returns true while connected.
export function useBus(baseUrl, onEvent) {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const es = new EventSource(`${baseUrl}/stream`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      try {
        handler.current(JSON.parse(msg.data));
      } catch (err) {
        console.error("bad event", err);
      }
    };
    return () => es.close();
  }, [baseUrl]);

  return connected;
}
