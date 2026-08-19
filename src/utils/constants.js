/**
 * constants.js
 * Centralised constants for MeetLingo extension.
 * All DOM selectors, message action types, language codes, and defaults live here.
 */

// ─── Message Action Types ────────────────────────────────────────────────────
export const ACTIONS = {
  TRANSLATE:         'TRANSLATE',
  TRANSLATION_RESULT:'TRANSLATION_RESULT',
  GET_SETTINGS:      'GET_SETTINGS',
  SAVE_SETTINGS:     'SAVE_SETTINGS',
  SETTINGS_UPDATED:  'SETTINGS_UPDATED',
  GET_STATS:         'GET_STATS',
  RESET_STATS:       'RESET_STATS',
  TOGGLE_OVERLAY:    'TOGGLE_OVERLAY',
  ERROR:             'ERROR',
};

// ─── DOM Selector Cascade (3-Tier Fallback) ──────────────────────────────────
// Tier 1: Semantic ARIA – most stable across Meet updates
// Tier 2: Known jsname attributes observed in Meet's DOM
// Tier 3: Structural heuristics
export const CAPTION_SELECTORS = {
  CONTAINER: [
    'div[aria-live="polite"][jsname]',
    'div[aria-live="polite"]',
    'div[role="region"][aria-label*="caption" i]',
    'div[role="region"][aria-label*="subtitle" i]',
    '[data-self-name] ~ div[aria-live]',
  ],
  CAPTION_BLOCK: [
    '[jsname="YSxPC"]',
    '[jsname="tgaKEf"]',
    '[data-message-text]',
    'div[aria-live] > div > div',
  ],
  SPEAKER: [
    '[data-sender-name]',
    '[jsname="r4nke"]',
    'img[alt][class*="avatar" i]',
    'span[class*="name" i]',
  ],
  CAPTION_BUTTON: [
    'button[aria-label*="caption" i]',
    'button[jsname="r8qRAd"]',
    'button[aria-label*="subtitle" i]',
    '[data-tooltip*="caption" i]',
  ],
};

// ─── Translation Providers ────────────────────────────────────────────────────
export const PROVIDERS = {
  DEEPL:  'deepl',
  GOOGLE: 'google',
};

// ─── Supported Languages ──────────────────────────────────────────────────────
// Curated top-30 list used in popup dropdowns
export const LANGUAGES = [
  { code: 'AUTO',  label: '🔍 Auto-Detect',         deepl: null,  google: null  },
  { code: 'EN',    label: '🇬🇧 English',              deepl: 'EN',  google: 'en'  },
  { code: 'ES',    label: '🇪🇸 Spanish',              deepl: 'ES',  google: 'es'  },
  { code: 'FR',    label: '🇫🇷 French',               deepl: 'FR',  google: 'fr'  },
  { code: 'DE',    label: '🇩🇪 German',               deepl: 'DE',  google: 'de'  },
  { code: 'IT',    label: '🇮🇹 Italian',              deepl: 'IT',  google: 'it'  },
  { code: 'PT',    label: '🇧🇷 Portuguese',           deepl: 'PT',  google: 'pt'  },
  { code: 'NL',    label: '🇳🇱 Dutch',                deepl: 'NL',  google: 'nl'  },
  { code: 'PL',    label: '🇵🇱 Polish',               deepl: 'PL',  google: 'pl'  },
  { code: 'RU',    label: '🇷🇺 Russian',              deepl: 'RU',  google: 'ru'  },
  { code: 'ZH',    label: '🇨🇳 Chinese (Simplified)', deepl: 'ZH',  google: 'zh'  },
  { code: 'JA',    label: '🇯🇵 Japanese',             deepl: 'JA',  google: 'ja'  },
  { code: 'KO',    label: '🇰🇷 Korean',               deepl: 'KO',  google: 'ko'  },
  { code: 'HI',    label: '🇮🇳 Hindi',                deepl: null,  google: 'hi'  },
  { code: 'AR',    label: '🇸🇦 Arabic',               deepl: 'AR',  google: 'ar'  },
  { code: 'TR',    label: '🇹🇷 Turkish',              deepl: 'TR',  google: 'tr'  },
  { code: 'SV',    label: '🇸🇪 Swedish',              deepl: 'SV',  google: 'sv'  },
  { code: 'DA',    label: '🇩🇰 Danish',               deepl: 'DA',  google: 'da'  },
  { code: 'FI',    label: '🇫🇮 Finnish',              deepl: 'FI',  google: 'fi'  },
  { code: 'CS',    label: '🇨🇿 Czech',                deepl: 'CS',  google: 'cs'  },
  { code: 'SK',    label: '🇸🇰 Slovak',               deepl: 'SK',  google: 'sk'  },
  { code: 'RO',    label: '🇷🇴 Romanian',             deepl: 'RO',  google: 'ro'  },
  { code: 'HU',    label: '🇭🇺 Hungarian',            deepl: 'HU',  google: 'hu'  },
  { code: 'BG',    label: '🇧🇬 Bulgarian',            deepl: 'BG',  google: 'bg'  },
  { code: 'UK',    label: '🇺🇦 Ukrainian',            deepl: 'UK',  google: 'uk'  },
  { code: 'EL',    label: '🇬🇷 Greek',                deepl: 'EL',  google: 'el'  },
  { code: 'ID',    label: '🇮🇩 Indonesian',           deepl: 'ID',  google: 'id'  },
  { code: 'VI',    label: '🇻🇳 Vietnamese',           deepl: null,  google: 'vi'  },
  { code: 'TH',    label: '🇹🇭 Thai',                 deepl: null,  google: 'th'  },
  { code: 'MS',    label: '🇲🇾 Malay',                deepl: null,  google: 'ms'  },
  { code: 'TA',    label: '🇮🇳 Tamil',                deepl: null,  google: 'ta'  },
];

// ─── Default Extension Settings ──────────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  enabled:        true,
  provider:       PROVIDERS.DEEPL,
  apiKey:         '',
  sourceLang:     'AUTO',
  targetLang:     'EN',
  showOriginal:   true,
  overlayOpacity: 0.88,
  fontSize:       17,
  overlayPosition: { bottom: '84px', left: '50%' },
  dailyCharLimit: 500000,  // safety cap, 0 = unlimited
};

// ─── Debounce & Buffer Config ─────────────────────────────────────────────────
export const BUFFER_CONFIG = {
  DEBOUNCE_MS:       450,
  FADE_AFTER_MS:     8000,
  POLL_INTERVAL_MS:  2000,
  MAX_RETRY:         3,
  RETRY_BASE_MS:     800,
  RATE_LIMIT_WINDOW: 5000,   // ms
  RATE_LIMIT_MAX_REQ: 10,    // requests per window
};
