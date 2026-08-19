/**
 * popup.js
 * Controls MeetLingo's settings popup UI.
 * Handles: provider switching, API key validation, language selectors,
 *          display options, session stats, and save.
 */

import { ACTIONS, PROVIDERS, LANGUAGES, DEFAULT_SETTINGS } from '../utils/constants.js';

// ─── DOM references ───────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const qs = sel => document.querySelector(sel);

const ui = {
  toggleEnabled:  $('toggle-enabled'),
  statusBanner:   $('status-banner'),
  btnDeepL:       $('btn-deepl'),
  btnGoogle:      $('btn-google'),
  apiKey:         $('api-key'),
  btnShowKey:     $('btn-show-key'),
  btnTestKey:     $('btn-test-key'),
  apiLink:        $('api-link'),
  sourceLang:     $('source-lang'),
  targetLang:     $('target-lang'),
  toggleOriginal: $('toggle-original'),
  fontSize:       $('font-size'),
  fontSizeVal:    $('font-size-val'),
  opacity:        $('opacity'),
  opacityVal:     $('opacity-val'),
  charLimit:      $('char-limit'),
  btnResetStats:  $('btn-reset-stats'),
  statChars:      $('stat-chars'),
  statRequests:   $('stat-requests'),
  statCache:      $('stat-cache'),
  statHitrate:    $('stat-hitrate'),
  btnSave:        $('btn-save'),
};

// ─── State ────────────────────────────────────────────────────────────────────
let currentSettings = { ...DEFAULT_SETTINGS };
let selectedProvider = PROVIDERS.DEEPL;

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function init() {
  populateLanguageDropdowns();
  await loadSettings();
  await loadStats();
  bindEvents();
}

// ─── Settings Load/Save ───────────────────────────────────────────────────────
async function loadSettings() {
  const res = await chrome.runtime.sendMessage({ action: ACTIONS.GET_SETTINGS });
  if (!res?.success) return;

  currentSettings  = res.settings;
  selectedProvider = currentSettings.provider || PROVIDERS.DEEPL;

  // Apply to UI
  ui.toggleEnabled.checked  = currentSettings.enabled !== false;
  ui.apiKey.value           = currentSettings.apiKey || '';
  ui.sourceLang.value       = currentSettings.sourceLang || 'AUTO';
  ui.targetLang.value       = currentSettings.targetLang || 'EN';
  ui.toggleOriginal.checked = currentSettings.showOriginal !== false;
  ui.fontSize.value         = currentSettings.fontSize || 17;
  ui.fontSizeVal.textContent = currentSettings.fontSize || 17;
  ui.opacity.value          = Math.round((currentSettings.overlayOpacity || 0.88) * 100);
  ui.opacityVal.textContent = Math.round((currentSettings.overlayOpacity || 0.88) * 100);
  ui.charLimit.value        = currentSettings.dailyCharLimit || 0;

  setProvider(selectedProvider, false);
}

async function saveSettings() {
  ui.btnSave.disabled = true;

  const settings = {
    enabled:        ui.toggleEnabled.checked,
    provider:       selectedProvider,
    apiKey:         ui.apiKey.value.trim(),
    sourceLang:     ui.sourceLang.value,
    targetLang:     ui.targetLang.value,
    showOriginal:   ui.toggleOriginal.checked,
    fontSize:       parseInt(ui.fontSize.value),
    overlayOpacity: parseInt(ui.opacity.value) / 100,
    dailyCharLimit: parseInt(ui.charLimit.value) || 0,
  };

  const res = await chrome.runtime.sendMessage({ action: ACTIONS.SAVE_SETTINGS, settings });

  ui.btnSave.disabled = false;

  if (res?.success) {
    showBanner('Settings saved successfully ✓', 'success');
    currentSettings = settings;
  } else {
    showBanner(res?.error || 'Failed to save settings.', 'error');
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────
async function loadStats() {
  const res = await chrome.runtime.sendMessage({ action: ACTIONS.GET_STATS });
  if (!res?.success) return;

  const { session, cacheStats } = res;
  ui.statChars.textContent    = formatNumber(session?.charsTranslated || 0);
  ui.statRequests.textContent = formatNumber(session?.requestCount    || 0);
  ui.statCache.textContent    = formatNumber(session?.cacheHits       || 0);
  ui.statHitrate.textContent  = cacheStats?.hitRate || '0%';
}

// ─── Language Dropdowns ───────────────────────────────────────────────────────
function populateLanguageDropdowns() {
  // Source includes "Auto-Detect"
  LANGUAGES.forEach(lang => {
    const opt = document.createElement('option');
    opt.value = lang.code;
    opt.textContent = lang.label;
    ui.sourceLang.appendChild(opt.cloneNode(true));

    // Target dropdown excludes "Auto-Detect"
    if (lang.code !== 'AUTO') {
      ui.targetLang.appendChild(opt);
    }
  });
}

// ─── Provider Toggle ──────────────────────────────────────────────────────────
function setProvider(provider, updateFilter = true) {
  selectedProvider = provider;

  ui.btnDeepL.classList.toggle('active',  provider === PROVIDERS.DEEPL);
  ui.btnGoogle.classList.toggle('active', provider === PROVIDERS.GOOGLE);

  // Update API key link
  if (provider === PROVIDERS.DEEPL) {
    ui.apiLink.textContent = 'Get a free DeepL API key →';
    ui.apiLink.href = 'https://www.deepl.com/pro-api';
  } else {
    ui.apiLink.textContent = 'Get a Google Cloud API key →';
    ui.apiLink.href = 'https://cloud.google.com/translate/docs/setup';
  }

  // Grey out languages not supported by current provider
  if (updateFilter) filterLanguagesByProvider(provider);
}

function filterLanguagesByProvider(provider) {
  const field = provider === PROVIDERS.DEEPL ? 'deepl' : 'google';

  Array.from(ui.targetLang.options).forEach(opt => {
    const lang = LANGUAGES.find(l => l.code === opt.value);
    if (lang && lang[field] === null) {
      opt.disabled = true;
      opt.textContent = lang.label + ' (not supported)';
    } else if (lang) {
      opt.disabled    = false;
      opt.textContent = lang.label;
    }
  });
}

// ─── API Key Test ─────────────────────────────────────────────────────────────
async function testApiKey() {
  const key = ui.apiKey.value.trim();
  if (!key) { showBanner('Please enter an API key first.', 'error'); return; }

  showBanner('Saving & testing API key…', 'info');
  ui.btnTestKey.disabled = true;

  try {
    // IMPORTANT: Save the key to the background FIRST so it's in memory for the translate call
    await chrome.runtime.sendMessage({
      action: ACTIONS.SAVE_SETTINGS,
      settings: {
        apiKey:   key,
        provider: selectedProvider,
        targetLang: ui.targetLang.value || 'EN',
        sourceLang: ui.sourceLang.value || 'AUTO',
      },
    });

    const testRes = await chrome.runtime.sendMessage({
      action: ACTIONS.TRANSLATE,
      text: 'Hello, this is a test.',
      targetLang: ui.targetLang.value || 'ES',
    });

    if (testRes?.success && testRes.translatedText) {
      showBanner(`✓ Key valid! Test: "${testRes.translatedText}"`, 'success');
    } else {
      showBanner(testRes?.error || 'Key test failed. Check key and provider.', 'error');
    }
  } catch (err) {
    showBanner('Test failed: ' + err.message, 'error');
  } finally {
    ui.btnTestKey.disabled = false;
  }
}

// ─── Banner ───────────────────────────────────────────────────────────────────
let bannerTimer = null;

function showBanner(msg, type = 'info', duration = 3500) {
  clearTimeout(bannerTimer);
  ui.statusBanner.textContent  = msg;
  ui.statusBanner.className    = `status-banner ${type}`;

  bannerTimer = setTimeout(() => {
    ui.statusBanner.className = 'status-banner hidden';
  }, duration);
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1)     + 'K';
  return String(n);
}

// ─── Events ───────────────────────────────────────────────────────────────────
function bindEvents() {
  ui.btnDeepL.addEventListener('click',  () => setProvider(PROVIDERS.DEEPL));
  ui.btnGoogle.addEventListener('click', () => setProvider(PROVIDERS.GOOGLE));

  ui.btnShowKey.addEventListener('click', () => {
    const isHidden = ui.apiKey.type === 'password';
    ui.apiKey.type = isHidden ? 'text' : 'password';
    ui.btnShowKey.textContent = isHidden ? '🙈' : '👁';
  });

  ui.btnTestKey.addEventListener('click', testApiKey);

  ui.fontSize.addEventListener('input', () => {
    ui.fontSizeVal.textContent = ui.fontSize.value;
  });

  ui.opacity.addEventListener('input', () => {
    ui.opacityVal.textContent = ui.opacity.value;
  });

  ui.btnResetStats.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: ACTIONS.RESET_STATS });
    await loadStats();
    showBanner('Session stats reset.', 'info');
  });

  ui.btnSave.addEventListener('click', saveSettings);

  // Auto-save on toggle change
  ui.toggleEnabled.addEventListener('change', async () => {
    await chrome.runtime.sendMessage({
      action:  ACTIONS.TOGGLE_OVERLAY,
      enabled: ui.toggleEnabled.checked,
    });
    showBanner(ui.toggleEnabled.checked ? '▶ Translation enabled' : '⏸ Translation paused', 'info');
  });

  // Refresh stats every 5 seconds while popup is open
  setInterval(loadStats, 5000);
}

// ─── Go ───────────────────────────────────────────────────────────────────────
init().catch(console.error);
