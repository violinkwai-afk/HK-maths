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

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "bad_request", message: "請求格式錯誤。" }, 400);
  }

  let { image, images, mediaType, answerKey } = body;
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
  const prompt = `你是一位細心的小學數學老師，正在批改學生完成的練習卷相片（共${images.length}頁，屬於同一份卷）。

以下是這份練習卷的正確答案（按題號排列）：
${answerKey}

請逐題比對相片中學生手寫的答案與上述正確答案。

要求：
1. 手寫字跡不清晰或有歧義時，不要臆測，將 "correct" 設為 null，並在 "note" 簡短註明原因（例如「字跡不清」），四個字以內。
2. "note" 只在答錯或不確定時填寫，答對的題目一律留空字串，不要重複題目內容或作出詳細解釋。
3. 只回覆一個JSON物件，不要加任何其他文字：
{
  "results": [
    {"question": "題號", "studentAnswer": "學生答案", "correct": true/false/null, "note": ""}
  ],
  "score": "X / Y（Y為總題數，X為答對題數，不清晰的題目不計入Y）",
  "weakAreas": ["按錯誤歸納的弱項，例如：加減混合運算次序、長除法"]
}`;

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 2048,
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

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    return json(
      { error: "upstream_error", message: "改卷服務暫時無法使用，請稍後再試。", detail: errText.slice(0, 300) },
      502
    );
  }

  const data = await anthropicRes.json();
  const text = (data.content || []).map((b) => b.text || "").join("");

  let parsed;
  try {
    const match = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : text);
  } catch (e) {
    return json(
      { error: "parse_error", message: "改卷結果解析失敗，請再試一次。", raw: text.slice(0, 500) },
      502
    );
  }

  return json(parsed, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
