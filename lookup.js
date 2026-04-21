// Cloudflare Pages Function: 單字查詢
// Endpoint: POST /api/lookup
// Body: { word: string }
// Returns: { word, pos, phonetic, translation, examples[], related[] }

const SYSTEM_PROMPT = `你是英文單字字典助手，服務繁體中文使用者。

收到一個英文單字，輸出純 JSON (不要加 markdown code fence):
{
  "pos": "詞性，例如 verb / noun / adj / phrase / idiom",
  "phonetic": "KK 或 IPA 音標，例如 /əˈbændən/",
  "translation": "最常用的 1-3 個中文意思，用「；」分隔",
  "examples": [
    { "en": "英文例句 1", "zh": "繁體中文翻譯" },
    { "en": "英文例句 2", "zh": "繁體中文翻譯" }
  ],
  "related": ["最多 3 個常見搭配或片語"]
}

原則:
- 翻譯用繁體中文 (台灣用法)
- 例句要口語實用,不要教科書式
- 例句長度控制在 10 個字以內
- 如果輸入的不是英文單字,或是無法辨識,照 JSON 格式回傳但 translation 填「查無此字」`;

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.GEMINI_API_KEY) return jsonError(500, 'GEMINI_API_KEY 未設定');

  let body;
  try { body = await request.json(); } catch { return jsonError(400, 'Invalid JSON'); }

  const { word } = body;
  if (!word || typeof word !== 'string') return jsonError(400, 'Missing word');

  const clean = word.trim().toLowerCase().slice(0, 50);
  if (!clean) return jsonError(400, 'Empty word');

  const model = env.GEMINI_MODEL || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: `單字: ${clean}` }] }],
        generationConfig: {
          maxOutputTokens: 512,
          temperature: 0.3,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return jsonError(resp.status, `Gemini API 錯誤: ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) return jsonError(500, '無回應');

    let parsed;
    try { parsed = JSON.parse(text); }
    catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return jsonError(500, 'JSON 解析失敗');
      try { parsed = JSON.parse(match[0]); }
      catch { return jsonError(500, 'JSON 解析失敗'); }
    }

    // cache hint: 單字查詢可公開快取 24h（如果 CF 後續需要）
    return new Response(JSON.stringify(parsed), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    return jsonError(500, err.message || 'Unknown error');
  }
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
