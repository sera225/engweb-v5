// Eng Flash v4 - 偷看答案 API (不評分,只回答案)
// Endpoint: POST /api/answer
// Body: { zh: string, context: string, level?: string }
// Returns: { best_native: {english, zh_hint}, alternatives: [{english, context}, {english, context}] }

const SYSTEM_PROMPT = `你是英文口說教練,專門幫台灣學習者把中文意思翻成自然的英文。

收到:
- 中文情境句
- 情境說明
- 難度等級 (CEFR A2/B1/B2)

輸出純 JSON (不要 markdown 圍欄):
{
  "best_native": {
    "english": "最推薦、最自然的 native 說法",
    "zh_hint": "一句中文簡短說明為什麼這樣說 (可省略)"
  },
  "alternatives": [
    { "english": "另一個常用說法", "context": "casual / 朋友之間 或其他情境標籤" },
    { "english": "第三個說法", "context": "另一情境標籤" }
  ]
}

規則:
- best_native 是最推薦的,口語自然
- alternatives 要給 2 個,不同註冊 (casual/formal) 或不同角度
- 總共 3 個說法都要實用、台灣情境下會真的用到
- 依難度調整選字:
  - A2: 基礎單字 2000 以內,句型簡單
  - B1: 中階常用字,自然不複雜
  - B2: 可用進階表達、片語動詞、慣用語

記住: 輸出必須是可 JSON.parse 的純 JSON。`;

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.GEMINI_API_KEY) return jsonError(500, 'GEMINI_API_KEY 未設定');

  let body;
  try { body = await request.json(); } catch { return jsonError(400, 'Invalid JSON'); }

  const { zh, context: scenario, level } = body;
  if (!zh) return jsonError(400, 'Missing zh');

  const userMessage = `中文情境句: ${zh}
情境: ${scenario || '(未提供)'}
難度: ${level || 'B1'} (CEFR)

請依 JSON 格式給我 3 個英文說法。`;

  const model = env.GEMINI_MODEL || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: {
          maxOutputTokens: 512,
          temperature: 0.6,
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
    if (!text) return jsonError(500, 'Gemini 無回應');

    let parsed;
    try { parsed = JSON.parse(text); }
    catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return jsonError(500, 'JSON 解析失敗');
      try { parsed = JSON.parse(match[0]); }
      catch { return jsonError(500, 'JSON 解析失敗'); }
    }

    parsed.alternatives = Array.isArray(parsed.alternatives) ? parsed.alternatives : [];
    if (!parsed.best_native) parsed.best_native = null;

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
