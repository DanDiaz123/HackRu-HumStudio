// Optional Edge acceptance suite. Supply an existing Playwright package directory; no app dependency is added.
// Run against npm run dev: node src/tests/browser/studio-interactions.mjs <playwright-directory> [base-url]
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_HARMONY } from "../../lib/music/harmony.ts";
import { STORAGE_KEY, serializeProject } from "../../lib/persistence/project.ts";
import { initialTracks } from "../../lib/tracks.ts";
import { installSampleFixtures, wave } from "./sample-fixtures.mjs";

const { chromium } = await import(process.argv[2] ? pathToFileURL(resolve(process.argv[2], "index.mjs")).href : "playwright");
const baseUrl = process.argv[3] ?? "http://localhost:3000";
const note = (id, midi, startBeat, durationBeats = 1) => ({ id, midi, startBeat, durationBeats, velocity: 0.8 });
const fixture = {
  meta: { id: "ui-fixture", name: "UI regression fixture", createdAt: "2026-10-10T00:00:00.000Z" },
  bpm: 120, quantize: "1/4", sensitivity: "medium", harmony: DEFAULT_HARMONY,
  tracks: initialTracks().map(track => ({ ...track, sample: false, notes: track.instrument.id === "melody"
    ? [note("melody-a", 64, 4, 2), note("melody-b", 67, 8)]
    : track.instrument.id === "drums"
      ? [note("kick-a", 36, 0), note("hat", 42, 2), note("snare", 38, 4), note("open-hat", 46, 6), note("kick-b", 36, 8), note("crash", 49, 10)]
      : [note(`${track.instrument.id}-a`, track.instrument.lo + 12, 0, 4)] })),
};

await mkdir(".test-build", { recursive: true });
const microphonePath = resolve(".test-build/studio-interactions-mic.wav");
await writeFile(microphonePath, wave(16, true));
const browser = await chromium.launch({ channel: "msedge", headless: true, args: [
  "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${microphonePath}`,
] });
const results = [];

async function project(page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const stream = await (await pending).createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function openProject(page, saved) {
  await page.locator("input[type=file]").setInputFiles({ name: "fixture.humstudio.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(saved)) });
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Open project"]').disabled);
}

const track = (saved, id) => saved.tracks.find(item => item.instrumentId === id);
const solos = saved => saved.tracks.filter(item => item.solo).map(item => item.instrumentId);
const notes = page => page.locator(".notes-area.editable .note");
const undo = page => page.getByRole("button", { name: "Undo", exact: true }).click();
const redo = page => page.getByRole("button", { name: "Redo", exact: true }).click();
const positions = page => page.locator(".transport,.ruler-row,.rows").evaluateAll(nodes => nodes.map(node => {
  const rect = node.getBoundingClientRect(); return { top: rect.top, height: rect.height };
}));

try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: width === 1280 ? "no-preference" : "reduce" });
    await context.addInitScript(({ key, saved }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, saved); }, { key: STORAGE_KEY, saved: serializeProject(fixture) });
    // Deterministic delayed samples exercise the real smplr loader without relying on upstream host availability.
    let failTrumpet = true;
    await installSampleFixtures(context, { delayMs: 250, shouldFail: url => failTrumpet && url.includes("trumpet") });
    const page = await context.newPage(), errors = [], checks = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      // Controlled HTTP failures are required for fallback coverage; all other console errors are unexpected.
      if (message.type() === "error" && !message.text().includes("503 (Service Unavailable)")) errors.push(message.text());
    });
    page.on("dialog", dialog => dialog.accept());
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.evaluate(() => document.addEventListener("contextmenu", event => { window.__noteMenuPrevented = event.defaultPrevented; }));
    await page.getByRole("button", { name: "Melody", exact: true }).click();
    const original = await project(page);
    await notes(page).first().click({ button: "right" });
    assert.deepEqual(track(await project(page), "melody").notes, track(original, "melody").notes.slice(1));
    assert.equal(await page.evaluate(() => window.__noteMenuPrevented), true);
    await undo(page); assert.deepEqual(track(await project(page), "melody").notes, track(original, "melody").notes);
    await redo(page); assert.equal(await notes(page).count(), 1);
    await undo(page);
    const area = await page.locator(".notes-area.editable").boundingBox();
    await page.mouse.click(area.x + area.width * 0.8, area.y + area.height * 0.5, { button: "right" });
    assert.deepEqual(track(await project(page), "melody").notes, track(original, "melody").notes);
    await notes(page).first().press("Delete"); await undo(page);
    await notes(page).first().press("Backspace"); await undo(page);
    await notes(page).first().dblclick(); await undo(page);
    checks.push("right-click deletes one Melody note; menu suppressed; empty space inert; keyboard/double-click deletion and undo/redo");

    // Real pointer capture, movement and both resizing edges must still reach canonical project state.
    const first = await notes(page).first().boundingBox();
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await page.mouse.down(); await page.mouse.move(first.x + first.width / 2 + area.width / 32, first.y + first.height / 2, { steps: 4 }); await page.mouse.up();
    assert.equal(track(await project(page), "melody").notes[0].startBeat, 5);
    await notes(page).first().locator(".note-edge:not(.start)").hover();
    await page.mouse.down(); await page.mouse.move(first.x + first.width + area.width / 32 * 2, first.y + first.height / 2, { steps: 4 }); await page.mouse.up();
    assert.ok(track(await project(page), "melody").notes[0].durationBeats > 2);
    await notes(page).first().locator(".note-edge.start").hover();
    await page.mouse.down(); await page.mouse.move(first.x + area.width / 32 * 2, first.y + first.height / 2, { steps: 4 }); await page.mouse.up();
    assert.equal(track(await project(page), "melody").notes[0].startBeat, 6);
    checks.push("left drag and both note edges still update the project");

    await page.getByRole("button", { name: "All tracks", exact: true }).click();
    await page.getByRole("button", { name: "Drums", exact: true }).click();
    const parts = page.getByLabel("Drum part"), drumBefore = track(await project(page), "drums").notes;
    for (const part of ["kick", "snare", "hat", "openHat", "crash"]) {
      await parts.selectOption(part);
      assert.equal(await notes(page).count(), 6);
      assert.equal(await page.locator(".pitch-labels .selected").count(), 1);
      assert.deepEqual(track(await project(page), "drums").notes, drumBefore);
    }
    await parts.selectOption("kick");
    await page.screenshot({ path: `.test-build/studio-interactions-drums-${width}.png`, fullPage: true });
    const kick = page.getByRole("button", { name: /^Kick, beat/ }).first();
    const kickBox = await kick.boundingBox(), fullDrumArea = await page.locator(".notes-area.editable").boundingBox();
    await page.mouse.move(kickBox.x + kickBox.width / 2, kickBox.y + kickBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(kickBox.x + kickBox.width / 2 + fullDrumArea.width / 32, kickBox.y + kickBox.height / 2 - fullDrumArea.height / 5, { steps: 4 });
    await page.mouse.up();
    const draggedDrums = track(await project(page), "drums").notes;
    assert.equal(draggedDrums.find(note => note.id === "kick-a").midi, 36);
    assert.equal(draggedDrums.find(note => note.id === "kick-a").startBeat, 1);
    assert.deepEqual(draggedDrums.filter(note => note.midi !== 36), drumBefore.filter(note => note.midi !== 36));
    await undo(page); await kick.press("ArrowUp");
    assert.deepEqual(track(await project(page), "drums").notes, drumBefore);
    const snare = page.getByRole("button", { name: /^Snare, beat/ });
    await snare.press("ArrowRight");
    const snareBox = await snare.boundingBox();
    await page.mouse.move(snareBox.x + snareBox.width / 2, snareBox.y + snareBox.height / 2);
    await page.mouse.down(); await page.mouse.move(snareBox.x + snareBox.width + 20, snareBox.y + snareBox.height / 2, { steps: 4 }); await page.mouse.up();
    assert.deepEqual(track(await project(page), "drums").notes, drumBefore);
    assert.equal(await snare.locator(".note-edge").count(), 0);
    await snare.click({ button: "right" });
    assert.deepEqual(track(await project(page), "drums").notes, drumBefore.filter(note => note.id !== "snare"));
    await undo(page); assert.deepEqual(track(await project(page), "drums").notes, drumBefore);
    await redo(page); assert.equal(await snare.count(), 0); await undo(page);
    const background = drumBefore.filter(note => note.midi !== 36);
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    assert.deepEqual(track(await project(page), "drums").notes, background);
    assert.equal(await notes(page).count(), background.length);
    assert.equal(await page.locator(".prompt").count(), 0); await undo(page);
    await page.getByRole("button", { name: "Repeat 1–4", exact: true }).click();
    const repeated = track(await project(page), "drums").notes;
    assert.deepEqual(repeated.filter(note => note.midi !== 36), background);
    assert.equal(repeated.filter(note => note.midi === 36).length, 4); await undo(page);
    const drumArea = await page.locator(".notes-area.editable").boundingBox();
    await page.mouse.click(drumArea.x + drumArea.width * 0.6, drumArea.y + drumArea.height * 0.1);
    const added = track(await project(page), "drums").notes;
    assert.deepEqual(added.filter(note => note.midi !== 36), background);
    assert.equal(added.filter(note => note.midi === 36).length, 3); await undo(page);
    checks.push("all drum lanes remain visible; selection does not mutate notes; background notes cannot move/resize; deletion, Clear, Repeat and add preserve other lanes");

    await page.getByRole("button", { name: "Re-record", exact: true }).click();
    await page.locator(".rec.on").waitFor({ timeout: 15000 });
    await snare.click({ button: "right" }); assert.equal(await snare.count(), 1);
    await page.waitForTimeout(1400); await page.locator(".rec.on").click();
    if (width === 1280) {
      await page.locator(".phase-revealing").waitFor();
      assert.equal(await page.locator(".phase-revealing .note.background").count(), background.length);
      await page.locator(".phase-revealing .note.background").first().click({ button: "right" });
      assert.equal(await page.locator(".phase-revealing .note.background").count(), background.length);
      assert.equal(await page.evaluate(() => window.__noteMenuPrevented), true);
    }
    await page.waitForFunction(() => !document.querySelector('select[aria-label="Note sensitivity"]').disabled);
    const recorded = await project(page);
    assert.deepEqual(track(recorded, "drums").notes.filter(note => note.midi !== 36), background);
    assert.ok(track(recorded, "drums").notes.some(note => note.midi === 36));
    checks.push("synthetic microphone recording preserves other drum parts and blocks deletion mid-take; desktop reveal retains background lanes");

    await page.getByRole("button", { name: "All tracks", exact: true }).click();
    if (width > 720) {
      const mute = page.getByRole("button", { name: "Mute Bass", exact: true });
      const solo = page.getByRole("button", { name: "Solo Bass", exact: true });
      assert.equal(await mute.getAttribute("title"), "Mute Bass"); assert.equal(await solo.getAttribute("title"), "Solo Bass");
      await mute.hover(); assert.equal(await mute.evaluate(node => getComputedStyle(node, "::after").opacity), "1");
      await page.mouse.move(0, 0); await mute.focus(); await page.keyboard.press("Tab");
      assert.equal(await solo.evaluate(node => node === document.activeElement), true);
      assert.equal(await solo.evaluate(node => getComputedStyle(node, "::after").opacity), "1");
      await page.screenshot({ path: ".test-build/studio-interactions-tooltip.png", fullPage: true });
      await solo.click(); assert.deepEqual(solos(await project(page)), ["bass"]);
      await page.getByRole("button", { name: "Solo Melody", exact: true }).click(); assert.deepEqual(solos(await project(page)), ["melody"]);
      await undo(page); assert.deepEqual(solos(await project(page)), ["bass"]);
      await redo(page); assert.deepEqual(solos(await project(page)), ["melody"]);
      await page.getByRole("button", { name: "Mute Melody", exact: true }).click(); assert.deepEqual(solos(await project(page)), ["melody"]);
      await page.getByRole("button", { name: "Solo Melody", exact: true }).click(); assert.deepEqual(solos(await project(page)), []);
      checks.push("Mute/Solo hover/focus explanations; exclusive Solo, mute independence and undo/redo");
    }
    await page.getByRole("button", { name: "Melody", exact: true }).click();
    await page.locator(".big-name").click(); await page.keyboard.press("s"); assert.deepEqual(solos(await project(page)), ["melody"]);
    await page.keyboard.press("2"); await page.locator(".big-name").click(); await page.keyboard.press("s"); assert.deepEqual(solos(await project(page)), ["bass"]);
    await page.keyboard.press("s"); assert.deepEqual(solos(await project(page)), []);
    const saved = await project(page);
    await openProject(page, saved); assert.deepEqual((await project(page)).tracks, saved.tracks);
    const legacy = structuredClone(saved); legacy.tracks.reverse(); legacy.tracks.forEach(track => { track.solo = ["bass", "keys"].includes(track.instrumentId); });
    await openProject(page, legacy); assert.deepEqual(solos(await project(page)), ["bass"]);
    await undo(page); assert.deepEqual((await project(page)).tracks, saved.tracks); await redo(page);
    const restored = await project(page);
    await page.waitForTimeout(500); await page.reload({ waitUntil: "networkidle" });
    assert.deepEqual((await project(page)).tracks, restored.tracks);
    checks.push("keyboard S, Save/Open, legacy multi-solo migration, import undo/redo and autosave reload");
    await openProject(page, { ...restored, unexpected: "reject this field" });
    await page.getByRole("alert").filter({ hasText: /unexpected project fields/i }).waitFor();
    assert.deepEqual((await project(page)).tracks, restored.tracks);
    await openProject(page, restored);
    checks.push("invalid project errors remain visible without modifying notes");

    await page.getByRole("button", { name: "Melody", exact: true }).click();
    const baseline = await positions(page), sound = page.getByLabel("Melody sound");
    for (const id of ["melody.marimba", "melody.guitar", "melody.flute", "melody.trumpet"]) {
      await sound.selectOption(id); assert.deepEqual(await positions(page), baseline);
    }
    await page.locator('.row.zoomed .sound-field[data-sound-state="fallback"]').waitFor();
    assert.equal(await sound.inputValue(), "melody.trumpet"); assert.deepEqual(await positions(page), baseline);
    assert.equal(await page.getByText("Loading selected sounds…", { exact: true }).count(), 0);
    failTrumpet = false; await page.getByRole("button", { name: "Retry sound", exact: true }).click();
    await page.locator('.row.zoomed .sound-field[data-sound-state="ready"]').waitFor();
    assert.deepEqual(await positions(page), baseline);
    const midiPending = page.waitForEvent("download"); await page.getByRole("button", { name: "Export MIDI", exact: true }).click();
    const midiStream = await (await midiPending).createReadStream(); const midiChunks = [];
    for await (const chunk of midiStream) midiChunks.push(chunk);
    assert.equal(Buffer.concat(midiChunks).subarray(0, 4).toString(), "MThd");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    assert.deepEqual(errors, []);
    checks.push("rapid sound switches, fallback/retry and real smplr synthetic-sample decode keep layout fixed; playback controls and MIDI export; no page errors or horizontal overflow");
    await page.screenshot({ path: `.test-build/studio-interactions-${width}.png`, fullPage: true });
    results.push({ width, checks, errors }); console.log(JSON.stringify(results.at(-1)));
    await context.close();
  }
  await writeFile(".test-build/studio-interactions-result.json", JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
