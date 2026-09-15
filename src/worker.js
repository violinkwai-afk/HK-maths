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

  const prompt = `你是一位細心的小學數學老師，正在批改學生完成的練習卷相片。呢份卷可能影咗多張相（例如${images.length}頁），全部都係同一份卷嘅唔同版，請將佢哋當成一份完整嘅卷嚟改。

以下是這份練習卷的正確答案（按題號排列）：
${answerKey}

請仔細睇相片入面學生手寫嘅答案，逐題同上面嘅正確答案比對。

要求：
1. 如果某一題嘅手寫字睇唔清楚或者有歧義，唔好亂估，喺個result度將 "correct" 設做 null，並喺 "note" 講明原因（例如「字跡唔清晰」）。
2. 只回覆一個JSON物件，格式如下，唔好加任何其他文字：
{
  "results": [
    {"question": "題號", "studentAnswer": "睇到嘅學生答案文字", "correct": true/false/null, "note": "簡短說明（可留空）"}
  ],
  "score": "X / Y（Y係總題數，X係答啱嘅題數，唔清晰嘅題唔計入Y）",
  "weakAreas": ["按錯誤歸納出嘅弱項，例如：加減混合運算次序、長除法"]
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
