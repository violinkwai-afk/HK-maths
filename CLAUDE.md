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

## Build status as of 2026-09-11 (end of first build session)

This repo (`~/hk-maths`, its own git repo, separate from the UK project's
— the user wants each project's infra kept separate, more may follow) now
has:

- `generate_worksheet.py` — generates one randomized P1 worksheet: 5
  horizontal 2-digit +/- questions, 2 missing-digit column-arithmetic
  puzzles, 1 word problem. **Content is in plain English** (not Cantonese)
  for now — this sidesteps a real limitation of this dev sandbox (zero
  system fonts installed, so this box's own preview screenshots can't
  render CJK glyphs at all; a real user's phone/browser has no such
  issue). Switch back to Chinese whenever convenient — nothing about the
  architecture depends on the language.
  - Layout deliberately has **no name/class/score header** (the user said
    that's exam-paper bureaucracy that adds nothing for home practice)
    and large, clear text — a full test-paper-style header table was
    tried first and rejected as unnecessary and "too small text".
  - Each generated worksheet gets a random `worksheet_id`, saved under
    `worksheets/<id>/worksheet.html` + `worksheets/<id>/answer_key.json`
    (gitignored — these are per-run outputs, not source).
- `server.py` — a local Flask dev server (`python3 server.py`, port 5055)
  wiring the loop together: `POST /api/generate` makes a new worksheet,
  `GET /worksheets/<id>/...` serves it, `POST /api/submit/<id>` accepts an
  uploaded photo. **Tested end-to-end manually and works** (generate →
  serve → submit all confirmed via curl).
  - **`/api/submit` does NOT actually grade anything yet.** It saves the
    photo and returns a clear "not graded — no API key configured"
    response. Automatic reading-and-grading needs to call a
    vision-capable AI (e.g. Anthropic's API) over the network, which
    needs `ANTHROPIC_API_KEY` (or equivalent) set in this environment —
    that's a real account/billing step only the user can do, not
    something buildable without them. Everything else needed to plug it
    in (file layout, the answer-key format to compare against) is already
    in place — implement `run_grading(worksheet_id, photo_path)` once a
    key exists.
  - Today's in-chat test of "can the AI read messy handwriting at all"
    was done differently: the user sent worksheet photos directly into
    the Telegram conversation and the Claude session itself (which does
    have vision built in, in-chat) read them — that proved the *reading*
    step is plausible, but is not the same thing as this server being
    able to do it unattended, which needs the API key above.
- `website/index.html` — a static landing-page prototype (not deployed
  anywhere yet): explains the mechanism in plain terms, embeds a
  screenshot of a real generated worksheet
  (`website/sample-worksheet.png`), and has two CTA buttons
  ("Start on WhatsApp" / "Unlock full access") that are currently
  placeholder `href="#"` links — there is no real WhatsApp number or
  Stripe Payment Link yet.
  - Agreed architecture (2026-09-11): **WhatsApp is the daily-use engine
    (generate/submit/grade loop, no login, easy to forward/go viral in
    parent group chats), the website is the trust/credibility layer**
    (shows the product, explains it, hosts the actual payment) — mirrors
    what already works for the UK test site (Stripe Payment Link +
    session verification). The two need to share an identity (phone
    number or email) so paying on the website unlocks the WhatsApp side
    automatically — same pattern as the UK site's Stripe
    `checkout.sessions.retrieve` verification, not yet built here.

## Still blocked on the user (can't proceed without them)

- **WhatsApp Business API**: user confirmed (2026-09-11) they want the
  official Cloud API (not an unofficial library — explicitly because
  they're hoping for viral parent-group-chat forwarding, which is exactly
  the traffic pattern that gets unofficial/automated WhatsApp Web
  wrappers banned). They do not yet have a Meta Business account or a
  spare phone number. Meta's provided test number can be used for
  development in the meantime (limited to ~5 pre-registered recipient
  numbers) — doesn't need to wait for full business verification to start
  building against it.
- **Vision API key** for automatic grading (see server.py above).
- **Stripe** payment link + secret key, once monetization is actually
  being wired up (not urgent for the loop-testing MVP).
- Confirmation on whether to keep testing with the P1 generator or move
  to a P3-level worksheet (the user separately provided a real P3 test
  paper as reference — see the very first images shared in this
  project's Telegram history — which is meaningfully harder: division
  with remainder, multi-digit currency conversion, ordering, harder
  missing-digit puzzles).
