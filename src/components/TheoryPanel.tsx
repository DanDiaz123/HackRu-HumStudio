"use client";

import { useEffect, useRef, useState } from "react";
import { harmonyLabel, type Harmony } from "@/lib/music/harmony";
import { requestChordExplanation } from "@/lib/theory-agent";

type Status = "loading" | "done" | "error";

/** Learn: ask the Gemini-backed theory agent to explain the song's chords. Presentation only; never mutates notes. */
export default function TheoryPanel({ harmony }: { harmony: Harmony }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("loading");
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  function close() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setOpen(false);
  }

  async function explain() {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setOpen(true);
    setStatus("loading");
    setError("");
    try {
      const answer = await requestChordExplanation(harmony, controller.signal);
      if (controller.signal.aborted) return;
      setText(answer);
      setStatus("done");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "The theory agent is unavailable.");
      setStatus("error");
    }
  }

  return (
    <>
      <button className="ghost-btn" title="Explain these chords with the theory agent" onClick={() => void explain()}>
        Explain
      </button>
      <dialog ref={dialogRef} className="help theory-dialog" aria-labelledby="theory-title" onClose={close}>
        <h2 id="theory-title">Theory agent</h2>
        <p className="theory-key">{harmonyLabel(harmony, harmony.bars.length)}</p>
        <div className="theory-output" tabIndex={0} aria-live="polite" aria-busy={status === "loading"}>
          {status === "loading" && (
            <p className="theory-status" role="status">Thinking about these chords…</p>
          )}
          {status === "error" && (
            <div className="theory-status" role="alert">
              <p>{error}</p>
              <button className="ghost-btn" onClick={() => void explain()}>Try again</button>
            </div>
          )}
          {status === "done" && <p className="theory-text">{text}</p>}
        </div>
        <p className="theory-caveat">
          AI-generated explanation of your inferred key and chords. Harmony can be ambiguous, so treat it as a
          starting point, not an answer key.
        </p>
        <button className="ghost-btn" onClick={close}>Close</button>
      </dialog>
    </>
  );
}
