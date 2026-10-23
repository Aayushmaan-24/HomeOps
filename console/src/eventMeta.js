/*
 * Event metadata shared by the main console and the assistant simulation page.
 *
 * Keep this file limited to values that both pages genuinely consume. The
 * console-only presentation metadata (event icons, colours and summaries in
 * App.jsx) stays there, because the assistant page does not render it.
 */

// Header label for the mode reported by `home.mode` events (bus.py also
// exposes the same value from GET /state). Any value other than "security"
// falls back to normal, matching the ternaries both pages used before.
export const MODE_LABEL = {
  normal: "🏠 NORMAL",
  security: "🔒 SECURITY",
};

export function modeLabel(mode) {
  return mode === "security" ? MODE_LABEL.security : MODE_LABEL.normal;
}
