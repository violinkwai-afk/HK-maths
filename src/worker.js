// Cloudflare Worker: serves the static site (website/) for everything except
// /api/grade, which calls the Anthropic API to grade an uploaded worksheet
// photo against the answer key the frontend already computed at generation
// time (see website/generator.html -- the answer key is generated
// client-side and randomized per worksheet, so there's no server-side
// record of "the right answer" unless the client sends it along).
//
// Needs an ANTHROPIC_API_KEY bound on this Worker via Cloudflare's Secrets
// Store (Workers & Pages -> this worker -> Bindings -> Add binding ->
// Secrets Store -- never put the real key in this file). A Secrets Store
// binding is NOT a plain string like a classic `wrangler secret put` value
// -- it's an object exposing an async .get(), so the key must be read with
// `await env.ANTHROPIC_API_KEY.get()`. Using the binding object directly
// (e.g. as a header value) silently stringifies to garbage and Anthropic
// rejects it as an invalid key -- this bit us once already.
//
// /api/grade is a public, unauthenticated, real-money endpoint -- anyone who
// finds this Worker's URL can call it directly (confirmed: this project was
// tested all session via raw curl, bypassing upload.html's UI and its
// client-side page/monthly caps entirely). The per-IP limit below, ported
// from the sibling Lituk project's _worker.js feedback-endpoint pattern, is
// the actual cost boundary; upload.html's caps are just a UX nicety on top.
// Needs a RATE_LIMIT_KV binding (Workers & Pages -> this worker -> Bindings
// -> Add binding -> KV namespace) -- fails open (skips the check) if it
// isn't bound yet, matching the UK site's own defensive pattern.
const GRADE_RATE_LIMIT = 15; // max /api/grade calls per IP per hour

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/grade" && request.method === "POST") {
      return handleGrade(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleGrade(request, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return json(
      { error: "not_configured", message: "自動改卷未設定好，請聯絡網站管理員。" },
      503
    );
  }
  const apiKey = typeof env.ANTHROPIC_API_KEY === "string"
    ? env.ANTHROPIC_API_KEY
    : await env.ANTHROPIC_API_KEY.get();

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
    } catch (e) { /* best-effort -- a failed write here just means no throttling this time */ }
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

  // Notes are kept intentionally terse (a few characters, correct answers get
  // none at all) -- verbose per-question explanations were the single
  // biggest driver of output-token cost on dense, many-page worksheets.
  //
  // Generator-made worksheets print "WORKSHEET <id>" near the top and again
  // in the footer (deliberately at both ends, so a casual photo cropping one
  // end still catches the other). A parent who prints several worksheets in
  // one sitting and grades them later, out of order, needs the RIGHT one's
  // answers matched by that printed ID -- not just whichever was generated
  // most recently -- so the client sends every recently-generated worksheet
  // (worksheetBank) rather than a single expected one. The AI reads the ID
  // off the actual photo and picks the matching entry itself, in this same
  // call (no extra round trip / cost).
  const MAX_BANK = 15;
  const bank = Array.isArray(worksheetBank) ? worksheetBank.slice(0, MAX_BANK) : [];
  const answerKeySection = bank.length
    ? `呢個網站最近出過以下幾份卷，每份都有獨立編號，通常印喺page頂或底（"WORKSHEET <編號>"）：

${bank.map((w) => `[編號 ${w.worksheetId}]\n${(w.answers || []).join('\n')}`).join('\n\n')}

請先睇相片page頂或底印住嘅編號，揾返上面邊一份編號脗合，用嗰一份嘅答案嚟批改每一題。`
    : `以下是這份練習卷的正確答案（按題號排列）：
${answerKey}`;
  const worksheetIdCheck = bank.length
    ? `\n5. 如果相片入面完全睇唔到「WORKSHEET 編號」呢種格式、或者編號同上面列出嘅任何一份都對唔上（例如係另一份唔係呢個網出嘅卷），將 "worksheetMismatch" 設為 true，並改用「${answerKey}」呢份答案盡量批改。如果編號脗合到其中一份，"worksheetMismatch" 設為 false，用嗰一份嘅答案批改，唔使理返答案key嗰段文字。`
    : '';

  const prompt = `你是一位細心的小學數學老師，正在批改學生完成的練習卷相片（共${images.length}頁，屬於同一份卷）。

${answerKeySection}

請逐題比對相片中學生手寫的答案與上述正確答案。

要求：
1. 答題位置完全空白、沒有任何筆劃的題目，視為學生不懂，將 "correct" 設為 false，"note" 填「未作答」。這種情況不要設為 null。
2. 只有當答題位置「確實有筆劃，但寫得不清晰或有歧義」時，才不要臆測，將 "correct" 設為 null，並在 "note" 簡短註明原因（例如「字跡不清」），四個字以內。
3. "note" 只在答錯、未作答或不確定時填寫，答對的題目一律留空字串，不要重複題目內容或作出詳細解釋。
4. 只回覆一個JSON物件，不要加任何其他文字：
{
  "results": [
    {"question": "題號", "studentAnswer": "學生答案", "correct": true/false/null, "note": ""}
  ],
  "score": "X / Y（Y為總題數，X為答對題數，包括未作答；只有字跡不清的題目不計入Y）",
  "weakAreas": ["按錯誤歸納的弱項，例如：加減混合運算次序、長除法"]
}${worksheetIdCheck}`;

  let parsed;
  const usage = { sonnet: null, opus: null };
  try {
    const r = await callClaude("claude-sonnet-5", 4096, images, prompt, apiKey);
    parsed = r.parsed;
    usage.sonnet = r.usage;
  } catch (e) {
    return json({ error: e.kind || "upstream_error", message: e.uiMessage, detail: e.detail }, e.status || 502);
  }

  // Hybrid pass: Sonnet is cheap but sometimes punts on genuinely messy
  // handwriting (correct: null). Rather than paying Opus's much higher
  // price to re-read every question, only re-send the unsure ones -- the
  // photos still have to be re-uploaded (Opus needs the pixels too), but
  // the output is tiny (a handful of verdicts) instead of the whole sheet,
  // which is where most of the cost actually was.
  const unsure = (parsed.results || []).filter((r) => r.correct === null);
  if (unsure.length) {
    const recheckPrompt = `你是一位細心的小學數學老師。另一位老師已經批改咗呢份卷嘅大部分題目，但以下題號嘅手寫字佢睇唔清楚，需要你用更仔細嘅眼光再睇一次相片：第 ${unsure.map((r) => r.question).join("、")} 題。

呢份卷完整嘅正確答案（按題號排列）：
${answerKey}

只需要回覆上面列出嘅題號，要求：
1. 盡量仔細判斷。如果答題位置完全空白、冇任何筆劃，"correct" 設為 false，"note" 填「未作答」。
2. 只有答題位置確實有筆劃、但寫得太潦草無法判斷寫嘅係咩，先設 "correct" 為 null。
3. "note" 最多四個字，答對可留空。
4. 只回覆JSON，不要其他文字：
{"results":[{"question":"題號","studentAnswer":"學生答案","correct":true/false/null,"note":""}]}`;

    try {
      const rc = await callClaude("claude-opus-5", 2048, images, recheckPrompt, apiKey);
      const recheck = rc.parsed;
      usage.opus = rc.usage;
      const byQuestion = new Map((recheck.results || []).map((r) => [String(r.question), r]));
      parsed.results = (parsed.results || []).map((r) => {
        const updated = byQuestion.get(String(r.question));
        return updated && r.correct === null ? { ...r, ...updated } : r;
      });
    } catch (e) {
      // Opus recheck failing shouldn't sink the whole response -- the
      // Sonnet-only result (with its "unsure" flags intact) is still useful.
    }

    const graded = parsed.results.filter((r) => r.correct !== null);
    const correctCount = graded.filter((r) => r.correct === true).length;
    parsed.score = `${correctCount} / ${graded.length}`;
  }

  // Basic cost observability (Cloudflare Worker Logs / `wrangler tail`) --
  // not returned to the client. There was previously no way to see
  // per-request token usage short of the Anthropic billing dashboard.
  console.log(JSON.stringify({ event: "grade_usage", pages: images.length, usage }));

  return json(parsed, 200);
}

async function callClaude(model, maxTokens, images, prompt, apiKey) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        {
          role: "user",
          content: [
            ...images.map((img) => ({
              type: "image",
              source: {
                type: "base64",
                media_type: img.mediaType || "image/jpeg",
                data: img.data,
              },
            })),
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw { kind: "upstream_error", uiMessage: "改卷服務暫時無法使用，請稍後再試。", detail: errText.slice(0, 300), status: 502 };
  }

  const data = await res.json();
  const text = (data.content || []).map((b) => b.text || "").join("");
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return { parsed: JSON.parse(match ? match[0] : text), usage: data.usage || null };
  } catch (e) {
    throw { kind: "parse_error", uiMessage: "改卷結果解析失敗，請再試一次。", detail: text.slice(0, 500), status: 502 };
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
