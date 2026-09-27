// Cloudflare Worker: serves the static site (website/) for everything except
// /api/grade.
//
// Rewritten 2026-09-26 to match hk-homework-check's OCR -> code -> AI
// design, per explicit user instruction ("hk maths而家最緊要嘅嘢係要完全
// 用返homework check嘅邏輯"). The key structural difference from
// hk-homework-check that makes this MORE reliable, not just a copy: this
// project always has a REAL, already-known correct answer (the worksheet
// generator computed it, or a parent pasted one) -- so the AI's job here
// is never "guess what's right AND judge the student" (hk-homework-check's
// hard problem, confirmed still unresolved -- see that repo's Ticket 9/19).
// Here it's "read what the student wrote" (OCR, cheap and reliable) then
// "does this match the ALREADY-KNOWN correct answer" (code, wherever the
// answer is a plain number/fraction -- true calculator-grade certainty,
// no AI guess involved at all). AI is only asked to compare two already-
// known strings for the minority of compound/textual answers code can't
// parse -- a narrower, lower-risk task than hk-homework-check's, which
// still has no ground truth to compare against.
//
// Needs bindings (Cloudflare Workers & Pages -> this worker -> Bindings):
// - ANTHROPIC_API_KEY (Secrets Store) -- kept only as a last-resort
//   fallback path for the AI-compare stage (see callAiCompare below);
//   no longer the primary grader.
// - OPENROUTER_API_KEY (Secrets Store) -- NEW, shares the same Secrets
//   Store + secret_name as hk-homework-check's (see wrangler.toml
//   comment), so this needs no new secret value created, only the
//   binding declared.
// - RATE_LIMIT_KV -- unchanged from before.
//
// /api/grade is a public, unauthenticated, real-money endpoint -- anyone who
// finds this Worker's URL can call it directly (confirmed: this project was
// tested all session via raw curl, bypassing upload.html's UI and its
// client-side page/monthly caps entirely). The per-IP limit below is the
// real cost boundary; upload.html's caps are just a UX nicety on top.
const GRADE_RATE_LIMIT = 15; // max /api/grade calls per IP per hour

// Single source of truth for the OCR/vision model, matching
// hk-homework-check's PRODUCTION_OCR_MODEL exactly -- same reasoning:
// validated on real handwriting, cheap, fast. A future model swap is a
// one-line change here.
const PRODUCTION_OCR_MODEL = "qwen/qwen3-vl-235b-a22b-instruct";

// 2026-09-27: previously hardcoded as the literal string "claude-sonnet-5"
// inline at each call site (2 places) -- extracted into its own constant,
// same discipline as PRODUCTION_OCR_MODEL above and hk-homework-check's
// OCR_TEXT_MODEL/PRODUCTION_OCR_MODEL split (see that project's TICKETS.md
// Ticket 25/26 for why this isolation matters: a real model swap there
// was a one-line rollback specifically because the model string lived in
// exactly one place). Used for the real grading-judgment call
// (compareWithAi) -- kept separate from WEAK_AREA_MODEL_* below even
// though they currently share the same value, since they're different
// tasks (grading judgment vs. low-stakes text summarization) and a
// future swap of one should not silently also swap the other.
const JUDGE_MODEL_CLAUDE = "claude-sonnet-5";
// inferWeakAreas is explicitly low-stakes (see that function's own
// comment) -- its two tiers get their own constants for the same reason.
const WEAK_AREA_MODEL_OPENROUTER = "deepseek/deepseek-v4.1-flash";
const WEAK_AREA_MODEL_CLAUDE = "claude-sonnet-5";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/grade" && request.method === "POST") {
      return handleGrade(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

async function resolveSecret(envVar) {
  if (!envVar) return null;
  return typeof envVar === "string" ? envVar : await envVar.get();
}

async function handleGrade(request, env) {
  const openrouterKey = await resolveSecret(env.OPENROUTER_API_KEY);
  const anthropicKey = await resolveSecret(env.ANTHROPIC_API_KEY);
  if (!openrouterKey && !anthropicKey) {
    return json(
      { error: "not_configured", message: "自動改卷未設定好，請聯絡網站管理員。" },
      503
    );
  }

  if (env.RATE_LIMIT_KV) {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const rateKey = "graderate:" + ip;
    let count = 0;
    try {
      const raw = await env.RATE_LIMIT_KV.get(rateKey);
      count = raw ? (parseInt(raw, 10) || 0) : 0;
    } catch (e) { /* KV unreachable -- don't block grading over it */ }
    if (count >= GRADE_RATE_LIMIT) {
      return json(
        { error: "rate_limited", message: "短時間內請求太多，請一小時後再試。" },
        429
      );
    }
    try {
      await env.RATE_LIMIT_KV.put(rateKey, String(count + 1), { expirationTtl: 3600 });
    } catch (e) { /* best-effort */ }
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "bad_request", message: "請求格式錯誤。" }, 400);
  }

  let { image, images, mediaType, answerKey, worksheetBank } = body;
  if (!images && image) images = [{ data: image, mediaType }];
  if (!images || !images.length || !answerKey) {
    return json({ error: "bad_request", message: "缺少相片或答案key。" }, 400);
  }
  const MAX_PAGES = 5;
  if (images.length > MAX_PAGES) {
    return json(
      { error: "too_many_pages", message: `每次最多批改 ${MAX_PAGES} 頁，請分開幾次提交。` },
      400
    );
  }
  const MAX_BANK = 15;
  const bank = Array.isArray(worksheetBank) ? worksheetBank.slice(0, MAX_BANK) : [];

  // Module 1: OCR only, one call per page -- same per-page isolation
  // reasoning as hk-homework-check's handleMark (one page's failure
  // doesn't sink the whole submission).
  const pageResults = await Promise.all(images.map(async (img, pageIdx) => {
    if (!openrouterKey) return { page: pageIdx, failed: true, error: "no_openrouter_key" };
    try {
      const r = await callMathOcr([img], openrouterKey);
      return { page: pageIdx, failed: false, items: r.items, worksheetId: r.worksheetId, usage: r.usage };
    } catch (e) {
      console.log(JSON.stringify({ event: "grade_page_ocr_failed", page: pageIdx, error: (e && (e.detail || e.message)) || String(e) }));
      return { page: pageIdx, failed: true, error: (e && (e.detail || e.uiMessage)) || String(e) };
    }
  }));

  if (pageResults.every((pr) => pr.failed)) {
    return json({ error: "upstream_error", message: "改卷服務暫時無法使用，請稍後再試。" }, 502);
  }

  // Module 1b: which worksheet is this? OCR already read the printed
  // "WORKSHEET <id>" text (if any) on each page -- a deterministic text
  // match against the bank, not a whole-page AI judgement call the way
  // the old single-AI-call design needed.
  const ocrWorksheetId = pageResults.map((pr) => pr.worksheetId).find(Boolean) || null;
  const bankMatch = ocrWorksheetId ? bank.find((w) => String(w.worksheetId) === String(ocrWorksheetId)) : null;
  const worksheetMismatch = bank.length > 0 && !bankMatch;
  const answerLines = (bankMatch ? bankMatch.answers : null) || answerKey.split("\n");
  const answerByLabel = new Map();
  answerLines.map(parseAnswerKeyLine).filter(Boolean).forEach((a) => answerByLabel.set(normalizeLabel(a.label), a));
  // A parent-pasted answer key for a DIFFERENT (non-generated) worksheet
  // is explicitly supported by upload.html's UI, and isn't guaranteed to
  // follow the "N) answer" shape every generator here produces -- if
  // structured parsing found nothing at all against a real non-empty
  // key, fall back to handing the AI-compare stage the RAW key text as
  // shared context for every item (closer to the old design's
  // robustness) rather than silently leaving every item unresolved with
  // no attempt to grade it at all.
  const rawKeyFallback = answerByLabel.size === 0 && answerKey.trim()
    ? { text: answerKey.trim(), raw: answerKey.trim(), isRawFallback: true }
    : null;

  // Module 2: code comparison, deterministic, no I/O -- wherever the
  // known-correct answer is a plain number/fraction/mixed number, this
  // is calculator-grade certainty, not an AI guess.
  const results = [];
  const pendingForAi = []; // { resultIndex, page, label, studentAnswer, expectedText }
  pageResults.forEach((pr, pageIdx) => {
    if (pr.failed) return;
    pr.items.forEach((item) => {
      const expected = answerByLabel.get(normalizeLabel(item.label)) || rawKeyFallback;
      const cmp = expected ? compareAnswer(item.studentAnswer, expected.text) : undefined;
      const resultIndex = results.length;
      if (cmp !== undefined && cmp !== null) {
        results.push({
          question: item.label,
          studentAnswer: item.studentAnswer,
          correct: cmp.correct,
          note: "",
          verifiedBy: "code",
        });
      } else {
        // Either no matching answer-key line was found for this label, or
        // the expected answer isn't a plain number code can compare --
        // both cases need the AI-compare stage, never a guess.
        results.push({
          question: item.label,
          studentAnswer: item.studentAnswer,
          correct: null,
          note: item.studentAnswer ? "需要人手複核" : "未作答",
          verifiedBy: "pending",
        });
        // "?" means OCR itself couldn't read the handwriting -- neither
        // code nor AI can meaningfully judge that against a known
        // answer, so it's excluded here too (stays needs_review, same
        // as a genuinely blank item just above).
        if (item.studentAnswer && item.studentAnswer !== "?" && expected) {
          pendingForAi.push({ resultIndex, page: pageIdx, label: item.label, studentAnswer: item.studentAnswer, expectedText: expected.text });
        }
      }
    });
  });

  // Module 3: AI compare -- ONLY for items code couldn't resolve, and
  // ONLY as "does the student's answer match this ALREADY-KNOWN correct
  // answer" (never "guess what's right"), batched per page with the real
  // image attached so answers needing visual context (e.g. a diagram
  // label) aren't judged from text alone. A page's AI-compare failing
  // leaves those items exactly as already built above (needs_review) --
  // never a regression.
  const pendingByPage = new Map();
  pendingForAi.forEach((p) => {
    if (!pendingByPage.has(p.page)) pendingByPage.set(p.page, []);
    pendingByPage.get(p.page).push(p);
  });
  const aiCompareUsage = [];
  if (pendingByPage.size) {
    await Promise.all(Array.from(pendingByPage.entries()).map(async ([pageIdx, pendingItems]) => {
      const tAi = Date.now();
      const outcome = await callAiCompare([images[pageIdx]], pendingItems, openrouterKey, anthropicKey);
      aiCompareUsage.push({ page: pageIdx, items: pendingItems.length, ms: Date.now() - tAi, model: outcome && outcome.model, usage: outcome && outcome.usage });
      if (!outcome) return;
      const byLabel = new Map(outcome.results.map((r) => [normalizeLabel(String(r.question)), r]));
      pendingItems.forEach((pending) => {
        const aiResult = byLabel.get(normalizeLabel(pending.label));
        if (!aiResult || typeof aiResult.correct !== "boolean") return;
        const r = results[pending.resultIndex];
        r.correct = aiResult.correct;
        r.note = "";
        r.verifiedBy = "ai";
      });
    }));
  }

  // Module 4: weak-area labels, text-only, cheap, low-stakes (a
  // descriptive summary, not a correctness verdict -- unlike the
  // results above, a wrong label here just makes a review-worksheet
  // link slightly less targeted, never shows a child a false mark).
  const wrongLines = results.filter((r) => r.correct === false).map((r) => {
    const expected = answerByLabel.get(normalizeLabel(r.question));
    return expected ? expected.raw : `${r.question}) ${r.studentAnswer}`;
  });
  const weakAreas = wrongLines.length ? await inferWeakAreas(wrongLines, openrouterKey, anthropicKey) : [];

  const correctCount = results.filter((r) => r.correct === true).length;
  const gradedCount = results.filter((r) => r.correct !== null).length;
  console.log(JSON.stringify({
    event: "grade_usage",
    items: results.length,
    pages: images.length,
    ocrWorksheetId,
    worksheetMismatch,
    aiCompare: aiCompareUsage,
  }));

  return json({
    results,
    score: `${correctCount} / ${gradedCount}`,
    weakAreas,
    worksheetMismatch,
  }, 200);
}

// Reads printed question labels + the student's handwritten answer only
// -- never judges correctness, exactly like hk-homework-check's
// OCR_ONLY_PROMPT/callQwenOcrText. Also asked to transcribe any printed
// "WORKSHEET <id>" text, which used to require a separate whole-page AI
// judgement call to identify.
const MATH_OCR_PROMPT = `你唔使判斷啱定錯，淨係負責抄低學生喺呢張數學工作紙相入面手寫嘅答案，一字不漏咁抄，唔好自己計數或者判斷。相有機會打橫/倒轉，先確認閱讀方向。學生成日用鉛筆寫字，筆跡好淺——要仔細睇清楚有冇淺色筆劃，睇唔清就填"?"。

**每一條印刷題號都一定要有返自己一行回覆，即使個題完全冇筆跡都好，唔可以因為冇筆跡就唔理嗰題、唔輸出佢——正確做法係「題號=」（等號後面留空，但個「題號=」本身一定要有）。** 唔可以自己計個答案填返去。

相入面通常會有印刷嘅"WORKSHEET <編號>"字樣（喺page頂或底），如果見到，用「WORKSHEET=<編號>」呢個格式獨立一行回覆（搵唔到就唔好回覆呢一行，唔好老作一個編號）。

其餘每一題回覆「題號=學生手寫答案」，用逗號分隔唔同題，題號跟返張相印刷嘅題號（例如"1)" "2a)" "3."）。

唔好加任何其他文字、判斷、JSON。例子（第2題冇筆跡）：
1=15,2=,3=8`;

async function callMathOcr(images, openrouterKey) {
  const body = {
    model: PRODUCTION_OCR_MODEL,
    max_tokens: 1500,
    temperature: 0,
    // Never route through Alibaba -- real children's homework photos,
    // same explicit user decision as hk-homework-check's Ticket 21.
    provider: { ignore: ["Alibaba"] },
    messages: [{
      role: "user",
      content: [
        { type: "text", text: MATH_OCR_PROMPT },
        ...images.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mediaType || "image/jpeg"};base64,${img.data}` } })),
      ],
    }],
  };
  const controller = new AbortController();
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => { controller.abort(); reject({ kind: "upstream_error", uiMessage: "改卷服務暫時無法使用，請稍後再試。", detail: "math_ocr_timeout", status: 502 }); }, 15000);
  });
  let res;
  try {
    res = await Promise.race([
      fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${openrouterKey}`, "http-referer": "https://hk-maths.violin-kwai.workers.dev", "x-title": "hk-maths" },
        body: JSON.stringify(body),
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);
  } catch (e) {
    throw (e && e.kind) ? e : { kind: "upstream_error", uiMessage: "改卷服務暫時無法使用，請稍後再試。", detail: "math_ocr_timeout", status: 502 };
  }
  if (!res.ok) {
    const errText = await res.text();
    throw { kind: "upstream_error", uiMessage: "改卷服務暫時無法使用，請稍後再試。", detail: errText.slice(0, 300), status: 502 };
  }
  const data = await res.json();
  const choice = data.choices && data.choices[0];
  if (!choice || choice.finish_reason !== "stop") {
    throw { kind: "upstream_error", uiMessage: "改卷服務暫時無法使用，請稍後再試。", detail: "math_ocr_incomplete", status: 502 };
  }
  const text = (choice.message && choice.message.content) || "";
  const { items, worksheetId } = parseMathOcrText(text);
  if (!items.length) {
    throw { kind: "upstream_error", uiMessage: "改卷服務暫時無法使用，請稍後再試。", detail: "math_ocr_empty", status: 502 };
  }
  return { items, worksheetId, usage: data.usage || null };
}

// Parses "1=15,2a)=8,WORKSHEET=A3F9" style plain-text OCR output into
// [{label, studentAnswer}] plus an optional worksheetId. Deliberately
// simple (no shared-answer-swap edge cases to guard against, unlike
// hk-homework-check's parseOcrLine) -- math worksheet answers are single
// short values, not multi-clause sentences that could contain a stray
// "=" or ",".
function parseMathOcrText(text) {
  const items = [];
  let worksheetId = null;
  String(text).split(",").forEach((chunk) => {
    const line = chunk.trim();
    if (!line) return;
    const wsMatch = /^WORKSHEET\s*=\s*(.+)$/i.exec(line);
    if (wsMatch) { worksheetId = wsMatch[1].trim(); return; }
    const m = /^(.+?)=(.*)$/.exec(line);
    if (!m) return;
    items.push({ label: m[1].trim(), studentAnswer: m[2].trim() });
  });
  return { items, worksheetId };
}

// "1) 15" -> {label:"1", text:"15", raw:"1) 15"}. Matches exactly the
// "${n}) ${answer}" shape every worksheet generator in website/ already
// produces (generator.html, assessment.html, assessment2.html,
// assessment3.html all push answers in this form) -- confirmed by
// reading their source, not assumed.
function parseAnswerKeyLine(line) {
  const s = String(line).trim();
  if (!s) return null;
  const m = /^(\S+?)\)\s*(.*)$/.exec(s);
  if (!m) return null;
  return { label: m[1].trim(), text: m[2].trim(), raw: s };
}

// Labels from OCR ("1", "2a", "3.") vs from the answer key ("1", "2a",
// "3") can differ in trailing punctuation -- strip it so "3." and "3"
// still match the same answer-key line.
function normalizeLabel(label) {
  return String(label).trim().replace(/[.)）]+$/, "").toLowerCase();
}

// True only when the ENTIRE expected-answer text is a bare number,
// fraction, or mixed number -- never a prefix match, so a compound
// answer like "15,17,19；順數" (a real generator.html shape) is correctly
// left to the AI-compare stage rather than silently graded on just its
// first number. Reuses hk-homework-check's exact parsing convention
// (mixed numbers via "又"/space, plain fractions, plain decimals).
function isBareNumericText(s) {
  const t = String(s).trim();
  if (!t) return false;
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return true; // plain integer/decimal
  if (/^-?\d+\/\d+$/.test(t)) return true; // plain fraction
  if (/^-?\d+(?:又|\s+)\d+\/\d+$/.test(t)) return true; // mixed number
  return false;
}
function parseNumericAnswer(str) {
  const s = String(str).trim();
  const mixedMatch = /^(-?\d+)(?:又|\s+)(\d+)\/(\d+)$/.exec(s);
  if (mixedMatch) {
    const whole = parseFloat(mixedMatch[1]);
    const num = parseFloat(mixedMatch[2]);
    const den = parseFloat(mixedMatch[3]);
    if (den === 0) return NaN;
    const frac = num / den;
    return whole < 0 ? whole - frac : whole + frac;
  }
  const fractionMatch = /^(-?\d+)\/(\d+)$/.exec(s);
  if (fractionMatch) {
    const num = parseFloat(fractionMatch[1]);
    const den = parseFloat(fractionMatch[2]);
    return den === 0 ? NaN : num / den;
  }
  return parseFloat(s);
}

// Returns {correct} when code can decide (expected answer is bare
// numeric AND the student's answer parses cleanly), or null/undefined
// when it can't -- undefined specifically for "no expected value at
// all", distinguished from null ("has an expected value, but it's not
// code-comparable") only for caller clarity; both routes to AI-compare
// identically.
function compareAnswer(studentAnswerText, expectedText) {
  if (!isBareNumericText(expectedText)) return null;
  const studentText = String(studentAnswerText || "").trim();
  if (!studentText || studentText === "?") return null; // illegible -- needs a human, not code or AI
  const expectedVal = parseNumericAnswer(expectedText);
  const studentVal = parseNumericAnswer(studentText);
  if (Number.isNaN(expectedVal) || Number.isNaN(studentVal)) return null;
  return { correct: Math.abs(expectedVal - studentVal) < 1e-9 };
}

// AI-compare: narrower and lower-risk than hk-homework-check's fallback
// judge (see this file's top comment) -- the correct answer is already
// KNOWN, so the model's job is "does the student's answer count as
// equivalent to this known-correct answer", not "guess what's right".
// Still gets the real image (not text alone), for answers that need
// visual context to judge equivalence (e.g. a diagram-based label).
// Qwen first (cheap, fast, matches the OCR model), Claude Sonnet as a
// last-resort fallback (kept from the old design specifically for this
// narrow, low-volume role -- not the primary grader anymore, so its
// real cost stays small).
async function callAiCompare(images, pendingItems, openrouterKey, anthropicKey) {
  const itemsText = pendingItems.map((it) => `${it.label}: 學生答案「${it.studentAnswer}」，正確答案「${it.expectedText}」`).join("\n");
  const prompt = `你係一位細心嘅小學數學老師。以下每一題都已經有正確答案，你要做嘅淨係判斷學生寫嘅答案係咪同正確答案等同（留意唔同表達方式都可能係啱嘅，例如分數、小數、唔同次序嘅答案）：

${itemsText}

如果需要，可以直接睇相片對應位置嘅圖像去判斷。淨係回答上面列出嘅題號，唔好加返其他題目。

只回覆一個JSON物件：
{"results":[{"question":"題號","correct":true/false}]}`;

  if (openrouterKey) {
    try {
      const r = await callOpenRouterJson(images, prompt, openrouterKey, PRODUCTION_OCR_MODEL, 800);
      return { results: r.parsed.results || [], usage: r.usage, model: "qwen" };
    } catch (e) {
      console.log(JSON.stringify({ event: "grade_ai_compare_qwen_failed", error: (e && (e.detail || e.message)) || String(e) }));
    }
  }
  if (anthropicKey) {
    try {
      const r = await callClaudeJson(images, prompt, anthropicKey, JUDGE_MODEL_CLAUDE, 800);
      return { results: r.parsed.results || [], usage: r.usage, model: "sonnet" };
    } catch (e) {
      console.log(JSON.stringify({ event: "grade_ai_compare_sonnet_failed", error: (e && (e.detail || e.message)) || String(e) }));
    }
  }
  return null;
}

// Text-only, cheap, low-stakes -- see Module 4's own comment for why
// this doesn't need the same rigor as the correctness verdicts above.
async function inferWeakAreas(wrongLines, openrouterKey, anthropicKey) {
  const prompt = `以下係一個小學生做錯咗嘅數學題（題目/答案）：
${wrongLines.join("\n")}

請用最多3個簡短詞語歸納呢啲錯誤反映嘅弱項（例如：加減混合運算次序、長除法）。只回覆一個JSON物件：
{"weakAreas":["弱項1","弱項2"]}`;
  try {
    if (openrouterKey) {
      const r = await callOpenRouterJson([], prompt, openrouterKey, WEAK_AREA_MODEL_OPENROUTER, 300);
      return r.parsed.weakAreas || [];
    }
  } catch (e) { /* best-effort, never blocks the real grading result */ }
  try {
    if (anthropicKey) {
      const r = await callClaudeJson([], prompt, anthropicKey, WEAK_AREA_MODEL_CLAUDE, 300);
      return r.parsed.weakAreas || [];
    }
  } catch (e) { /* best-effort */ }
  return [];
}

async function callOpenRouterJson(images, prompt, openrouterKey, model, maxTokens) {
  const content = [{ type: "text", text: prompt }, ...images.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mediaType || "image/jpeg"};base64,${img.data}` } }))];
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${openrouterKey}`, "http-referer": "https://hk-maths.violin-kwai.workers.dev", "x-title": "hk-maths" },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0, provider: { ignore: ["Alibaba"] }, messages: [{ role: "user", content }] }),
  });
  if (!res.ok) throw { kind: "upstream_error", detail: `http_${res.status}` };
  const data = await res.json();
  const choice = data.choices && data.choices[0];
  const text = (choice && choice.message && choice.message.content) || "";
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const match = stripped.match(/\{[\s\S]*\}/);
  return { parsed: JSON.parse(match ? match[0] : stripped), usage: data.usage || null };
}

async function callClaudeJson(images, prompt, apiKey, model, maxTokens) {
  const content = [
    ...images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mediaType || "image/jpeg", data: img.data } })),
    { type: "text", text: prompt },
  ];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0, messages: [{ role: "user", content }] }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw { kind: "upstream_error", uiMessage: "改卷服務暫時無法使用，請稍後再試。", detail: errText.slice(0, 300), status: 502 };
  }
  const data = await res.json();
  const text = (data.content || []).map((b) => b.text || "").join("");
  const match = text.match(/\{[\s\S]*\}/);
  return { parsed: JSON.parse(match ? match[0] : text), usage: data.usage || null };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export {
  parseMathOcrText,
  parseAnswerKeyLine,
  normalizeLabel,
  isBareNumericText,
  parseNumericAnswer,
  compareAnswer,
};
