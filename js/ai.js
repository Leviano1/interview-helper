// ai.js — talks to whichever AI provider is switched on.
//
// Every provider takes the same input and returns the same output:
//
//   AI.ask({ system, user, schema })  ──►  { ...parsed JSON... }
//
//   ┌──────────┬──────────────────────────────────────────┬──────────────┐
//   │ provider │ where the model runs                     │ cost         │
//   ├──────────┼──────────────────────────────────────────┼──────────────┤
//   │ chrome   │ Gemini Nano, inside Chrome on THIS laptop │ free, no key │
//   │ gemini   │ Google's servers (Gemini API)            │ free key     │
//   │ openai   │ OpenAI's servers                         │ paid key     │
//   └──────────┴──────────────────────────────────────────┴──────────────┘
//
// So the rest of the app never needs to know which one is being used.

(function () {
  'use strict';

  const SETTINGS_KEY = 'rehearse-settings';

  const PROVIDERS = {
    chrome: { label: 'Chrome built-in AI', needsKey: false },
    gemini: {
      label: 'Google Gemini', needsKey: true, defaultModel: 'gemini-flash-lite-latest', // fast, rarely overloaded
      keyHelp: 'Free key, no credit card: go to aistudio.google.com and click “Get API key”.',
    },
    openai: {
      label: 'OpenAI', needsKey: true, defaultModel: 'gpt-4o-mini',
      keyHelp: 'Paid key from platform.openai.com.',
    },
    none: { label: 'Off', needsKey: false },
  };

  // provider: null means "not chosen yet": use Chrome's built-in AI if this computer supports it
  const settings = { provider: null, keys: { gemini: '', openai: '' }, models: { gemini: '', openai: '' } };

  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (saved.apiKey) { // settings from the older version of the app (OpenAI only)
      settings.provider = 'openai';
      settings.keys.openai = saved.apiKey;
      settings.models.openai = saved.model || '';
    } else {
      Object.assign(settings, saved);
      settings.keys = { gemini: '', openai: '', ...(saved.keys || {}) };
      settings.models = { gemini: '', openai: '', ...(saved.models || {}) };
    }
  } catch (e) { /* storage unavailable */ }

  function save() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Chrome built-in AI (Prompt API, Chrome 148+)
  // ---------------------------------------------------------------------------
  // 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported' | 'unknown'
  let chromeStatus = 'unknown';
  const LM_OPTIONS = {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  };

  async function checkChrome() {
    if (!('LanguageModel' in window)) { chromeStatus = 'unsupported'; return chromeStatus; }
    try { chromeStatus = await window.LanguageModel.availability(LM_OPTIONS); }
    catch (e) { chromeStatus = 'unavailable'; }
    return chromeStatus;
  }

  // The model is downloaded once, the first time. Chrome only allows this after a click.
  async function enableChrome(onProgress) {
    chromeStatus = 'downloading';
    const session = await window.LanguageModel.create({
      ...LM_OPTIONS,
      monitor(m) { m.addEventListener('downloadprogress', (e) => onProgress && onProgress(e.loaded)); },
    });
    session.destroy();
    chromeStatus = 'available';
    return chromeStatus;
  }

  // ---------------------------------------------------------------------------
  // Which provider, and is it ready?
  // ---------------------------------------------------------------------------
  function provider() {
    if (settings.provider) return settings.provider;
    return ['available', 'downloadable', 'downloading'].includes(chromeStatus) ? 'chrome' : 'none';
  }

  function isReady() {
    const p = provider();
    if (p === 'chrome') return chromeStatus === 'available';
    if (p === 'none') return false;
    return !!settings.keys[p];
  }

  const model = (p) => settings.models[p] || PROVIDERS[p].defaultModel;

  function describe() {
    if (!isReady()) return 'AI off';
    const p = provider();
    return p === 'chrome' ? 'AI: on-device (free)' : `AI: ${PROVIDERS[p].label}`;
  }

  // ---------------------------------------------------------------------------
  // Ask the AI for JSON
  // ---------------------------------------------------------------------------
  async function ask({ system, user, schema, maxTokens = 800, onStatus = () => {} }) {
    const p = provider();
    if (!isReady()) throw new Error('AI is not switched on.');
    let text;

    if (p === 'chrome') {
      const session = await window.LanguageModel.create({
        ...LM_OPTIONS,
        initialPrompts: [{ role: 'system', content: system }],
      });
      try {
        text = await session.prompt(user, { responseConstraint: schema }); // forces valid JSON
      } finally {
        session.destroy();
      }
    } else if (p === 'gemini') {
      // Try the chosen model (with retries); if Google says it's overloaded, try the lighter model.
      // Lite is the fast default; the bigger Flash model is the backup (and vice versa)
      const chosen = model('gemini');
      const models = [chosen, chosen === GEMINI_LITE ? GEMINI_FLASH : GEMINI_LITE];
      let res;
      for (const [i, m] of models.entries()) {
        onStatus(i === 0 ? 'Asking Google Gemini…' : 'That model is busy, trying the other Gemini model…');
        res = await withRetries(() => fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.keys.gemini },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ role: 'user', parts: [{ text: user }] }],
              // newer Gemini models "think" first, which uses output tokens, so allow plenty
              generationConfig: { responseMimeType: 'application/json', maxOutputTokens: Math.max(maxTokens, 4096) },
            }),
          },
        ), { label: 'Google', onStatus });
        if (res.ok || !BUSY.includes(res.status)) break; // only fall back when the server is busy
      }
      if (!res.ok) throw await friendlyError('Gemini', res);
      const data = await res.json();
      text = (data.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('');
    } else {
      onStatus('Asking OpenAI…');
      const res = await withRetries(() => fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.keys.openai}` },
        body: JSON.stringify({
          model: model('openai'),
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          max_completion_tokens: maxTokens,
        }),
      }), { label: 'OpenAI', onStatus });
      if (!res.ok) throw await friendlyError('OpenAI', res);
      const data = await res.json();
      text = data.choices?.[0]?.message?.content || '';
    }
    return parseJSON(text);
  }

  // ---------------------------------------------------------------------------
  // Retrying when the server is busy
  // ---------------------------------------------------------------------------
  //   attempt 1 ──503 or no reply in 25s──► wait 1.5s ──► attempt 2
  const BUSY = [408, 429, 500, 502, 503, 504];
  const REQUEST_TIMEOUT_MS = 25000;

  // fetch() has no time limit of its own, so give up after 25 seconds
  async function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      if (err.name === 'AbortError') return new Response('Request timed out', { status: 408 });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  const GEMINI_LITE = 'gemini-flash-lite-latest';
  const GEMINI_FLASH = 'gemini-flash-latest';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function withRetries(doFetch, { attempts = 2, label = 'The AI', onStatus = () => {} } = {}) {
    let res;
    for (let i = 0; i < attempts; i++) {
      if (i > 0) onStatus(`${label} is busy, retrying (attempt ${i + 1})…`);
      res = await doFetch();
      if (res.ok || !BUSY.includes(res.status)) return res;
      // "no credits" is a 429 too, but waiting won't fix that
      if (res.status === 429 && /insufficient_quota/.test(await res.clone().text())) return res;
      if (i < attempts - 1) await sleep(1500 * 2 ** i);
    }
    return res;
  }

  // Turns raw API errors into something a person can act on
  async function friendlyError(name, res) {
    const body = (await res.text()).slice(0, 300);
    const fix = 'Switch to a free option (Chrome built-in AI or Google Gemini) in AI settings.';
    if (res.status === 401 || res.status === 403 || /API_KEY_INVALID|invalid_api_key|API key not valid/i.test(body)) {
      return new Error(`${name} rejected the API key. Check it in AI settings.`);
    }
    if (/insufficient_quota|no credits|billing/i.test(body)) {
      return new Error(`Your ${name} account has no credits left. ${fix}`);
    }
    if (res.status === 429) return new Error(`${name} rate limit reached (free tiers allow a few requests per minute). Wait a minute and try again.`);
    if (res.status === 408) return new Error(`${name} took too long to reply. Try again in a minute.`);
    if ([500, 502, 503, 504].includes(res.status)) {
      return new Error(`${name}'s servers are busy right now. This is on their side, not your key. Try again in a minute.`);
    }
    if (res.status === 404) return new Error(`${name} doesn't recognise the model "${model(name === 'Gemini' ? 'gemini' : 'openai')}". Type a current model name in AI settings.`);
    return new Error(`${name} error ${res.status}: ${body.slice(0, 150)}`);
  }

  // Models sometimes wrap JSON in ```json fences, so pull out the {...} part.
  function parseJSON(text) {
    try { return JSON.parse(text); } catch (e) {
      const match = (text || '').match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      throw new Error('The AI reply was not valid JSON.');
    }
  }

  window.AI = {
    PROVIDERS, settings, save, checkChrome, enableChrome, provider, isReady, model, describe, ask,
    get chromeStatus() { return chromeStatus; },
  };
})();
