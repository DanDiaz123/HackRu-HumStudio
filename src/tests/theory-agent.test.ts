import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_HARMONY, withKey } from "../lib/music/harmony.ts";
import {
  MAX_AGENT_CHORDS,
  buildTheoryPrompt,
  extractCandidateText,
  harmonyToAgentContext,
  isChordExplanationContext,
  progressionLabel,
  sanitizeTheoryModel,
} from "../lib/theory-agent.ts";

test("harmonyToAgentContext names each bar's chord and Roman numeral", () => {
  const context = harmonyToAgentContext(DEFAULT_HARMONY);
  assert.equal(context.key, "C major");
  assert.equal(context.chords.length, 8);
  assert.deepEqual(context.chords.slice(0, 4).map((c) => c.name), ["Am", "F", "C", "G"]);
  assert.deepEqual(context.chords.slice(0, 4).map((c) => c.roman), ["vi", "IV", "I", "V"]);
  assert.deepEqual(context.chords.map((c) => c.bar), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("harmonyToAgentContext follows a picked key", () => {
  const context = harmonyToAgentContext(withKey({ tonic: 2, mode: "major" }, []));
  assert.equal(context.key, "D major");
  assert.deepEqual(context.chords.slice(0, 4).map((c) => c.name), ["Bm", "G", "D", "A"]);
});

test("progressionLabel joins bar labels", () => {
  assert.equal(progressionLabel({ key: "C major", chords: [{ bar: 1, name: "C", roman: "I" }] }), "C (I)");
});

test("buildTheoryPrompt states the key and progression and bounds the answer", () => {
  const prompt = buildTheoryPrompt(harmonyToAgentContext(DEFAULT_HARMONY));
  assert.match(prompt, /C major/);
  assert.match(prompt, /Am \(vi\)/);
  assert.match(prompt, /Aim for 200–300 words/);
});

test("isChordExplanationContext accepts a well-formed context and rejects malformed input", () => {
  const good = harmonyToAgentContext(DEFAULT_HARMONY);
  assert.equal(isChordExplanationContext(good), true);
  for (const bad of [
    null,
    {},
    { key: "C major" },
    { key: "", chords: good.chords },
    { key: "C major", chords: [] },
    { key: "C major", chords: [{ bar: 0, name: "C", roman: "I" }] },
    { key: "C major", chords: [{ bar: 1, name: 3, roman: "I" }] },
    { key: "C major", chords: [{ bar: 1, name: "C", roman: "" }] },
    { key: "x".repeat(64), chords: good.chords },
    { key: "C major", chords: Array.from({ length: MAX_AGENT_CHORDS + 1 }, (_, i) => ({ bar: i + 1, name: "C", roman: "I" })) },
  ]) {
    assert.equal(isChordExplanationContext(bad), false, JSON.stringify(bad));
  }
});

test("sanitizeTheoryModel blocks URL-shaped and oversized model ids", () => {
  assert.equal(sanitizeTheoryModel("gemini-3.8-flash"), "gemini-3.8-flash");
  assert.equal(sanitizeTheoryModel(undefined), null);
  assert.equal(sanitizeTheoryModel(""), null);
  assert.equal(sanitizeTheoryModel("gemini/../../evil"), null);
  assert.equal(sanitizeTheoryModel("gemini 3.8"), null);
  assert.equal(sanitizeTheoryModel("x".repeat(65)), null);
});

test("extractCandidateText reads Gemini's response shape and ignores junk", () => {
  assert.equal(
    extractCandidateText({ candidates: [{ content: { parts: [{ text: "hello " }, { text: "world" }] } }] }),
    "hello world",
  );
  assert.equal(extractCandidateText({ candidates: [] }), "");
  assert.equal(extractCandidateText({ candidates: [{ content: {} }] }), "");
  assert.equal(extractCandidateText(null), "");
  assert.equal(extractCandidateText({ error: "boom" }), "");
});
