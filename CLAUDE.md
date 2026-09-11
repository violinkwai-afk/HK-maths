# HK Primary Maths Worksheet Site

New project — not yet started. The user also runs a separate site (a "Life in
the UK Test" citizenship-exam practice app) with a different Claude Code
session; that project is unrelated in content, but the working habits below
carried over from it because they worked well.

## Working principles (carried over, still apply here)

- **Content sourcing**: any factual/curriculum content must come only from an
  authoritative source the user provides (for the UK project this was ~200
  official handbook screenshots). For this project, ask the user for the
  actual HK primary maths syllabus material (textbook pages, official
  curriculum doc) per grade before writing questions/notes — don't invent
  content from general knowledge, and don't guess what's taught at what
  grade level.
- **Verify before claiming**: check actual current file/deployment state
  before describing what's built — don't rely on memory of what was
  discussed. This user has previously caught the assistant confidently
  describing behavior that wasn't actually there.
- **Communication**: reaches this project via Telegram, writes in Cantonese,
  expects replies via the Telegram reply tool specifically — plain terminal
  text does not reach them. Prefers short, frequent progress messages sent
  after each completed step rather than one long message at the end.
- **Caution on high-blast-radius actions**: confirm before anything hard to
  reverse (deleting data, overwriting deployed content, credential/access
  changes) and explain the actual security tradeoffs plainly — this user
  asks direct, specific security questions and wants honest answers, not
  reassurance.
- **Copy/UI text**: this user dislikes vague marketing language ("all in
  one place", "efficient companion"). Concrete, specific claims tied to the
  actual mechanism/differentiator land much better than generic sentences.

## Project context so far (from the planning conversation)

- Target users: Hong Kong mothers, mostly working full-time, limited
  evening time to supervise kids' homework/revision.
- Scope: Primary 1–6 (小一至小六) maths.
- Core loop: site auto-generates a printable mock worksheet
  (parameterized/random-generated questions rather than a fixed question
  bank, since maths lends itself to this) → mum prints it, kid does it on
  paper → photo of the completed worksheet is graded automatically → site
  generates a follow-up worksheet targeting just the missed concepts, with
  simpler step-by-step scaffolding, plus revision notes.

**UPDATE 2026-09-11 — supersedes the "V1 manual marking, V2 deferred OCR"
plan below:** photo-based auto-grading is not deferred — it's the core
loop from day one; see [[feedback-hk-maths-ocr-bar]] for the two hard
constraints the user set on it:
1. Acceptance bar is "if a human can read it, the AI must too" — not
   required to beat human legibility.
2. **Do not force a rigid one-digit-per-box answer format** — the user
   explicitly rejected this as over-controlling how the kid writes. Only
   acceptable failure case: handwriting physically overruns into another
   question's space.
Approach agreed instead: since the app generates the worksheet, use a
known page layout/anchor markers for photo alignment + per-field
cropping, and cross-check each read answer against the worksheet's own
known correct-answer key (auto-accept confident/matching reads, surface
only genuinely ambiguous ones for a quick human confirm — a light safety
net, not a return to manual grading).

**MVP kickoff 2026-09-11:** user wants a one-day, single-topic,
single-worksheet prototype to test the full loop end-to-end (not all 6
grades). They provided a real, blank reference test paper as a content/
format example: `mvp/` (in this dir) — a P1 second-term maths quiz
(2-digit addition/subtraction with regrouping, missing-digit column
arithmetic, MCQ, price-table word problems, compound word problems,
sourced from a worksheet-sharing site, not official curriculum but a
realistic difficulty/format reference). Its answer key was computed and
saved to `mvp/test2_answer_key.json`. Still to be decided with the user:
whether to use this exact paper directly as the day-1 test case (print →
fill → photograph → grade) or build our own generator first matching its
style/difficulty.

- Still needed from the user before broader content work can start: the
  actual HK P1–P6 maths syllabus breakdown (source material) if going
  beyond this one reference-paper-driven MVP, and which 1–2 grade/topic
  combos to build next.
- Hosting/domain and payment model (if any) not yet decided.
