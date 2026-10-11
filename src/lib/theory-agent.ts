// Theory agent: explains the shared Harmony's chords in plain language via the Gemini API.
// Pure context/prompt builders (testable without a browser) plus the browser request seam.
// The API key never reaches the client; the call goes through app/api/explain/route.ts.
import { chordName, keyName, romanNumeral, type Harmony } from "./music/harmony.ts";

export const DEFAULT_THEORY_MODEL = "gemini-3.8-flash";
export const MAX_AGENT_CHORDS = 32;
export const MAX_FIELD_CHARS = 32;

/** What the agent needs: a key name and one label per bar. No notes, no audio, nothing to persist. */
export interface ChordExplanationContext {
  key: string;
  chords: { bar: number; name: string; roman: string }[];
}

/** Compact serializable snapshot of the shared harmony for the agent request. */
export function harmonyToAgentContext(harmony: Harmony): ChordExplanationContext {
  return {
    key: keyName(harmony),
    chords: harmony.bars.slice(0, MAX_AGENT_CHORDS).map((chord, bar) => ({
      bar: bar + 1,
      name: chordName(chord),
      roman: romanNumeral(chord, harmony),
    })),
  };
}

/** One label per bar, e.g. "C (I) · F (IV) · G (V)"; empty when there are no chords. */
export function progressionLabel(context: ChordExplanationContext): string {
  return context.chords.map((c) => `${c.name} (${c.roman})`).join(" · ");
}

/** Beginner-facing instruction. Bounded output so the dialog stays readable and cheap. */
export function buildTheoryPrompt(context: ChordExplanationContext): string {
  return [
    `The song is in ${context.key}.`,
    `Its chord progression, one chord per bar, is: ${progressionLabel(context)}.`,
    "",
    "Explain the theory behind this progression to a beginner who can hum but does not read music.",
    "In two short paragraphs: (1) what the key means and why these chords belong together, using their",
    "Roman-numeral function and any tension or resolution; (2) one concrete change the listener can try,",
    "such as swapping one chord for another. Plain sentences only, no notation, tab, or code. Under 160 words.",
  ].join("\n");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isShortString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_FIELD_CHARS;

/** Validate untrusted request bodies before they reach the model. Bounded and shape-checked. */
export function isChordExplanationContext(value: unknown): value is ChordExplanationContext {
  if (!isRecord(value) || !isShortString(value.key)) return false;
  const chords = value.chords;
  if (!Array.isArray(chords) || chords.length === 0 || chords.length > MAX_AGENT_CHORDS) return false;
  return chords.every(
    (c) =>
      isRecord(c) &&
      Number.isInteger(c.bar) &&
      (c.bar as number) > 0 &&
      isShortString(c.name) &&
      isShortString(c.roman),
  );
}

/** Keep only a safe Gemini model id; an env typo must not become a URL. */
export function sanitizeTheoryModel(model: string | undefined): string | null {
  if (!model) return null;
  const trimmed = model.trim();
  return /^[A-Za-z0-9._-]{1,64}$/.test(trimmed) ? trimmed : null;
}

/** Pull the text out of a Gemini generateContent response, ignoring anything malformed. */
export function extractCandidateText(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.candidates)) return "";
  const first = data.candidates[0];
  if (!isRecord(first) || !isRecord(first.content) || !Array.isArray(first.content.parts)) return "";
  return first.content.parts
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

/** Ask the server route to explain the current harmony. Browser-only; the key stays server-side. */
export async function requestChordExplanation(harmony: Harmony, signal?: AbortSignal): Promise<string> {
  const response = await fetch("/api/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(harmonyToAgentContext(harmony)),
    signal,
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(data) && typeof data.error === "string" ? data.error : null;
    throw new Error(message ?? "The theory agent is unavailable right now.");
  }
  if (!isRecord(data) || typeof data.text !== "string" || !data.text.trim()) {
    throw new Error("The theory agent sent back an empty answer.");
  }
  return data.text.trim();
}
