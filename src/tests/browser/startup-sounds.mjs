// Run against an existing server: node src/tests/browser/startup-sounds.mjs <playwright-directory> [base-url]
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_HARMONY } from "../../lib/music/harmony.ts";
import { STORAGE_KEY, serializeProject } from "../../lib/persistence/project.ts";
import { initialTracks } from "../../lib/tracks.ts";
import { installSampleFixtures } from "./sample-fixtures.mjs";

const { chromium } = await import(process.argv[2] ? pathToFileURL(resolve(process.argv[2], "index.mjs")).href : "playwright");
const baseUrl = process.argv[3] ?? "http://localhost:3000";
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--autoplay-policy=user-gesture-required"] });
const results = [];
const ready = page => page.locator('.row.zoomed .sound-field[data-sound-state="ready"]').waitFor();
const fallback = page => page.locator('.row.zoomed .sound-field[data-sound-state="fallback"]').waitFor();

async function instrumentContext(browser, width, saved) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  await context.addInitScript(({ key, saved }) => {
    if (saved && !localStorage.getItem(key)) localStorage.setItem(key, saved);
    window.__audioContexts = [];
    window.__audioResumes = 0;
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) { super(...args); window.__audioContexts.push(this); }
      resume() { window.__audioResumes++; return super.resume(); }
    };
  }, { key: STORAGE_KEY, saved });
  return context;
}

async function beforeGesture(page) {
  const audio = await page.evaluate(() => ({ resumes: window.__audioResumes,
    states: window.__audioContexts.filter(context => context.state !== "closed").map(context => context.state) }));
  assert.equal(audio.resumes, 0, "startup must not resume audio");
  assert.equal(audio.states.length, 1, "samples use one shared context");
  // A browser may allow a new context to run already; the app must never resume it on mount.
  assert.ok(["running", "suspended"].includes(audio.states[0]));
  assert.equal(await page.getByRole("button", { name: "Pause", exact: true }).count(), 0);
}

try {
  await mkdir(".test-build", { recursive: true });
  for (const width of [1280, 390, 320]) {
    const context = await instrumentContext(browser, width);
    const requests = [], errors = [];
    await installSampleFixtures(context, { delayMs: 200, onRequest: url => requests.push(url) });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await beforeGesture(page);
    for (const family of ["flute", "electric_bass_finger", "splendid", "TR-808", "string_ensemble_1"])
      assert.ok(requests.some(url => url.toLowerCase().includes(family.toLowerCase())), `${family} preloads without input`);
    for (const name of ["Melody", "Bass", "Keys", "Drums", "Strings"]) {
      await page.getByRole("button", { name, exact: true }).click(); await ready(page);
      await page.getByRole("button", { name: "All tracks", exact: true }).click();
    }
    const downloads = requests.length;
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
    assert.ok(await page.evaluate(() => window.__audioResumes > 0), "Play explicitly resumes the shared context");
    assert.equal(requests.length, downloads, "Play reuses preloaded assets");
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("button", { name: "Bass", exact: true }).click(); await ready(page);
    await page.screenshot({ path: `.test-build/startup-sounds-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    results.push({ width, scenario: "fresh startup", requests: downloads, errors });
    console.log(JSON.stringify(results.at(-1)));
    await context.close();
  }

  const selected = { melody: "melody.marimba", bass: "bass.pick", keys: "keys.wurlitzer", drums: "drums.lm2", strings: "strings.violin" };
  const saved = serializeProject({ meta: { id: "startup", name: "Startup sounds", createdAt: "2026-10-11T00:00:00.000Z" },
    bpm: 120, harmony: DEFAULT_HARMONY, tracks: initialTracks().map(track => ({ ...track, presetId: selected[track.instrument.id],
      muted: true, sample: false, notes: [] })) });
  const context = await instrumentContext(browser, 1280, saved);
  const requests = [], errors = [];
  let failBass = true;
  await installSampleFixtures(context, { onRequest: url => requests.push(url), shouldFail: url => failBass && url.includes("electric_bass_pick") });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && !message.text().includes("503 (Service Unavailable)")) errors.push(message.text());
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await beforeGesture(page);
  for (const asset of ["marimba", "electric_bass_pick", "Wurlitzer", "LM-2", "violin"])
    assert.ok(requests.some(url => url.includes(asset)), `${asset} restored/preloaded on an empty muted track`);
  assert.ok(!requests.some(url => /flute|electric_bass_finger|splendid|TR-808|string_ensemble_1/.test(url)), "defaults are not fetched before restoring storage");
  for (const name of ["Melody", "Keys", "Drums", "Strings"]) {
    await page.getByRole("button", { name, exact: true }).click(); await ready(page);
    await page.getByRole("button", { name: "All tracks", exact: true }).click();
  }
  await page.getByRole("button", { name: "Bass", exact: true }).click(); await fallback(page);
  failBass = false;
  await page.getByRole("button", { name: "Retry sound", exact: true }).click(); await ready(page);

  // Open an empty/muted part without touching its sound selector, then undo/redo it.
  const changed = JSON.parse(saved);
  changed.tracks.find(track => track.instrumentId === "strings").presetId = "strings.cello";
  await page.locator("input[type=file]").setInputFiles({ name: "startup.humstudio.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(changed)) });
  await page.getByRole("button", { name: "Strings", exact: true }).click(); await ready(page);
  assert.equal(await page.getByLabel("Strings sound").inputValue(), "strings.cello");
  assert.ok(requests.some(url => url.includes("cello")));
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready(page);
  assert.equal(await page.getByLabel("Strings sound").inputValue(), "strings.violin");
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await ready(page);
  assert.equal(await page.getByLabel("Strings sound").inputValue(), "strings.cello");
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).tracks.find(track => track.instrumentId === "strings").presetId === "strings.cello", STORAGE_KEY);
  await page.reload({ waitUntil: "networkidle" }); await beforeGesture(page);
  await page.getByRole("button", { name: "Strings", exact: true }).click(); await ready(page);
  assert.equal(await page.getByLabel("Strings sound").inputValue(), "strings.cello");
  assert.deepEqual(errors, []);
  results.push({ scenario: "restored empty/muted sounds, isolated failure/retry, Open/history/reload", errors });
  console.log(JSON.stringify(results.at(-1)));
  await context.close();
  await writeFile(".test-build/startup-sounds-results.json", JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
