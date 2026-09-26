# hk-maths — Blueprint

**This is the ONE file for this project's current settled state and
design decisions.** Every new conclusion updates THIS file; any work on
this project should be checked against what's written here first.

Created 2026-09-26, alongside the first `/api/grade` rewrite.

## 1. What this is

A parent downloads/prints a generated maths worksheet for their child
(`website/generator.html`, `assessment.html`, `assessment2.html`,
`assessment3.html`), the child fills it in on paper, the parent photographs
it and uploads via `website/upload.html`, which calls `/api/grade`.

## 2. The key structural advantage over sibling project hk-homework-check

hk-homework-check's hard, still-unresolved problem (see that repo's
BLUEPRINT.md, Ticket 9/19) is that there is NO known correct answer --
the AI has to both read the page AND independently work out what's right,
then judge the student against its own guess. **hk-maths never has this
problem**: every worksheet's correct answers are computed at generation
time (or a parent pastes their own key for an external worksheet), so the
correct answer is always already known before grading starts.

This changes what AI is for: not "guess and judge" but "read the
student's answer" (OCR) and, where code can't directly compare, "does
this match the ALREADY-KNOWN answer" (a narrower, lower-risk task than
guessing from scratch).

## 3. Current architecture (`/api/grade`, rewritten 2026-09-26)

```
Module 1: OCR only (callMathOcr, Qwen via OpenRouter, temperature 0,
          Alibaba excluded as provider) -- one call per page, reads each
          printed question's label + the student's handwritten answer,
          and the printed "WORKSHEET <id>" text if visible.
Module 1b: worksheet-ID match -- deterministic text match of the OCR'd
          id against worksheetBank; falls back to the pasted answerKey
          text on no match (worksheetMismatch: true).
Module 2: code comparison (compareAnswer/isBareNumericText/
          parseNumericAnswer) -- wherever the known-correct answer for a
          label is a bare number/fraction/mixed number, code compares
          directly. Calculator-grade certainty, no AI involved.
Module 3: AI-compare (callAiCompare) -- ONLY for items code couldn't
          resolve (compound/textual known answers, or a raw pasted key
          that didn't parse into the "N) answer" shape at all). Always
          asked "does this match the KNOWN answer", never "guess what's
          right". Real image attached. Qwen first, Claude Sonnet as a
          last-resort fallback.
Module 4: weak-area labels -- separate, cheap, text-only AI call on the
          wrong items, never affects the real correctness verdicts
          (low-stakes, best-effort).
```

Same public request/response shape as the old single-AI-call design, so
`website/upload.html` needed no changes.

## 4. Current real state (2026-09-26)

**Tests**: 33/33 passing (`npm test` / `node --test test/*.test.js`) --
first automated test suite this project has had. Covers OCR parsing,
answer-key parsing, code comparison, and the full `handleGrade`
integration path via a mocked-fetch harness (mirrors hk-homework-check's
own test-harness style).

**Real live smoke test found a genuine gap, not yet fully resolved**:
tested against `website/sample-worksheet.png` (a real, blank -- no
handwriting -- sample page) with a matching answer key. Found and fixed
one real bug (a fully-blank page caused the model to omit every item's
line entirely instead of reporting each as blank -- `math_ocr_empty`,
total failure; fixed by making the prompt's "leave blank" instruction
unambiguous, with a worked example). **After that fix, a second real
issue was observed and is still open**: across repeated identical calls
(same image, same prompt, temperature 0) the model was NOT fully
consistent -- most runs correctly reported all items blank, but at least
one run hallucinated a plausible-looking (and, worryingly, mathematically
CORRECT for that question) answer on a genuinely blank page. This is the
exact "don't invent content on a blank item" failure class
hk-homework-check spent real iteration on (its Tickets 1/9) -- the
instruction not to do this IS present in this prompt already, but isn't
being followed with full reliability. **Not yet fixed or rigor-checked
against real (non-blank) handwritten worksheets** -- this needs the same
kind of real-photo rigor-check methodology hk-homework-check uses before
this can be trusted at production volume.

## 5. Standing product principles (inherited from hk-homework-check where applicable)

1. Accuracy is the floor, never traded for cost/speed/shipping timeline.
2. A known correct answer is a real, structural advantage over
   hk-homework-check -- lean on code comparison wherever possible; AI's
   role here should stay narrow ("does this match") not open-ended.
3. `needs_review`/null is a correct, honest output, never a failure to
   eliminate.
4. No AI call can be guaranteed 100% correct -- see the real hallucinated-
   answer-on-a-blank-page finding above as direct evidence, even with a
   known answer to compare against and temperature 0.
5. Never route real children's data through Alibaba's infrastructure
   (explicit user decision, matches hk-homework-check's Ticket 21).

## 6. Where to look for more detail

- `TICKETS.md` (this repo) -- task list.
- `docs/external-dependencies.md` (this repo, pre-existing) -- not yet
  reviewed as part of this rewrite.
- hk-homework-check's `BLUEPRINT.md`/`TICKETS.md` -- the sibling project
  this design is modeled on; its Ticket 9/19 (Qwen's real accuracy
  limits) are directly relevant context for what to expect here too.
