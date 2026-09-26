// Regression tests for the 2026-09-26 OCR -> code -> AI rewrite of
// /api/grade (see src/worker.js's top comment for the design). No
// workerd-only imports in this file (unlike sibling project
// hk-homework-check's worker.js), so it can be imported directly as a
// plain ESM module -- no temp-file/sed-replace harness needed.

import test from "node:test";
import assert from "node:assert/strict";
import worker, {
  parseMathOcrText,
  parseAnswerKeyLine,
  normalizeLabel,
  isBareNumericText,
  parseNumericAnswer,
  compareAnswer,
} from "../src/worker.js";

// --- parseMathOcrText ---------------------------------------------------

test("parseMathOcrText: plain items, comma-separated", () => {
  const { items, worksheetId } = parseMathOcrText("1=15,2)=8,3a=?");
  assert.deepEqual(items, [
    { label: "1", studentAnswer: "15" },
    { label: "2)", studentAnswer: "8" },
    { label: "3a", studentAnswer: "?" },
  ]);
  assert.equal(worksheetId, null);
});

test("parseMathOcrText: WORKSHEET line extracted separately, not treated as a question item", () => {
  const { items, worksheetId } = parseMathOcrText("1=15,WORKSHEET=A3F9,2=8");
  assert.equal(worksheetId, "A3F9");
  assert.deepEqual(items.map((i) => i.label), ["1", "2"]);
});

test("parseMathOcrText: blank/unanswered item keeps an empty studentAnswer, not dropped", () => {
  const { items } = parseMathOcrText("1=15,2=,3=8");
  assert.equal(items.length, 3);
  assert.equal(items[1].studentAnswer, "");
});

test("parseMathOcrText: no items and no WORKSHEET line returns empty items", () => {
  const { items, worksheetId } = parseMathOcrText("");
  assert.deepEqual(items, []);
  assert.equal(worksheetId, null);
});

// --- parseAnswerKeyLine --------------------------------------------------

test("parseAnswerKeyLine: real generator.html shape, plain number", () => {
  const r = parseAnswerKeyLine("1) 15");
  assert.deepEqual(r, { label: "1", text: "15", raw: "1) 15" });
});

test("parseAnswerKeyLine: real assessment.html shape, sub-labelled + compound answer", () => {
  const r = parseAnswerKeyLine("1a) 15");
  assert.equal(r.label, "1a");
  assert.equal(r.text, "15");
});

test("parseAnswerKeyLine: real assessment3.html shape, compound comma+semicolon answer", () => {
  const r = parseAnswerKeyLine("3) 15,17,19；順數");
  assert.equal(r.label, "3");
  assert.equal(r.text, "15,17,19；順數");
});

test("parseAnswerKeyLine: blank line returns null", () => {
  assert.equal(parseAnswerKeyLine("   "), null);
});

test("parseAnswerKeyLine: no ')' separator returns null rather than guessing", () => {
  assert.equal(parseAnswerKeyLine("no separator here"), null);
});

// --- normalizeLabel --------------------------------------------------

test("normalizeLabel: strips trailing punctuation so OCR and answer-key labels match", () => {
  assert.equal(normalizeLabel("3."), "3");
  assert.equal(normalizeLabel("2)"), "2");
  assert.equal(normalizeLabel("2）"), "2"); // full-width paren
  assert.equal(normalizeLabel("1A"), "1a");
});

// --- isBareNumericText / parseNumericAnswer --------------------------------------------------

test("isBareNumericText: plain integer, decimal, fraction, mixed number all true", () => {
  assert.equal(isBareNumericText("15"), true);
  assert.equal(isBareNumericText("4.5"), true);
  assert.equal(isBareNumericText("3/4"), true);
  assert.equal(isBareNumericText("1又2/3"), true);
  assert.equal(isBareNumericText("-8"), true);
});

test("isBareNumericText: compound/textual answers are false, not partially matched", () => {
  assert.equal(isBareNumericText("15,17,19；順數"), false);
  assert.equal(isBareNumericText("left=8, right=2"), false);
  assert.equal(isBareNumericText(""), false);
});

test("parseNumericAnswer: mixed number via 又", () => {
  assert.equal(parseNumericAnswer("1又2/3"), 1 + 2 / 3);
});

// --- compareAnswer --------------------------------------------------

test("compareAnswer: matching bare numbers -> code-verified correct", () => {
  const r = compareAnswer("15", "15");
  assert.deepEqual(r, { correct: true });
});

test("compareAnswer: mismatched bare numbers -> code-verified wrong", () => {
  const r = compareAnswer("14", "15");
  assert.deepEqual(r, { correct: false });
});

test("compareAnswer: equivalent fraction/decimal forms still compare correctly", () => {
  const r = compareAnswer("0.75", "3/4");
  assert.deepEqual(r, { correct: true });
});

test("compareAnswer: compound expected answer (not bare numeric) -> null, needs AI, never a guess", () => {
  assert.equal(compareAnswer("15,17,19", "15,17,19；順數"), null);
});

test("compareAnswer: illegible ('?') student answer -> null, never silently marked wrong", () => {
  assert.equal(compareAnswer("?", "15"), null);
});

test("compareAnswer: blank student answer -> null (not auto-wrong here; the blank/未作答 note is set by the caller)", () => {
  assert.equal(compareAnswer("", "15"), null);
});

// --- Integration: handleGrade via the default export, mocked fetch --------------------------------------------------

function b64(s) { return Buffer.from(s, "utf8").toString("base64"); }

function mockFetch({ ocrReply, aiCompareReply, weakAreasReply } = {}) {
  return async (url, opts) => {
    const u = String(url);
    if (u.includes("openrouter.ai")) {
      const body = JSON.parse(opts.body);
      const textBlock = body.messages[0].content.find((c) => c.type === "text");
      let content;
      if (textBlock.text.startsWith("你唔使判斷啱定錯")) content = ocrReply;
      else if (textBlock.text.startsWith("你係一位細心嘅小學數學老師")) content = aiCompareReply;
      else content = weakAreasReply;
      if (content === undefined) return new Response("no mock configured for this prompt", { status: 502 });
      return new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 },
      }), { status: 200 });
    }
    throw new Error("unexpected fetch: " + u);
  };
}

async function callGrade(payload, { ocrReply, aiCompareReply, weakAreasReply, env = {} } = {}) {
  const originalFetch = global.fetch;
  global.fetch = mockFetch({ ocrReply, aiCompareReply, weakAreasReply });
  try {
    const req = new Request("https://example.com/api/grade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const fullEnv = { OPENROUTER_API_KEY: "test-key", ASSETS: { fetch: async () => new Response("not found", { status: 404 }) }, ...env };
    const res = await worker.fetch(req, fullEnv);
    return { status: res.status, json: await res.json() };
  } finally {
    global.fetch = originalFetch;
  }
}

test("handleGrade: code verifies a plain-number answer correctly, no AI compare call needed", async () => {
  const { status, json } = await callGrade(
    { images: [{ data: b64("PAGE"), mediaType: "image/jpeg" }], answerKey: "1) 15\n2) 8" },
    { ocrReply: "1=15,2=8" },
  );
  assert.equal(status, 200);
  assert.equal(json.results.length, 2);
  assert.equal(json.results[0].correct, true);
  assert.equal(json.results[0].note, "");
  assert.equal(json.score, "2 / 2");
});

test("handleGrade: code correctly marks a wrong plain-number answer", async () => {
  const { json } = await callGrade(
    { images: [{ data: b64("PAGE"), mediaType: "image/jpeg" }], answerKey: "1) 15" },
    { ocrReply: "1=14" },
  );
  assert.equal(json.results[0].correct, false);
  assert.equal(json.score, "0 / 1");
});

test("handleGrade: compound answer falls to AI-compare, real image attached, merges the verdict back", async () => {
  const { json } = await callGrade(
    { images: [{ data: b64("PAGE"), mediaType: "image/jpeg" }], answerKey: "1) 15,17,19；順數" },
    { ocrReply: "1=15,17,19", aiCompareReply: JSON.stringify({ results: [{ question: "1", correct: true }] }) },
  );
  assert.equal(json.results[0].correct, true);
});

test("handleGrade: AI-compare failing (nothing mocked) leaves the item needs_review, no regression", async () => {
  const { json } = await callGrade(
    { images: [{ data: b64("PAGE"), mediaType: "image/jpeg" }], answerKey: "1) 15,17,19；順數" },
    { ocrReply: "1=15,17,19" }, // no aiCompareReply mocked
  );
  assert.equal(json.results[0].correct, null);
});

test("handleGrade: blank/unanswered item is never sent to AI, stays needs_review with 未作答 note", async () => {
  const { json } = await callGrade(
    { images: [{ data: b64("PAGE"), mediaType: "image/jpeg" }], answerKey: "1) 15,17,19；順數" },
    { ocrReply: "1=" },
  );
  assert.equal(json.results[0].correct, null);
  assert.equal(json.results[0].note, "未作答");
});

test("handleGrade: worksheet bank match by OCR'd id uses that entry's answers, not the raw pasted key", async () => {
  const { json } = await callGrade(
    {
      images: [{ data: b64("PAGE"), mediaType: "image/jpeg" }],
      answerKey: "1) 999", // deliberately wrong/stale, should be ignored once bank matches
      worksheetBank: [{ worksheetId: "A3F9", answers: ["1) 15"] }],
    },
    { ocrReply: "1=15,WORKSHEET=A3F9" },
  );
  assert.equal(json.worksheetMismatch, false);
  assert.equal(json.results[0].correct, true);
});

test("handleGrade: worksheet bank present but OCR'd id matches nothing -> worksheetMismatch true, falls back to pasted key", async () => {
  const { json } = await callGrade(
    {
      images: [{ data: b64("PAGE"), mediaType: "image/jpeg" }],
      answerKey: "1) 15",
      worksheetBank: [{ worksheetId: "OTHER-ID", answers: ["1) 99"] }],
    },
    { ocrReply: "1=15,WORKSHEET=NOTFOUND" },
  );
  assert.equal(json.worksheetMismatch, true);
  assert.equal(json.results[0].correct, true); // fell back to the pasted "1) 15" key
});

test("handleGrade: illegible ('?') OCR answer never reaches AI-compare -- stays needs_review, not sent to the model at all", async () => {
  const { json } = await callGrade(
    { images: [{ data: b64("PAGE"), mediaType: "image/jpeg" }], answerKey: "1) 15,17,19；順數" },
    { ocrReply: "1=?" }, // no aiCompareReply mocked -- if this were (wrongly) sent, the mock would 502 and we'd still see null, so the real assertion is on the note
  );
  assert.equal(json.results[0].correct, null);
  assert.equal(json.results[0].note, "需要人手複核");
});

test("handleGrade: a parent-pasted answer key that doesn't match the 'N) answer' shape still gets a real AI-compare attempt via the raw-key fallback, not silently abandoned", async () => {
  const { json } = await callGrade(
    { images: [{ data: b64("PAGE"), mediaType: "image/jpeg" }], answerKey: "Q1: fifteen\nQ2: eight" }, // not "N) answer" shaped
    { ocrReply: "1=15", aiCompareReply: JSON.stringify({ results: [{ question: "1", correct: true }] }) },
  );
  assert.equal(json.results[0].correct, true);
  assert.equal(json.results[0].verifiedBy, "ai");
});

test("handleGrade: missing answerKey is a 400, never reaches OCR", async () => {
  const { status, json } = await callGrade({ images: [{ data: b64("PAGE"), mediaType: "image/jpeg" }] });
  assert.equal(status, 400);
  assert.equal(json.error, "bad_request");
});

test("handleGrade: too many pages is a 400", async () => {
  const images = Array.from({ length: 6 }, () => ({ data: b64("PAGE"), mediaType: "image/jpeg" }));
  const { status, json } = await callGrade({ images, answerKey: "1) 15" });
  assert.equal(status, 400);
  assert.equal(json.error, "too_many_pages");
});

test("handleGrade: weak areas are inferred from wrong answers when the AI call succeeds", async () => {
  const { json } = await callGrade(
    { images: [{ data: b64("PAGE"), mediaType: "image/jpeg" }], answerKey: "1) 15" },
    { ocrReply: "1=14", weakAreasReply: JSON.stringify({ weakAreas: ["加減混合運算次序"] }) },
  );
  assert.deepEqual(json.weakAreas, ["加減混合運算次序"]);
});

test("handleGrade: weak-area inference failing (nothing mocked) never breaks the real grading result", async () => {
  const { status, json } = await callGrade(
    { images: [{ data: b64("PAGE"), mediaType: "image/jpeg" }], answerKey: "1) 15" },
    { ocrReply: "1=14" }, // no weakAreasReply mocked
  );
  assert.equal(status, 200);
  assert.equal(json.results[0].correct, false); // the real verdict is unaffected
  assert.deepEqual(json.weakAreas, []);
});

test("handleGrade: rate limit blocks after GRADE_RATE_LIMIT calls from the same IP", async () => {
  let count = 15;
  const fakeKv = {
    get: async () => String(count),
    put: async (k, v) => { count = Number(v); },
  };
  const { status, json } = await callGrade(
    { images: [{ data: b64("PAGE"), mediaType: "image/jpeg" }], answerKey: "1) 15" },
    { ocrReply: "1=15", env: { RATE_LIMIT_KV: fakeKv } },
  );
  assert.equal(status, 429);
  assert.equal(json.error, "rate_limited");
});
