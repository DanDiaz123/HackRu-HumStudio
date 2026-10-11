// Run against an existing server: node src/tests/browser/persistence-boundaries.mjs <playwright-directory> [base-url]
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_HARMONY } from "../../lib/music/harmony.ts";
import { MAX_PROJECT_BYTES, parseProject, serializeProject, toProject } from "../../lib/persistence/project.ts";
import { initialTracks } from "../../lib/tracks.ts";
import { installSampleFixtures } from "./sample-fixtures.mjs";

const { chromium } = await import(process.argv[2] ? pathToFileURL(resolve(process.argv[2], "index.mjs")).href : "playwright");
const baseUrl = process.argv[3] ?? "http://localhost:3000";
const note = (id, midi = 64) => ({ id, midi, startBeat: 1, durationBeats: 0.5, velocity: 0.8 });
const fixture = () => ({
  meta: { id: "persistence-boundaries", name: "Unicode 音 🎵", createdAt: "2026-10-11T00:00:00.000Z" },
  bpm: 120, harmony: DEFAULT_HARMONY,
  tracks: initialTracks().map(track => ({ ...track, sample: false, quantize: "off", notes: [] })),
});
async function open(page, text) {
  await page.locator("input[type=file]").setInputFiles({
    name: "fixture.humstudio.json", mimeType: "application/json", buffer: Buffer.from(text, "utf8"),
  });
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Open project"]').disabled);
}
async function save(page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const stream = await (await pending).createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_PROJECT_BYTES);
  parseProject(text);
  return text;
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const checks = [], errors = [];
await mkdir(".test-build", { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  await installSampleFixtures(context);
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  const recorded = fixture();
  recorded.tracks[0].notes = [note("melody-source")];
  recorded.tracks[3].notes = [note("drum-active", 36)];
  recorded.regeneration = { takes: { melody: { bpm: 120, sources: {
    low: { notes: [note("melody-source")], phraseIds: [0] },
    medium: { notes: [note("melody-source")], phraseIds: [0] },
    high: { notes: [note("melody-source", 67)], phraseIds: [0] },
  } } }, snapSources: {}, pickedKey: null, harmonyDriver: null };
  await open(page, serializeProject(recorded));
  await page.getByRole("button", { name: "Melody", exact: true }).click();
  for (const level of ["high", "low"]) {
    await page.getByLabel("Note sensitivity").selectOption(level);
    const saved = await save(page);
    const notes = JSON.parse(saved).tracks.flatMap(track => track.notes);
    assert.equal(new Set(notes.map(note => note.id)).size, notes.length);
    await open(page, saved);
    await page.getByRole("button", { name: "Melody", exact: true }).click();
  }
  const beforeInvalid = JSON.parse(await save(page));
  const invalid = toProject(recorded);
  invalid.regeneration.takes.melody.sources.low.notes[0].id = "drum-active";
  await open(page, JSON.stringify(invalid));
  await page.getByRole("alert").filter({ hasText: /duplicate note id/ }).waitFor();
  assert.deepEqual(JSON.parse(await save(page)).tracks, beforeInvalid.tracks);
  checks.push("shared same-part profile IDs survive switching and Save/Open; foreign profile IDs reject without changing the project");

  const unicode = fixture();
  unicode.tracks[0].notes = [note("音-é-🎵")];
  const text = serializeProject(unicode);
  const exact = text + " ".repeat(MAX_PROJECT_BYTES - Buffer.byteLength(text, "utf8"));
  await open(page, exact);
  const accepted = await save(page);
  assert.deepEqual(JSON.parse(accepted).tracks, JSON.parse(text).tracks);
  await open(page, exact + " ");
  await page.getByRole("alert").filter({ hasText: /file is too large/ }).waitFor();
  assert.deepEqual(JSON.parse(await save(page)).tracks, JSON.parse(accepted).tracks);
  checks.push("a Unicode file at exactly 2,000,000 UTF-8 bytes opens; one extra byte rejects without changing notes");

  const large = fixture();
  large.tracks[0].notes = Array.from({ length: 2500 }, (_, i) => ({
    id: "音".repeat(100) + i, midi: 60 + i % 25, startBeat: Math.floor(i / 25) / 16, durationBeats: 0.03125, velocity: 0.8,
  }));
  await open(page, serializeProject(large));
  const beforeRepeat = await save(page);
  await page.getByRole("button", { name: "Melody", exact: true }).click();
  await page.locator('.part-actions button[title="Copy bars 1-4 over bars 5-8"]').click();
  assert.match(await page.locator(".row.zoomed .status").textContent(), /5000 notes/);
  let downloads = 0;
  page.on("download", () => { downloads++; });
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: /project file is too large/ }).waitFor();
  assert.equal(downloads, 0);
  assert.match(await page.locator(".row.zoomed .status").textContent(), /5000 notes/);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const afterUndo = await save(page);
  assert.deepEqual(JSON.parse(afterUndo).tracks, JSON.parse(beforeRepeat).tracks);
  await open(page, afterUndo);
  assert.deepEqual(JSON.parse(await save(page)).tracks, JSON.parse(beforeRepeat).tracks);
  checks.push("an oversized Unicode export shows an error without downloading or deleting notes; Undo restores a reopenable save");

  assert.deepEqual(errors, []);
  const result = { checks, errors };
  await writeFile(".test-build/persistence-boundaries-result.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await context.close();
} finally { await browser.close(); }
