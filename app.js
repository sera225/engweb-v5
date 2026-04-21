// Eng Flash v3 - 回饋區重新設計,錯誤紅字標示

import { QUESTIONS, TOPICS, LEVELS } from '/questions.js';

// ==================== 狀態 ====================
const state = {
  view: 'home',
  session: null,
  settings: loadSettings(),
  stucks: loadStucks(),
  history: loadHistory(),
  level: loadLevel(),
  streak_correct: 0,
  streak_wrong: 0,
  vocab: loadVocab(),
  vocabCache: loadVocabCache(),
  diagnosticDone: loadFlag('ef_diagnostic_done'),
  answerCache: loadAnswerCache(),  // 偷看答案的快取 (key = 題目 id)
};

// ==================== 儲存 ====================
function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem('ef_settings')) || {
      dailyGoal: 10, voice: 'en-US', ttsRate: 0.95,
    };
  } catch { return { dailyGoal: 10, voice: 'en-US', ttsRate: 0.95 }; }
}
function saveSettings() { localStorage.setItem('ef_settings', JSON.stringify(state.settings)); }

function loadStucks() { try { return JSON.parse(localStorage.getItem('ef_stucks')) || []; } catch { return []; } }
function saveStucks() { localStorage.setItem('ef_stucks', JSON.stringify(state.stucks)); }

function loadHistory() { try { return JSON.parse(localStorage.getItem('ef_history')) || []; } catch { return []; } }
function saveHistory() { localStorage.setItem('ef_history', JSON.stringify(state.history)); }

function loadLevel() { return localStorage.getItem('ef_level') || 'B1'; }
function saveLevel() { localStorage.setItem('ef_level', state.level); }

function loadVocab() { try { return JSON.parse(localStorage.getItem('ef_vocab')) || {}; } catch { return {}; } }
function saveVocab() { localStorage.setItem('ef_vocab', JSON.stringify(state.vocab)); }

function loadVocabCache() { try { return JSON.parse(localStorage.getItem('ef_vocab_cache')) || {}; } catch { return {}; } }
function saveVocabCache() { localStorage.setItem('ef_vocab_cache', JSON.stringify(state.vocabCache)); }

function loadAnswerCache() { try { return JSON.parse(localStorage.getItem('ef_answer_cache')) || {}; } catch { return {}; } }
function saveAnswerCache() { localStorage.setItem('ef_answer_cache', JSON.stringify(state.answerCache)); }

function loadFlag(key) { return localStorage.getItem(key) === '1'; }
function saveFlag(key, v) { localStorage.setItem(key, v ? '1' : '0'); }

// ==================== Streak 計算 ====================
function computeStreak() {
  if (state.history.length === 0) return 0;
  const days = new Set(state.history.map(h => h.date));
  const today = new Date().toISOString().slice(0, 10);
  let streak = 0;
  let cursor = days.has(today) ? new Date() : new Date(Date.now() - 86400000);
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  return streak;
}

function todayCount() {
  const today = new Date().toISOString().slice(0, 10);
  return state.history.filter(h => h.date === today).length;
}

function overallAvg() {
  if (state.history.length === 0) return '—';
  const scores = state.history.map(h => h.score).filter(s => typeof s === 'number');
  if (scores.length === 0) return '—';
  return (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
}

// ==================== 視圖切換 ====================
function showView(name) {
  state.view = name;
  ['home', 'practice', 'complete', 'stats', 'settings', 'vocab', 'flashcard', 'add-vocab'].forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.toggle('hidden', v !== name);
  });
  if (name === 'home') renderHome();
  if (name === 'stats') renderStats();
  if (name === 'settings') renderSettings();
  if (name === 'vocab') renderVocab();
  window.scrollTo(0, 0);
}

// ==================== 首頁 ====================
function renderHome() {
  document.getElementById('home-streak').textContent = computeStreak();
  document.getElementById('streak-badge').textContent = computeStreak();
  const count = todayCount();
  const goal = state.settings.dailyGoal;
  document.getElementById('home-today-count').textContent = count;
  document.getElementById('home-progress-bar').style.width = `${Math.min(100, count / goal * 100)}%`;
  document.getElementById('review-count').textContent = state.stucks.length;

  const lvl = LEVELS[state.level];
  const lvlBadge = document.getElementById('home-level-badge');
  if (lvlBadge) {
    lvlBadge.innerHTML = `<span class="text-lg">${lvl.emoji}</span> <span class="font-bold">${lvl.name}</span> <span class="text-xs opacity-70">${state.level}</span>`;
  }

  const vocabCount = Object.keys(state.vocab).length;
  const vocabBadge = document.getElementById('home-vocab-count');
  if (vocabBadge) vocabBadge.textContent = vocabCount;

  const grid = document.getElementById('topic-grid');
  grid.innerHTML = '';
  for (const [key, t] of Object.entries(TOPICS)) {
    const c = QUESTIONS.filter(q => q.topic === key && q.level_cefr === state.level).length;
    const btn = document.createElement('button');
    btn.className = 'bg-slate-800 rounded-2xl p-4 text-left active:scale-95 transition border border-slate-700 hover:border-slate-600';
    btn.innerHTML = `
      <div class="text-3xl mb-2">${t.emoji}</div>
      <div class="font-bold">${t.name}</div>
      <div class="text-xs text-slate-400 mt-1">${c} 題 · ${state.level}</div>
    `;
    btn.addEventListener('click', () => startSession({ topic: key }));
    grid.appendChild(btn);
  }
}

// ==================== 診斷測驗 ====================
function startDiagnostic() {
  const picks = [];
  ['A2', 'B1', 'B2'].forEach(level => {
    const pool = QUESTIONS.filter(q => q.level_cefr === level);
    shuffle(pool);
    picks.push(...pool.slice(0, 2));
  });
  shuffle(picks);
  state.session = { questions: picks, index: 0, results: [], isDiagnostic: true };
  renderQuestion();
  showView('practice');
}

function finishDiagnostic() {
  const results = state.session.results;
  const byLevel = { A2: [], B1: [], B2: [] };
  results.forEach((r, i) => {
    const q = state.session.questions[i];
    byLevel[q.level_cefr].push(r.score || 0);
  });
  const avgByLvl = {};
  ['A2', 'B1', 'B2'].forEach(l => {
    avgByLvl[l] = byLevel[l].length ? byLevel[l].reduce((a, b) => a + b, 0) / byLevel[l].length : 0;
  });

  let recommendedLevel = 'B1';
  if (avgByLvl.B2 >= 7) recommendedLevel = 'B2';
  else if (avgByLvl.B1 >= 6) recommendedLevel = 'B1';
  else recommendedLevel = 'A2';

  state.level = recommendedLevel;
  saveLevel();
  saveFlag('ef_diagnostic_done', true);
  state.diagnosticDone = true;

  const lvl = LEVELS[recommendedLevel];
  alert(`診斷完成!\n\n你的整體水準約為 ${recommendedLevel} (${lvl.name}) ${lvl.emoji}\n\n${lvl.desc}\n\n系統會根據你的表現自動調整難度。`);
  state.session = null;
  showView('home');
}

// ==================== 開始練習 ====================
function startSession({ topic = null, review = false } = {}) {
  let pool;
  if (review) {
    pool = state.stucks.map(s => QUESTIONS.find(q => q.id === s.id)).filter(Boolean);
    if (pool.length === 0) { toast('沒有卡點可複習 ✨'); return; }
  } else if (topic) {
    pool = QUESTIONS.filter(q => q.topic === topic && q.level_cefr === state.level);
  } else {
    pool = QUESTIONS.filter(q => q.level_cefr === state.level);
  }

  const stuckIds = new Set(state.stucks.map(s => s.id));
  const stuckQs = pool.filter(q => stuckIds.has(q.id));
  const freshQs = pool.filter(q => !stuckIds.has(q.id));
  shuffle(stuckQs); shuffle(freshQs);

  const target = Math.min(state.settings.dailyGoal, pool.length);
  const questions = [...stuckQs.slice(0, Math.ceil(target / 3)), ...freshQs].slice(0, target);
  state.session = { questions, index: 0, results: [] };
  renderQuestion();
  showView('practice');
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ==================== 練習頁渲染 ====================
function renderQuestion() {
  const { questions, index, isDiagnostic } = state.session;
  const q = questions[index];
  document.getElementById('practice-current').textContent = index + 1;
  document.getElementById('practice-total').textContent = questions.length;
  document.getElementById('practice-progress').style.width = `${index / questions.length * 100}%`;
  document.getElementById('practice-zh').textContent = `「${q.zh}」`;
  document.getElementById('practice-context').textContent = q.context;
  document.getElementById('practice-topic-emoji').textContent = TOPICS[q.topic].emoji;

  const levelTag = document.getElementById('practice-level-tag');
  if (levelTag) {
    if (isDiagnostic) {
      levelTag.innerHTML = `<span class="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300">📊 ${q.level_cefr}</span>`;
    } else {
      levelTag.innerHTML = `<span class="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">${LEVELS[q.level_cefr].emoji} ${q.level_cefr}</span>`;
    }
  }

  document.getElementById('record-status').textContent = '按一下開始錄音';
  document.getElementById('record-status').className = 'mt-3 text-sm text-slate-400';
  document.getElementById('record-zone').classList.remove('hidden');
  document.getElementById('feedback-zone').classList.add('hidden');
  document.querySelectorAll('[data-action="i-dont-know"], [data-action="skip"]').forEach(b => b.parentElement.classList.remove('hidden'));

  // 清空回饋區
  document.getElementById('user-transcript').innerHTML = '';
  document.getElementById('feedback-alternatives-box').classList.add('hidden');
  document.getElementById('toggle-alt-btn')?.classList.remove('rotate-180');

  // 重置偷看區
  document.getElementById('peek-zone').classList.add('hidden');
  document.getElementById('peek-answers').classList.add('hidden');
  document.getElementById('peek-answers').innerHTML = '';
  document.getElementById('peek-loading').classList.remove('hidden');
}

// ==================== 語音辨識 ====================
let recognition = null;
let isRecording = false;

function initRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('此瀏覽器不支援語音辨識,請用 Chrome'); return null; }
  const rec = new SR();
  rec.lang = state.settings.voice;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  return rec;
}

function toggleRecord() {
  if (isRecording) { recognition?.stop(); return; }
  recognition = initRecognition();
  if (!recognition) return;

  let finalText = '';
  const statusEl = document.getElementById('record-status');
  const btn = document.getElementById('btn-record');

  recognition.onstart = () => {
    isRecording = true;
    statusEl.textContent = '🔴 錄音中…(再按一下結束)';
    statusEl.className = 'mt-3 text-sm text-red-400';
    btn.classList.add('animate-pulse');
  };

  recognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t;
      else interim += t;
    }
    // 即時顯示(interim)
    document.getElementById('user-transcript').textContent = finalText + interim;
  };

  recognition.onerror = (e) => {
    statusEl.textContent = `錯誤:${e.error}`;
    isRecording = false;
    btn.classList.remove('animate-pulse');
  };

  recognition.onend = () => {
    isRecording = false;
    btn.classList.remove('animate-pulse');
    if (finalText.trim()) {
      statusEl.textContent = '✅ 評分中…';
      statusEl.className = 'mt-3 text-sm text-emerald-400';
      gradeAnswer(finalText.trim());
    } else {
      statusEl.textContent = '沒聽到聲音,再試一次';
      statusEl.className = 'mt-3 text-sm text-amber-400';
    }
  };

  recognition.start();
}

// ==================== AI 評分 ====================
async function gradeAnswer(userSaid) {
  const q = state.session.questions[state.session.index];
  try {
    const resp = await fetch('/api/grade', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ zh: q.zh, context: q.context, userSaid, level: q.level_cefr }),
    });
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    showFeedback(userSaid, data);
  } catch (err) {
    toast('評分失敗:' + err.message);
    document.getElementById('record-status').textContent = '評分失敗,請再試一次';
    document.getElementById('record-status').className = 'mt-3 text-sm text-red-400';
  }
}

// ==================== 關鍵:把 userSaid 的錯誤用紅色標示出來 ====================
function renderUserTranscriptWithErrors(userSaid, errors = []) {
  // errors 陣列格式:[{word: 'donut', reason: '應為 "do not"'}, ...]
  // 用不區分大小寫的字串搜尋,找到就包紅色
  let html = escapeHtml(userSaid);

  // 排序:較長的 word 先換,避免短字匹配到長字裡面
  const sorted = [...errors].sort((a, b) => (b.word || '').length - (a.word || '').length);

  sorted.forEach((err, idx) => {
    if (!err.word) return;
    const escaped = escapeHtml(err.word);
    // 用 regex 替換,但只替換一次(全部加標記會重複),用 token 先佔位
    const token = `__ERR_${idx}__`;
    // 不區分大小寫、全字詞邊界優先
    const pattern = new RegExp(escapeRegExp(escaped), 'i');
    html = html.replace(pattern, token);
  });

  // 再把 token 換成紅色 span,附 tooltip
  sorted.forEach((err, idx) => {
    if (!err.word) return;
    const reason = escapeHtml(err.reason || '');
    const wordEsc = escapeHtml(err.word);
    html = html.replace(
      `__ERR_${idx}__`,
      `<span class="text-red-400 underline decoration-wavy decoration-red-500" title="${reason}">${wordEsc}</span>`
    );
  });

  // 整段也要可以點單字查詢(錯字保留紅色,正常字綠色 hover)
  return wrapClickableWords(html);
}

// 把英文單字包成可點擊,但保留已有的 <span> 標記
function wrapClickableWords(html) {
  // 只處理不在 HTML tag 內的純文字部分
  return html.replace(
    /(<[^>]+>)|([A-Za-z]+(?:'[A-Za-z]+)?)/g,
    (match, tag, word) => {
      if (tag) return tag;
      if (!word) return match;
      return `<span class="clickable-word cursor-pointer hover:bg-amber-500/20 hover:underline decoration-amber-400 decoration-dotted rounded px-0.5 -mx-0.5" data-word="${word.toLowerCase()}">${word}</span>`;
    }
  );
}

function renderClickableEnglish(text) {
  return escapeHtml(text).replace(/([A-Za-z]+(?:'[A-Za-z]+)?)/g, (m) =>
    `<span class="clickable-word cursor-pointer hover:bg-amber-500/20 hover:underline decoration-amber-400 decoration-dotted rounded px-0.5 -mx-0.5" data-word="${m.toLowerCase()}">${m}</span>`
  );
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ==================== 顯示評分結果(v3 新版) ====================
function showFeedback(userSaid, data) {
  // 1. 顯示學生說的英文(錯字紅色)
  const transcriptEl = document.getElementById('user-transcript');
  transcriptEl.innerHTML = renderUserTranscriptWithErrors(userSaid, data.errors || []);

  // 2. 分數上色
  const score = data.score;
  const scoreEl = document.getElementById('feedback-score');
  scoreEl.textContent = score ?? '—';
  scoreEl.className = 'text-5xl font-bold';
  if (score === null || score === undefined) scoreEl.classList.add('text-slate-400');
  else if (score >= 8) scoreEl.classList.add('text-emerald-400');
  else if (score >= 6) scoreEl.classList.add('text-amber-400');
  else scoreEl.classList.add('text-red-400');

  // 3. 狀態列
  const statusEl = document.getElementById('record-status');
  if (score === null || score === undefined) {
    statusEl.textContent = '沒關係,看看正確說法 ↓';
    statusEl.className = 'mt-3 text-sm text-slate-400';
  } else if (score >= 8) {
    statusEl.textContent = '很棒!';
    statusEl.className = 'mt-3 text-sm text-emerald-400';
  } else if (score >= 6) {
    statusEl.textContent = '意思到了,可以再調整';
    statusEl.className = 'mt-3 text-sm text-amber-400';
  } else {
    statusEl.textContent = '看看更自然的說法 ↓';
    statusEl.className = 'mt-3 text-sm text-red-400';
  }

  // 4. 最佳 native 說法 (大字體、自動播放)
  const best = data.best_native || data.alternatives?.[0];
  const bestBox = document.getElementById('feedback-best');
  if (best) {
    bestBox.innerHTML = `
      <div class="flex items-start gap-3">
        <button class="text-2xl shrink-0 mt-0.5" data-speak="${escapeHtml(best.english)}">🔊</button>
        <div class="flex-1">
          <div class="text-lg font-medium leading-relaxed english-text">${renderClickableEnglish(best.english)}</div>
          ${best.zh_hint ? `<div class="text-xs text-slate-400 mt-1">💡 ${escapeHtml(best.zh_hint)}</div>` : ''}
        </div>
      </div>
    `;
    // 自動念一次
    setTimeout(() => speak(best.english), 350);
  }

  // 5. 常見錯誤提示
  const mistakeBox = document.getElementById('feedback-mistake-box');
  if (data.common_mistake) {
    document.getElementById('feedback-mistake').textContent = data.common_mistake;
    mistakeBox.classList.remove('hidden');
  } else {
    mistakeBox.classList.add('hidden');
  }

  // 6. 其他說法(預設收起)
  const altBox = document.getElementById('feedback-alternatives');
  altBox.innerHTML = '';
  const alts = data.alternatives || [];
  alts.forEach(a => {
    const card = document.createElement('div');
    card.className = 'bg-slate-800 rounded-xl p-3 flex items-start gap-3';
    card.innerHTML = `
      <button class="text-xl shrink-0 mt-0.5" data-speak="${escapeHtml(a.english)}">🔊</button>
      <div class="flex-1">
        <div class="font-medium english-text">${renderClickableEnglish(a.english)}</div>
        <div class="text-xs text-slate-400 mt-1">${escapeHtml(a.context || '')}</div>
      </div>
    `;
    altBox.appendChild(card);
  });
  const toggleBtn = document.getElementById('btn-toggle-alt');
  if (alts.length > 0) toggleBtn.parentElement.classList.remove('hidden');
  else toggleBtn.parentElement.classList.add('hidden');

  // 7. 鼓勵
  document.getElementById('feedback-encouragement').textContent = data.encouragement || '';

  // 8. 顯示整個回饋區,隱藏「我不會/跳過」
  document.getElementById('feedback-zone').classList.remove('hidden');
  document.querySelector('[data-action="i-dont-know"]')?.parentElement.classList.add('hidden');

  // 9. 儲存結果 + 更新難度引擎
  const q = state.session.questions[state.session.index];
  state.session.results.push({ id: q.id, score, userSaid });
  if (!state.session.isDiagnostic && typeof score === 'number') {
    updateLevelEngine(score);
  }
}

// ==================== 難度自適應 ====================
function updateLevelEngine(score) {
  if (score >= 8) { state.streak_correct++; state.streak_wrong = 0; }
  else if (score <= 4) { state.streak_wrong++; state.streak_correct = 0; }
  else { state.streak_correct = 0; state.streak_wrong = 0; }

  const order = ['A2', 'B1', 'B2'];
  const idx = order.indexOf(state.level);

  if (state.streak_correct >= 3 && idx < 2) {
    state.level = order[idx + 1]; saveLevel(); state.streak_correct = 0;
    toast(`🎉 升級到 ${LEVELS[state.level].name} ${LEVELS[state.level].emoji} (${state.level})`);
  }
  else if (state.streak_wrong >= 2 && idx > 0) {
    state.level = order[idx - 1]; saveLevel(); state.streak_wrong = 0;
    toast(`⬇️ 調整到 ${LEVELS[state.level].name} (${state.level}),慢慢來`);
  }
}

// ==================== TTS ====================
function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = state.settings.voice;
  u.rate = state.settings.ttsRate || 0.95;
  speechSynthesis.speak(u);
}

// ==================== 偷看答案 (v0.4 新增) ====================
async function peekAnswer() {
  if (!state.session || state.session.isDiagnostic) {
    toast('診斷測驗不能偷看');
    return;
  }

  const q = state.session.questions[state.session.index];
  const peekZone = document.getElementById('peek-zone');
  const peekLoading = document.getElementById('peek-loading');
  const peekAnswers = document.getElementById('peek-answers');

  // 已在顯示中 → 忽略
  if (!peekZone.classList.contains('hidden')) return;

  // 顯示展開區
  peekZone.classList.remove('hidden');
  peekLoading.classList.remove('hidden');
  peekAnswers.classList.add('hidden');

  // 先自動加入卡點
  if (!state.stucks.find(s => s.id === q.id)) {
    state.stucks.push({ id: q.id, addedAt: Date.now() });
    saveStucks();
    state.session.newStucks = (state.session.newStucks || 0) + 1;
  }

  // 檢查快取
  const cacheKey = `${q.id}_${q.level_cefr}`;
  if (state.answerCache[cacheKey]) {
    renderPeekAnswers(state.answerCache[cacheKey]);
    return;
  }

  // 打 API
  try {
    const resp = await fetch('/api/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ zh: q.zh, context: q.context, level: q.level_cefr }),
    });
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    state.answerCache[cacheKey] = data;
    saveAnswerCache();
    renderPeekAnswers(data);
  } catch (err) {
    peekLoading.innerHTML = `<div class="text-red-400 text-sm">查詢失敗: ${escapeHtml(err.message)}</div>`;
  }
}

function renderPeekAnswers(data) {
  const peekLoading = document.getElementById('peek-loading');
  const peekAnswers = document.getElementById('peek-answers');

  // 組合 best + alternatives,全部呈現
  const allAnswers = [];
  if (data.best_native) {
    allAnswers.push({
      english: data.best_native.english,
      context: data.best_native.zh_hint || '最推薦',
      isBest: true,
    });
  }
  (data.alternatives || []).forEach(a => {
    allAnswers.push({ english: a.english, context: a.context || '', isBest: false });
  });

  peekAnswers.innerHTML = allAnswers.map((a, i) => `
    <div class="bg-slate-900/60 rounded-xl p-3 flex items-start gap-3 ${a.isBest ? 'border border-amber-500/30' : ''}">
      <button class="text-xl shrink-0 mt-0.5" data-speak="${escapeHtml(a.english)}">🔊</button>
      <div class="flex-1 min-w-0">
        ${a.isBest ? '<div class="text-xs text-amber-400 font-medium mb-0.5">⭐ 最推薦</div>' : ''}
        <div class="font-medium leading-relaxed english-text">${renderClickableEnglish(a.english)}</div>
        ${a.context ? `<div class="text-xs text-slate-400 mt-1">${escapeHtml(a.context)}</div>` : ''}
      </div>
    </div>
  `).join('');

  peekLoading.classList.add('hidden');
  peekAnswers.classList.remove('hidden');

  // 自動念第一個(最推薦)
  if (allAnswers[0]) {
    setTimeout(() => speak(allAnswers[0].english), 350);
  }
}

function closePeek() {
  document.getElementById('peek-zone').classList.add('hidden');
}

// ==================== 單字查詢 ====================
async function lookupWord(word) {
  word = word.toLowerCase().trim();
  if (!word || word.length < 2) return;

  const popup = document.getElementById('word-popup');
  const popupBody = document.getElementById('word-popup-body');
  popup.classList.remove('hidden');
  popupBody.innerHTML = `<div class="text-center py-6 text-slate-400">查詢中 <span class="inline-block animate-pulse">...</span></div>`;

  if (state.vocabCache[word]) {
    renderWordPopup(word, state.vocabCache[word]);
    return;
  }

  try {
    const resp = await fetch('/api/lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ word }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    state.vocabCache[word] = data;
    saveVocabCache();
    renderWordPopup(word, data);
  } catch (err) {
    popupBody.innerHTML = `<div class="text-center py-4 text-red-400 text-sm">查詢失敗:${escapeHtml(err.message)}</div>`;
  }
}

function renderWordPopup(word, data) {
  const popupBody = document.getElementById('word-popup-body');
  const alreadySaved = !!state.vocab[word];
  popupBody.innerHTML = `
    <div class="flex items-start justify-between gap-3">
      <div>
        <div class="text-2xl font-bold">${escapeHtml(word)}</div>
        <div class="text-sm text-slate-400">${escapeHtml(data.pos || '')} ${data.phonetic ? '· ' + escapeHtml(data.phonetic) : ''}</div>
      </div>
      <button class="text-2xl" data-speak="${escapeHtml(word)}">🔊</button>
    </div>
    <div class="mt-3 space-y-3">
      <div>
        <div class="text-xs text-slate-500 uppercase mb-1">中文意思</div>
        <div>${escapeHtml(data.translation || '—')}</div>
      </div>
      ${data.examples && data.examples.length ? `
        <div>
          <div class="text-xs text-slate-500 uppercase mb-1">例句</div>
          <div class="space-y-2">
            ${data.examples.map(ex => `
              <div class="bg-slate-900/50 rounded-lg p-2 text-sm">
                <div class="english-text">${renderClickableEnglish(ex.en)}</div>
                <div class="text-slate-400 text-xs mt-0.5">${escapeHtml(ex.zh)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      ${data.related && data.related.length ? `
        <div>
          <div class="text-xs text-slate-500 uppercase mb-1">相關片語</div>
          <div class="text-sm text-slate-300">${data.related.map(r => escapeHtml(r)).join('、')}</div>
        </div>
      ` : ''}
    </div>
    <button class="w-full mt-4 py-2 rounded-xl font-medium ${alreadySaved ? 'bg-slate-700 text-slate-400' : 'bg-amber-500 text-slate-900'} active:scale-95 transition"
            data-save-word="${escapeHtml(word)}">
      ${alreadySaved ? '✓ 已在單字庫' : '⭐ 加入單字庫'}
    </button>
  `;
}

function saveWordToVocab(word) {
  if (state.vocab[word]) { toast('這個字已在單字庫'); return; }
  const cached = state.vocabCache[word];
  state.vocab[word] = {
    added: Date.now(),
    nextReview: Date.now() + 86400000,
    interval: 1,
    translation: cached?.translation || '',
    pos: cached?.pos || '',
  };
  saveVocab();
  toast(`⭐ 已加入:${word}`);
  renderWordPopup(word, cached);
}

// ==================== 閃卡複習 (v0.5 新增) ====================
// SRS 間隔:不會 → 1 天;會了 → 上次間隔 × 2 (上限 30 天)
function calcNextReview(interval, passed) {
  if (!passed) return { interval: 1, nextReview: Date.now() + 86400000 };
  const newInterval = Math.min(30, Math.max(2, interval * 2));
  return { interval: newInterval, nextReview: Date.now() + newInterval * 86400000 };
}

function startVocabReview() {
  const now = Date.now();
  const due = Object.entries(state.vocab).filter(([_, v]) => v.nextReview <= now);

  if (due.length === 0) {
    // 沒到期就全部複習 (或提示)
    const all = Object.entries(state.vocab);
    if (all.length === 0) {
      toast('單字庫是空的,先加一些字吧!');
      return;
    }
    if (!confirm(`目前沒有待複習的單字 ✨\n\n要練習所有 ${all.length} 個單字嗎?`)) return;
    state.flashSession = { words: shuffleArray(all.map(([w]) => w)), index: 0 };
  } else {
    state.flashSession = { words: shuffleArray(due.map(([w]) => w)), index: 0 };
  }
  renderFlashcard();
  showView('flashcard');
}

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function renderFlashcard() {
  const { words, index } = state.flashSession;
  if (index >= words.length) {
    finishVocabReview();
    return;
  }

  const word = words[index];
  const data = state.vocab[word] || {};
  const cached = state.vocabCache[word] || {};

  document.getElementById('flash-current').textContent = index + 1;
  document.getElementById('flash-total').textContent = words.length;
  document.getElementById('flash-progress').style.width = `${index / words.length * 100}%`;

  // 正面
  document.getElementById('flash-word').textContent = word;
  document.getElementById('flash-phonetic').textContent = cached.phonetic || '';

  // 反面
  document.getElementById('flash-word-back').textContent = word;
  document.getElementById('flash-phonetic-back').textContent = cached.phonetic || '';
  document.getElementById('flash-translation').textContent = data.translation || cached.translation || '(無翻譯)';

  const examplesEl = document.getElementById('flash-examples');
  const examples = cached.examples || [];
  if (examples.length > 0) {
    examplesEl.innerHTML = examples.slice(0, 2).map(ex => `
      <div class="bg-slate-900/50 rounded-lg p-2 flex items-start gap-2">
        <button class="text-lg shrink-0 mt-0.5" data-speak="${escapeHtml(ex.en)}">🔊</button>
        <div class="flex-1">
          <div class="english-text">${escapeHtml(ex.en)}</div>
          <div class="text-slate-500 text-xs mt-0.5">${escapeHtml(ex.zh)}</div>
        </div>
      </div>
    `).join('');
  } else {
    examplesEl.innerHTML = '<div class="text-xs text-slate-500 text-center py-2">(此單字沒有例句資料)</div>';
  }

  // 重置卡面
  document.getElementById('flash-front').classList.remove('hidden');
  document.getElementById('flash-back').classList.add('hidden');
  document.getElementById('flash-rate-buttons').classList.add('hidden');
  document.getElementById('flash-rate-hint').classList.add('hidden');
}

function flipFlashcard() {
  const front = document.getElementById('flash-front');
  const back = document.getElementById('flash-back');
  if (front.classList.contains('hidden')) return;  // 已翻
  front.classList.add('hidden');
  back.classList.remove('hidden');
  document.getElementById('flash-rate-buttons').classList.remove('hidden');
  document.getElementById('flash-rate-hint').classList.remove('hidden');
}

function rateFlashcard(passed) {
  const { words, index } = state.flashSession;
  const word = words[index];
  const data = state.vocab[word];
  if (!data) return;

  const { interval, nextReview } = calcNextReview(data.interval || 1, passed);
  state.vocab[word] = { ...data, interval, nextReview, lastReviewed: Date.now() };
  saveVocab();

  state.flashSession.index++;
  renderFlashcard();
}

function finishVocabReview() {
  const count = state.flashSession.words.length;
  state.flashSession = null;
  alert(`🎉 複習完成!今天已複習 ${count} 個單字。`);
  showView('vocab');
}

function speakFlashWord() {
  const { words, index } = state.flashSession || {};
  if (!words) return;
  speak(words[index]);
}

// ==================== 手動新增單字 (v0.5 新增) ====================
function openAddVocab() {
  document.getElementById('add-vocab-input').value = '';
  document.getElementById('add-vocab-preview').classList.add('hidden');
  state.pendingAddWord = null;
  showView('add-vocab');
  setTimeout(() => document.getElementById('add-vocab-input').focus(), 100);
}

async function submitAddVocab() {
  const input = document.getElementById('add-vocab-input');
  const word = input.value.trim().toLowerCase();
  if (!word) { toast('請輸入英文單字'); return; }
  if (word.length < 2 || word.length > 50) { toast('長度 2~50 字元'); return; }

  if (state.vocab[word]) {
    toast(`「${word}」已在單字庫 (底部列表可找到)`);
    return;
  }

  const previewBody = document.getElementById('add-vocab-preview-body');
  const previewBox = document.getElementById('add-vocab-preview');
  previewBox.classList.remove('hidden');
  previewBody.innerHTML = '<div class="text-center py-4 text-slate-400">AI 生成中...</div>';

  // 先看快取
  let data = state.vocabCache[word];
  if (!data) {
    try {
      const resp = await fetch('/api/lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ word }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      data = await resp.json();
      state.vocabCache[word] = data;
      saveVocabCache();
    } catch (err) {
      previewBody.innerHTML = `<div class="text-center py-4 text-red-400">查詢失敗: ${escapeHtml(err.message)}</div>`;
      return;
    }
  }

  state.pendingAddWord = word;

  previewBody.innerHTML = `
    <div class="flex items-start justify-between gap-3">
      <div>
        <div class="text-2xl font-bold">${escapeHtml(word)}</div>
        <div class="text-sm text-slate-400">${escapeHtml(data.pos || '')} ${data.phonetic ? '· ' + escapeHtml(data.phonetic) : ''}</div>
      </div>
      <button class="text-2xl" data-speak="${escapeHtml(word)}">🔊</button>
    </div>
    <div class="mt-3 space-y-3">
      <div>
        <div class="text-xs text-slate-500 uppercase mb-1">中文說明</div>
        <div>${escapeHtml(data.translation || '—')}</div>
      </div>
      ${data.examples && data.examples.length ? `
        <div>
          <div class="text-xs text-slate-500 uppercase mb-1">例句</div>
          <div class="space-y-2">
            ${data.examples.slice(0, 2).map(ex => `
              <div class="bg-slate-900/50 rounded-lg p-2 text-sm flex items-start gap-2">
                <button class="text-lg shrink-0 mt-0.5" data-speak="${escapeHtml(ex.en)}">🔊</button>
                <div class="flex-1">
                  <div class="english-text">${renderClickableEnglish(ex.en)}</div>
                  <div class="text-slate-400 text-xs mt-0.5">${escapeHtml(ex.zh)}</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      ${data.related && data.related.length ? `
        <div>
          <div class="text-xs text-slate-500 uppercase mb-1">相關片語</div>
          <div class="text-sm text-slate-300">${data.related.map(r => escapeHtml(r)).join('、')}</div>
        </div>
      ` : ''}
    </div>
  `;
}

function confirmAddVocab() {
  const word = state.pendingAddWord;
  if (!word) { toast('請先查詢'); return; }
  if (state.vocab[word]) { toast('已加入'); return; }

  const cached = state.vocabCache[word];
  state.vocab[word] = {
    added: Date.now(),
    nextReview: Date.now() + 86400000,
    interval: 1,
    translation: cached?.translation || '',
    pos: cached?.pos || '',
  };
  saveVocab();
  toast(`⭐ 已加入:${word}`);
  state.pendingAddWord = null;
  showView('vocab');
}

// ==================== 下一題 / 完成 ====================
function nextQuestion() {
  state.session.index++;
  if (state.session.index >= state.session.questions.length) {
    if (state.session.isDiagnostic) finishDiagnostic();
    else finishSession();
  } else {
    renderQuestion();
  }
}

function finishSession() {
  const today = new Date().toISOString().slice(0, 10);
  const results = state.session.results;
  results.forEach(r => state.history.push({ date: today, id: r.id, score: r.score }));
  saveHistory();

  const scores = results.map(r => r.score).filter(s => typeof s === 'number');
  const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—';

  document.getElementById('complete-count').textContent = results.length;
  document.getElementById('complete-avg').textContent = avg;
  document.getElementById('complete-stucks').textContent = state.session.newStucks || 0;
  document.getElementById('complete-streak').textContent = computeStreak();
  document.getElementById('complete-level').innerHTML = `${LEVELS[state.level].emoji} ${LEVELS[state.level].name} (${state.level})`;

  state.session = null;
  showView('complete');
}

// ==================== 卡點 ====================
function markAsStuck() {
  const q = state.session.questions[state.session.index];
  if (!state.stucks.find(s => s.id === q.id)) {
    state.stucks.push({ id: q.id, addedAt: Date.now() });
    saveStucks();
    state.session.newStucks = (state.session.newStucks || 0) + 1;
    toast('已加入卡點庫,明天複習 🆘');
  } else {
    toast('這題已在卡點庫');
  }
  state.session.results.push({ id: q.id, score: null, userSaid: '(不會)' });
  nextQuestion();
}

function skipQuestion() { nextQuestion(); }

// ==================== 統計頁 ====================
function renderStats() {
  document.getElementById('stats-streak').textContent = computeStreak();
  document.getElementById('stats-total').textContent = state.history.length;
  document.getElementById('stats-avg').textContent = overallAvg();
  document.getElementById('stats-stucks').textContent = state.stucks.length;
  document.getElementById('stats-level').innerHTML = `${LEVELS[state.level].emoji} ${LEVELS[state.level].name} <span class="text-sm text-slate-400">(${state.level})</span>`;

  const list = document.getElementById('stucks-list');
  list.innerHTML = '';
  if (state.stucks.length === 0) {
    list.innerHTML = '<div class="text-center text-slate-500 py-8 text-sm">還沒有卡點,加油練習!</div>';
    return;
  }
  state.stucks.slice(-20).reverse().forEach(s => {
    const q = QUESTIONS.find(q => q.id === s.id);
    if (!q) return;
    const item = document.createElement('div');
    item.className = 'bg-slate-800 rounded-xl p-3 flex items-center justify-between gap-2';
    item.innerHTML = `
      <div class="flex-1 text-sm">${escapeHtml(q.zh)}</div>
      <button class="text-xs text-red-400 hover:text-red-300" data-remove="${s.id}">移除</button>
    `;
    item.querySelector('[data-remove]').addEventListener('click', () => {
      state.stucks = state.stucks.filter(x => x.id !== s.id);
      saveStucks(); renderStats(); toast('已移除');
    });
    list.appendChild(item);
  });
}

// ==================== 單字庫頁 ====================
function renderVocab() {
  const list = document.getElementById('vocab-list');
  const words = Object.entries(state.vocab).sort((a, b) => b[1].added - a[1].added);
  document.getElementById('vocab-total').textContent = words.length;
  const now = Date.now();
  const dueCount = words.filter(([_, v]) => v.nextReview <= now).length;
  document.getElementById('vocab-due').textContent = dueCount;

  list.innerHTML = '';
  if (words.length === 0) {
    list.innerHTML = '<div class="text-center text-slate-500 py-8 text-sm">點擊練習時的英文單字可加入單字庫</div>';
    return;
  }
  words.forEach(([word, data]) => {
    const due = data.nextReview <= now;
    const item = document.createElement('div');
    item.className = `bg-slate-800 rounded-xl p-3 flex items-center justify-between gap-2 ${due ? 'border border-amber-500/30' : ''}`;
    item.innerHTML = `
      <button class="flex-1 min-w-0 text-left" data-word="${escapeHtml(word)}">
        <div class="flex items-center gap-2">
          <span class="font-bold">${escapeHtml(word)}</span>
          ${due ? '<span class="text-xs bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">待複習</span>' : ''}
        </div>
        <div class="text-xs text-slate-400 truncate">${escapeHtml(data.translation || '—')}</div>
      </button>
      <button class="text-xl" data-speak="${escapeHtml(word)}">🔊</button>
      <button class="text-xs text-red-400 px-2" data-remove-word="${escapeHtml(word)}">✕</button>
    `;
    item.querySelector('[data-remove-word]').addEventListener('click', (e) => {
      e.stopPropagation();
      delete state.vocab[word];
      saveVocab();
      renderVocab();
    });
    list.appendChild(item);
  });
}

// ==================== 設定頁 ====================
function renderSettings() {
  document.getElementById('setting-daily-goal').value = state.settings.dailyGoal;
  document.getElementById('setting-voice').value = state.settings.voice;
  document.getElementById('setting-level').value = state.level;
  const rate = state.settings.ttsRate || 0.95;
  document.getElementById('setting-tts-rate').value = rate;
}

// ==================== 工具 ====================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
}

// ==================== 事件委派 ====================
document.addEventListener('click', (e) => {
  // 🔊 優先級最高
  const speakBtn = e.target.closest('[data-speak]');
  if (speakBtn) {
    e.stopPropagation();
    speak(speakBtn.dataset.speak);
    return;
  }

  // 閃卡 🔊 (用單字當 text)
  const speakFlash = e.target.closest('[data-speak-flash]');
  if (speakFlash) {
    e.stopPropagation();
    speakFlashWord();
    return;
  }

  // 點閃卡翻面
  if (e.target.closest('#flashcard')) {
    flipFlashcard();
    return;
  }

  // 點單字查詢
  const wordEl = e.target.closest('[data-word]');
  if (wordEl) {
    lookupWord(wordEl.dataset.word);
    return;
  }

  // 加入單字庫 (popup 內)
  const saveBtn = e.target.closest('[data-save-word]');
  if (saveBtn) {
    saveWordToVocab(saveBtn.dataset.saveWord);
    return;
  }

  // 展開/收起其他說法
  if (e.target.closest('#btn-toggle-alt')) {
    const box = document.getElementById('feedback-alternatives-box');
    const icon = document.getElementById('toggle-alt-btn');
    box.classList.toggle('hidden');
    icon.classList.toggle('rotate-180');
    return;
  }

  // 一般 action
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  switch (action) {
    case 'start-mixed': startSession({}); break;
    case 'start-review': startSession({ review: true }); break;
    case 'start-diagnostic': startDiagnostic(); break;
    case 'back-home':
      state.session = null;
      document.getElementById('word-popup').classList.add('hidden');
      showView('home');
      break;
    case 'back-vocab':
      state.flashSession = null;
      showView('vocab');
      break;
    case 'i-dont-know': markAsStuck(); break;
    case 'skip': skipQuestion(); break;
    case 'next': nextQuestion(); break;
    case 'close-popup': document.getElementById('word-popup').classList.add('hidden'); break;
    case 'open-vocab': showView('vocab'); break;
    case 'start-review-vocab': startVocabReview(); break;
    case 'add-vocab': openAddVocab(); break;
    case 'submit-add-vocab': submitAddVocab(); break;
    case 'confirm-add-vocab': confirmAddVocab(); break;
    case 'flash-pass': rateFlashcard(true); break;
    case 'flash-fail': rateFlashcard(false); break;
    case 'reset':
      if (confirm('確定清除所有資料?無法復原')) {
        localStorage.clear();
        state.stucks = []; state.history = []; state.vocab = {}; state.vocabCache = {};
        state.answerCache = {};
        state.level = 'B1'; state.diagnosticDone = false;
        state.settings = loadSettings();
        toast('已清除'); showView('home');
      }
      break;
  }
});

document.getElementById('btn-record').addEventListener('click', toggleRecord);
document.getElementById('nav-stats').addEventListener('click', () => showView('stats'));
document.getElementById('nav-settings').addEventListener('click', () => showView('settings'));

// v0.4 新增: 題目卡點擊偷看
document.getElementById('question-card').addEventListener('click', peekAnswer);
document.getElementById('btn-close-peek').addEventListener('click', (e) => {
  e.stopPropagation();
  closePeek();
});

document.getElementById('setting-daily-goal').addEventListener('change', (e) => {
  state.settings.dailyGoal = parseInt(e.target.value); saveSettings();
});
document.getElementById('setting-voice').addEventListener('change', (e) => {
  state.settings.voice = e.target.value; saveSettings();
});
document.getElementById('setting-level').addEventListener('change', (e) => {
  state.level = e.target.value; saveLevel(); toast(`切換到 ${state.level}`); renderHome();
});
document.getElementById('setting-tts-rate').addEventListener('change', (e) => {
  state.settings.ttsRate = parseFloat(e.target.value); saveSettings();
});

// v0.5 新增:輸入單字後按 Enter 也可以查詢
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'add-vocab-input') {
    e.preventDefault();
    submitAddVocab();
  }
});

document.getElementById('word-popup')?.addEventListener('click', (e) => {
  if (e.target.id === 'word-popup') e.currentTarget.classList.add('hidden');
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ==================== 啟動 ====================
if (!state.diagnosticDone) {
  showView('home');
  setTimeout(() => {
    if (confirm('歡迎使用 Eng Flash ⚡\n\n要不要先做 6 題診斷測驗,讓系統幫你調整難度?\n(約 3 分鐘)')) {
      startDiagnostic();
    } else {
      saveFlag('ef_diagnostic_done', true);
      state.diagnosticDone = true;
    }
  }, 500);
} else {
  showView('home');
}
