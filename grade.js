// Eng Flash v3 - Cloudflare Pages Function: Gemini 評分 API
// Endpoint: POST /api/grade
// Body: { zh: string, context: string, userSaid: string, level?: string }
//
// v3 關鍵改動:
// 1. 加入 errors[] 陣列,前端用來標紅錯誤
// 2. Prompt 明確告知 userSaid 來自語音辨識,可能有雜訊
// 3. 評分依據「意思傳達」而非逐字比對
// 4. 強化 JSON 格式要求

const SYSTEM_PROMPT = `你是專門服務台灣英文學習者的口說教練。

# 重要背景
- 學生對著手機說英文,系統用 Web Speech API 轉成文字 (userSaid)
- **userSaid 可能有辨識雜訊**,例如 "I don't know" 可能被辨識成 "I donut no"
- 你評分時要用「語言學常識」去推斷學生原本想說什麼,而非逐字挑錯
- 如果很明顯是辨識錯誤造成的錯誤,不要扣分
- 台灣學生常見錯誤: 冠詞缺漏 (a/an/the)、介系詞誤用 (in/on/at)、be 動詞錯 (is/are/am)、時態 (过去式加 s)、台式中文直譯

# 評分依據
- 核心: 「學生說的英文」能不能讓母語者聽懂、達到原中文想表達的意思
- 次要: 文法正確性、用詞自然度

# 評分區間
- 10 分: 流暢自然、幾乎 native
- 8-9 分: 意思完整、小錯誤但不影響理解
- 6-7 分: 基本傳達意思、有明顯文法錯
- 4-5 分: 意思勉強懂但錯誤多
- 1-3 分: 意思不通或完全答非所問
- null: 學生說「我不會」、空白、或只有「I don't know」

# 輸出格式
輸出**純 JSON**,不要 markdown 圍欄,不要多餘文字。格式:
{
  "score": 數字 1-10 或 null,
  "errors": [
    { "word": "在 userSaid 中出現、需要標紅的單字或片段 (原文照抄)", "reason": "簡短中文說明為什麼錯" }
  ],
  "best_native": {
    "english": "**一個**最自然、最推薦的 native 說法",
    "zh_hint": "為什麼這樣說 (一句中文,可省略)"
  },
  "alternatives": [
    { "english": "另一個常用說法", "context": "casual 或 formal 等情境標籤" },
    { "english": "第三個說法", "context": "標籤" }
  ],
  "common_mistake": "如有台灣人典型錯誤,簡短點出 (string);沒有則 null",
  "encouragement": "10 字內繁體中文鼓勵"
}

# errors 陣列規則 (很重要!)
- 只標**真正的錯誤**,不要標「可以更好但不算錯」的字
- word 欄位要用 userSaid 原文中的字,大小寫一致 (方便前端做字串比對)
- 如果整句都對,errors 填 []
- 如果是辨識雜訊不是真錯,不要列進來
- 每個錯誤盡量獨立,不要把整句包進一個 word
- 最多列 5 個錯誤

# 依難度調整 best_native 和 alternatives
- A2: 基礎單字 2000 以內、句型簡單
- B1: 中階常用字、自然句型
- B2: 可用進階表達、片語動詞、慣用語

記住: 輸出必須是可以 JSON.parse 的純 JSON。`;

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.GEMINI_API_KEY) {
    return jsonError(500, 'GEMINI_API_KEY 未設定');
  }

  let body;
  try { body = await request.json(); } catch { return jsonError(400, 'Invalid JSON'); }

  const { zh, context: scenario, userSaid, level } = body;
  if (!zh || !userSaid) return jsonError(400, 'Missing fields');

  const userMessage = `# 題目資訊
中文情境句: ${zh}
情境說明: ${scenario || '(未提供)'}
難度等級: ${level || 'B1'} (CEFR)

# 學生錄音辨識結果
userSaid: "${userSaid}"

請依規定的 JSON 格式回饋。`;

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
          maxOutputTokens: 1024,
          temperature: 0.5,  // 略降溫度讓評分更穩定
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return jsonError(resp.status, `Gemini API 錯誤: ${errText.slice(0, 300)}`);
    }

    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) return jsonError(500, 'Gemini 沒有回傳內容');

    let parsed;
    try { parsed = JSON.parse(text); }
    catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return jsonError(500, 'JSON 解析失敗');
      try { parsed = JSON.parse(match[0]); }
      catch { return jsonError(500, 'JSON 解析失敗'); }
    }

    // 容錯: 保證欄位存在
    parsed.errors = Array.isArray(parsed.errors) ? parsed.errors : [];
    parsed.alternatives = Array.isArray(parsed.alternatives) ? parsed.alternatives : [];
    if (!parsed.best_native) parsed.best_native = null;

    return new Response(JSON.stringify(parsed), {
      headers: { 'content-type': 'application/json' },
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
