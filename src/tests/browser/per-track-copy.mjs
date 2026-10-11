// Run against an existing server: node src/tests/browser/per-track-copy.mjs <playwright-directory> [base-url]
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { renderTrackProfiles } from "../../lib/generate.ts";
import { DEFAULT_HARMONY } from "../../lib/music/harmony.ts";
import { STORAGE_KEY, serializeProject } from "../../lib/persistence/project.ts";
import { initialTracks } from "../../lib/tracks.ts";

const { chromium } = await import(process.argv[2] ? pathToFileURL(resolve(process.argv[2], "index.mjs")).href : "playwright");
const baseUrl = process.argv[3] ?? "http://localhost:3000";
const note = (id, midi, startBeat, durationBeats = 0.5) => ({ id, midi, startBeat, durationBeats, velocity: 0.7 });
const phrase = [note("melody-a", 64, 1.13), note("melody-b", 67, 2.31, 0.7), note("melody-c", 71, 3.22, 1.25)];
const fixture = {
  meta: { id: "copy-fixture", name: "Copy regression", createdAt: "2026-10-11T00:00:00.000Z" },
  bpm: 120, harmony: DEFAULT_HARMONY,
  tracks: initialTracks().map(track => ({ ...track, sample: false, quantize: "off", notes: track.instrument.id === "melody" ? phrase
    : track.instrument.id === "keys" ? [60, 64, 67].map((midi, i) => note("chord-" + i, midi, 2.13, 1.2))
    : track.instrument.id === "drums" ? [note("kick", 36, 0), note("snare", 38, 1), note("hat", 42, 1.5), note("crash", 49, 24)]
    : [] })),
};
const track = (p, id) => p.tracks.find(t => t.instrumentId === id);
const storedNotes = page => page.locator('.notes-area.editable .note[role=button]');
const feedback = page => page.locator(".copy-feedback");
async function save(page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const stream = await (await pending).createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function open(page, p, id) {
  await page.locator("input[type=file]").setInputFiles({ name: "fixture.humstudio.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(p)) });
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Open project"]').disabled);
  if (id) await page.getByRole("button", { name: id, exact: true }).click();
}
async function focus(page) { await page.locator(".big-name").click(); }
async function select(page, inst, beats, rows, hold = false) {
  await focus(page);
  if (hold) { await page.keyboard.down("Control"); await page.keyboard.down("c"); }
  else await page.keyboard.press("Control+c");
  const area = await page.locator(".notes-area.editable").boundingBox();
  const count = inst === "Drums" ? 5 : 25;
  const point = (beat, row) => ({ x: area.x + area.width * beat / 32, y: area.y + area.height * row / count });
  const a = point(beats[0], rows[0]), b = point(beats[1], rows[1]);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  assert.equal(await page.locator(".copy-rect").count(), 1);
  assert.equal(await page.locator(".copy-rect").evaluate(el => getComputedStyle(el).borderTopStyle), "solid");
  if (hold) {
    await page.keyboard.up("Control");
    assert.equal(await page.locator(".copy-group").count(), 1);
    await page.keyboard.up("c");
  }
  await page.mouse.up();
  return area;
}
async function dragCopy(page, area, beat, row, offset, count) {
  const x = area.x + area.width * beat / 32, y = area.y + area.height * row / count;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + area.width * offset / 32, y, { steps: 6 });
  return () => page.mouse.up();
}
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
await mkdir(".test-build", { recursive: true });
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    await context.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value); }, { key: STORAGE_KEY, value: serializeProject(fixture) });
    const page = await context.newPage(), errors = [], checks = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Melody", exact: true }).click();
    const baseline = await page.locator(".transport,.ruler-row,.rows").evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return [r.top, r.height]; }));
    await page.getByLabel("Note sensitivity").selectOption("high");
    await page.getByLabel("Snap", { exact: true }).selectOption("1/16");
    await page.getByRole("button", { name: "All tracks", exact: true }).click();
    await page.getByRole("button", { name: "Bass", exact: true }).click();
    assert.equal(await page.getByLabel("Note sensitivity").inputValue(), "medium");
    assert.equal(await page.getByLabel("Snap", { exact: true }).inputValue(), "off");
    await page.getByLabel("Note sensitivity").selectOption("low");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    assert.equal(await page.getByLabel("Note sensitivity").inputValue(), "medium");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    assert.equal(await page.getByLabel("Note sensitivity").inputValue(), "low");
    const settings = await save(page);
    assert.equal(track(settings, "melody").sensitivity, "high"); assert.equal(track(settings, "melody").quantize, "1/16");
    assert.equal(track(settings, "bass").sensitivity, "low");
    await open(page, settings, "Melody");
    assert.equal(await page.getByLabel("Note sensitivity").inputValue(), "high");
    assert.equal(await page.getByLabel("Snap", { exact: true }).inputValue(), "1/16");
    assert.deepEqual(await page.locator(".transport,.ruler-row,.rows").evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return [r.top, r.height]; })), baseline);
    checks.push("independent per-track dropdowns, switch/Open restoration, undo/redo and stable layout");

    await open(page, JSON.parse(serializeProject(fixture)), "Melody");
    await page.getByLabel("Snap", { exact: true }).focus();
    await page.keyboard.press("Control+c"); assert.equal(await feedback(page).textContent(), "");
    await focus(page); await page.keyboard.press("Control+c");
    assert.match(await feedback(page).textContent(), /Drag to select/);
    await page.keyboard.press("Escape"); assert.equal(await page.locator(".row.zoomed").count(), 1);
    assert.equal(await page.locator(".copy-rect").count(), 0);
    for (const reverseX of [false, true]) for (const reverseY of [false, true]) {
      await select(page, "Melody", reverseX ? [4.8, 0.8] : [0.8, 4.8], reverseY ? [21.8, 12.4] : [12.4, 21.8]);
      assert.equal(await page.locator(".copy-selected").count(), 3);
      assert.equal(await storedNotes(page).count(), 3);
      await page.keyboard.press("Escape");
    }
    const area = await select(page, "Melody", [0.8, 4.8], [12.4, 21.8], true);
    assert.equal(await storedNotes(page).count(), 3);
    const drop = await dragCopy(page, area, 1.38, 20.5, 8, 25);
    assert.equal(await page.locator(".copy-ghost").count(), 3);
    await page.screenshot({ path: ".test-build/note-copy-preview-" + width + ".png", fullPage: true });
    await drop();
    const pasted = await save(page), copied = track(pasted, "melody").notes.filter(n => !phrase.some(old => old.id === n.id));
    assert.equal(copied.length, 3); assert.deepEqual(track(pasted, "melody").notes.filter(n => phrase.some(old => old.id === n.id)), phrase);
    const shift = copied[0].startBeat - phrase[0].startBeat;
    assert.ok(Math.abs(shift - 8) <= 32 / area.width); // Pointer events round CSS coordinates to device pixels.
    for (let i = 0; i < copied.length; i++) {
      assert.ok(Math.abs(copied[i].startBeat - phrase[i].startBeat - shift) < 1e-10);
      assert.equal(copied[i].midi, phrase[i].midi); assert.equal(copied[i].durationBeats, phrase[i].durationBeats);
      assert.equal(copied[i].velocity, phrase[i].velocity);
    }
    await page.keyboard.press("Control+z"); assert.equal(await storedNotes(page).count(), 3);
    await page.keyboard.press("Control+Shift+z"); assert.equal(await storedNotes(page).count(), 6);
    await open(page, pasted, "Melody"); assert.equal(await storedNotes(page).count(), 6);
    await page.waitForTimeout(500); await page.reload({ waitUntil: "networkidle" });
    assert.deepEqual(track(await save(page), "melody").notes, track(pasted, "melody").notes);
    checks.push("Ctrl+C arming and field guards; four selection directions; modifier release; ghosts; exact rhythm and fresh IDs; one-step undo/redo; Save/Open");

    await open(page, JSON.parse(serializeProject(fixture)), "Melody");
    const collisionArea = await select(page, "Melody", [0.8, 4.8], [12.4, 21.8]);
    await (await dragCopy(page, collisionArea, 1.38, 20.5, 0, 25))();
    assert.match(await feedback(page).textContent(), /overlap/); assert.equal(await storedNotes(page).count(), 3);
    await (await dragCopy(page, collisionArea, 1.38, 20.5, 31, 25))();
    assert.match(await feedback(page).textContent(), /timeline/); assert.equal(await storedNotes(page).count(), 3);
    await page.keyboard.press("Escape");
    await focus(page); await page.keyboard.press("Control+c");
    await page.mouse.move(collisionArea.x + collisionArea.width * 0.8, collisionArea.y + collisionArea.height * 0.1);
    await page.mouse.down(); await page.mouse.move(collisionArea.x + collisionArea.width * 0.9, collisionArea.y + collisionArea.height * 0.2); await page.mouse.up();
    assert.match(await feedback(page).textContent(), /No notes/);
    await select(page, "Melody", [0.8, 4.8], [12.4, 21.8]);
    await dragCopy(page, collisionArea, 1.38, 20.5, 8, 25);
    await page.keyboard.press("Escape"); await page.mouse.up();
    assert.equal(await storedNotes(page).count(), 3); assert.equal(await page.locator(".copy-ghost").count(), 0);
    await select(page, "Melody", [0.8, 4.8], [12.4, 21.8]);
    await dragCopy(page, collisionArea, 1.38, 20.5, 8, 25);
    await page.locator(".notes-area.editable").dispatchEvent("pointercancel", { pointerId: 1 });
    await page.mouse.up();
    assert.equal(await storedNotes(page).count(), 3); assert.equal(await page.locator(".copy-group").count(), 0);
    await page.getByRole("button", { name: "All tracks", exact: true }).click();
    await page.getByRole("button", { name: "Melody", exact: true }).click();
    await storedNotes(page).first().click({ button: "right" }); assert.equal(await storedNotes(page).count(), 2);
    await page.keyboard.press("Control+z");
    checks.push("collision/overflow reject whole groups; empty selection; Escape cancels captured drag; editor and deletion recover");

    await open(page, JSON.parse(serializeProject(fixture)), "Keys");
    const chordArea = await select(page, "Keys", [1.8, 3.8], [4.4, 13.6]);
    assert.equal(await page.locator(".copy-selected").count(), 3);
    await (await dragCopy(page, chordArea, 2.5, 8.5, 8, 25))();
    const keys = track(await save(page), "keys");
    assert.equal(keys.notes.length, 6); assert.ok(keys.notes.slice(3).every(n => Math.abs(n.startBeat - 10.13) <= 32 / chordArea.width));
    await focus(page); await page.keyboard.press("Control+v");
    assert.equal(await storedNotes(page).count(), 9);
    const keyboardPasted = track(await save(page), "keys").notes.filter(n => n.startBeat === 0);
    assert.equal(keyboardPasted.length, 3);
    await page.keyboard.press("Control+z"); assert.equal(await storedNotes(page).count(), 6);
    await open(page, JSON.parse(serializeProject(fixture)), "Drums");
    await page.getByLabel("Drum part").selectOption("openHat");
    const drumArea = await select(page, "Drums", [0, 2.1], [1.9, 5]);
    assert.equal(await page.locator(".copy-selected").count(), 3);
    await (await dragCopy(page, drumArea, 0.25, 4.5, 8, 5))();
    const drums = track(await save(page), "drums");
    assert.equal(drums.notes.length, 7); assert.equal(drums.drumPart, "openHat");
    for (const midi of [36, 38, 42]) assert.equal(drums.notes.filter(n => n.midi === midi).length, 2);
    assert.equal(drums.notes.filter(n => n.midi === 49).length, 1);
    await page.keyboard.press("Control+z"); assert.equal(await storedNotes(page).count(), 4);
    await page.keyboard.press("Control+Shift+z"); assert.equal(await storedNotes(page).count(), 7);
    checks.push("polyphonic chord copy and full-track multi-row drum paste preserve unrelated lanes and part selection");

    // New-format take alternatives are real musical inputs to the generation pipeline.
    const sources = {
      low: { notes: [note("low", 64, 0.25, 2.5)], phraseIds: [0] },
      medium: { notes: [note("medium-a", 64, 0.25, 1), note("medium-b", 67, 1.6, 1)], phraseIds: [0, 1] },
      high: { notes: [note("high-a", 64, 0.25, 0.5), note("high-b", 65, 1.1, 0.5), note("high-c", 67, 2.1, 0.5)], phraseIds: [0, 1, 2] },
    };
    const loaded = structuredClone(fixture), melody = loaded.tracks[0];
    melody.notes = renderTrackProfiles(melody.instrument, sources, 93, "off", DEFAULT_HARMONY).medium;
    loaded.regeneration = { takes: { melody: { bpm: 93, sources } }, snapSources: {}, pickedKey: null, harmonyDriver: "melody" };
    await open(page, JSON.parse(serializeProject(loaded)), "Melody");
    await page.getByLabel("Note sensitivity").selectOption("high"); assert.equal(await storedNotes(page).count(), 3);
    await page.getByLabel("Snap", { exact: true }).selectOption("1/16");
    const withSources = await save(page);
    await open(page, withSources, "Melody");
    await page.getByLabel("Note sensitivity").selectOption("low"); assert.equal(await storedNotes(page).count(), 1);
    await page.getByLabel("Note sensitivity").selectOption("high");
    await page.getByLabel("Snap", { exact: true }).selectOption("off");
    const restored = track(await save(page), "melody");
    assert.ok(Math.abs(restored.notes[0].startBeat - 0.25) < 1e-10);
    await storedNotes(page).first().press("ArrowRight");
    const edited = track(await save(page), "melody").notes;
    await page.getByLabel("Note sensitivity").selectOption("low");
    assert.deepEqual(track(await save(page), "melody").notes, edited);
    const manualSaved = await save(page);
    await open(page, manualSaved, "Melody"); await page.getByLabel("Note sensitivity").selectOption("medium");
    assert.deepEqual(track(await save(page), "melody").notes, edited);
    checks.push("saved sensitivity alternatives rebuild after Open at capture BPM; Off restores timing; hand edits stay protected after reload");

    await page.getByLabel("Note sensitivity").selectOption("high");
    await page.getByLabel("Snap", { exact: true }).selectOption("1/8");
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Demo hum", exact: true }).click();
    await page.locator(".rec.on").waitFor();
    await focus(page); await page.keyboard.press("Control+c");
    assert.equal(await page.locator(".copy-rect").count(), 0);
    assert.equal(await feedback(page).textContent(), "");
    await page.waitForTimeout(2200); await page.locator(".rec.on").click();
    await page.waitForFunction(() => !document.querySelector('select[aria-label="Note sensitivity"]').disabled);
    const recorded = await save(page), recordedTrack = track(recorded, "melody"), recordedTake = recorded.regeneration.takes.melody;
    assert.equal(recordedTrack.sensitivity, "high"); assert.equal(recordedTrack.quantize, "1/8");
    const generated = renderTrackProfiles(fixture.tracks[0].instrument, recordedTake.sources, recordedTake.bpm, "1/8", recorded.harmony).high;
    const contents = notes => notes.map(({ midi, startBeat, durationBeats, velocity }) => ({ midi, startBeat, durationBeats, velocity }));
    assert.deepEqual(contents(recordedTrack.notes), contents(generated));
    await page.waitForTimeout(500); await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Melody", exact: true }).click();
    assert.equal(await page.getByLabel("Note sensitivity").inputValue(), "high");
    assert.equal(await page.getByLabel("Snap", { exact: true }).inputValue(), "1/8");
    await page.getByLabel("Note sensitivity").selectOption("low");
    assert.ok((await save(page)).regeneration.takes.melody.sources.low.notes.length);
    checks.push("new Demo hum takes use track settings; copying blocked during capture; genuine autosave reload retains note-only regeneration and settings");

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: ".test-build/per-track-copy-" + width + ".png", fullPage: true });
    results.push({ width, checks, errors }); console.log(JSON.stringify(results.at(-1)));
    await context.close();
  }
  await writeFile(".test-build/per-track-copy-result.json", JSON.stringify(results, null, 2));
} finally { await browser.close(); }
