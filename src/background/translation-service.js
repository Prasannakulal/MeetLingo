/**
 * translation-service.js
 * Adapter layer for translation APIs.
 * Supports: DeepL (free & pro), Google Cloud Translation v2.
 * Includes LRU cache, exponential back-off retry, and rate-limit guard.
 */

import { LRUCache }       from './cache-manager.js';
import { PROVIDERS, LANGUAGES, BUFFER_CONFIG } from '../utils/constants.js';

export class TranslationService {
  /**
   * @param {{ apiKey: string, provider: string }} config
   */
  constructor(config = {}) {
    this.apiKey    = config.apiKey   || '';
    this.provider  = config.provider || PROVIDERS.DEEPL;
    this.cache     = new LRUCache(500);

    // Sliding-window rate limiter state
    this._requestTimestamps = [];
  }

  // ─── Public ──────────────────────────────────────────────────────────────────

  /**
   * Translate text, returning cached result if available.
   * @param {string} text
   * @param {string} targetLang  Internal code (e.g. 'ES', 'ZH')
   * @param {string|null} sourceLang  null = auto-detect
   * @returns {Promise<{ translatedText: string, fromCache: boolean, detectedSourceLang: string|null }>}
   */
  async translate(text, targetLang, sourceLang = null) {
    if (!text || !text.trim()) throw new Error('Empty text provided to translate()');

    const cacheKey = `${sourceLang || 'auto'}→${targetLang}:${text}`;

    // Cache hit
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return { translatedText: cached, fromCache: true, detectedSourceLang: null };
    }

    // Rate limiter
    this._checkRateLimit();

    let result;
    const targetApiCode = this._resolveCode(targetLang, 'target');
    const sourceApiCode = sourceLang ? this._resolveCode(sourceLang, 'source') : null;

    for (let attempt = 1; attempt <= BUFFER_CONFIG.MAX_RETRY; attempt++) {
      try {
        if (this.provider === PROVIDERS.DEEPL) {
          result = await this._translateDeepL(text, targetApiCode, sourceApiCode);
        } else if (this.provider === PROVIDERS.GOOGLE) {
          result = await this._translateGoogle(text, targetApiCode, sourceApiCode);
        } else {
          throw new Error(`Unknown provider: ${this.provider}`);
        }
        break; // Success
      } catch (err) {
        if (attempt === BUFFER_CONFIG.MAX_RETRY) throw err;
        // Exponential back-off
        await this._sleep(BUFFER_CONFIG.RETRY_BASE_MS * Math.pow(2, attempt - 1));
      }
    }

    this.cache.set(cacheKey, result.translatedText);
    return { ...result, fromCache: false };
  }

  /** Update API key and provider without recreating the cache. */
  configure({ apiKey, provider }) {
    if (apiKey  !== undefined) this.apiKey   = apiKey;
    if (provider !== undefined) this.provider = provider;
  }

  /** Expose cache statistics for the popup UI. */
  cacheStats() {
    return this.cache.stats();
  }

  // ─── DeepL ───────────────────────────────────────────────────────────────────

  async _translateDeepL(text, targetLang, sourceLang) {
    // Free keys end in ':fx', pro keys do not
    const isFree   = this.apiKey.endsWith(':fx');
    const endpoint = isFree
      ? 'https://api-free.deepl.com/v2/translate'
      : 'https://api.deepl.com/v2/translate';

    // DeepL requires Authorization header — NOT auth_key in the body
    const body = new URLSearchParams();
    body.append('text',        text);
    body.append('target_lang', targetLang.toUpperCase());
    if (sourceLang) body.append('source_lang', sourceLang.toUpperCase());


    const res = await fetch(endpoint, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `DeepL-Auth-Key ${this.apiKey}`,
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`DeepL ${res.status}: ${err}`);
    }

    const data = await res.json();
    return {
      translatedText:     data.translations[0].text,
      detectedSourceLang: data.translations[0].detected_source_language || null,
    };
  }

  // ─── Google Cloud Translation v2 ─────────────────────────────────────────────

  async _translateGoogle(text, targetLang, sourceLang) {
    const url = `https://translation.googleapis.com/language/translate/v2?key=${this.apiKey}`;

    const body = {
      q:      text,
      target: targetLang.toLowerCase(),
      format: 'text',
    };
    if (sourceLang) body.source = sourceLang.toLowerCase();

    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Google Translate ${res.status}: ${err}`);
    }

    const data = await res.json();
    const t    = data.data.translations[0];
    return {
      translatedText:     t.translatedText,
      detectedSourceLang: t.detectedSourceLanguage || null,
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Resolve internal language code to provider-specific API code.
   * @param {string} internalCode  e.g. 'ES', 'ZH'
   * @param {'source'|'target'} role
   */
  _resolveCode(internalCode, role) {
    if (!internalCode || internalCode === 'AUTO') return null;
    const lang = LANGUAGES.find(l => l.code === internalCode.toUpperCase());
    if (!lang) return internalCode;

    if (this.provider === PROVIDERS.DEEPL) return lang.deepl  || internalCode;
    if (this.provider === PROVIDERS.GOOGLE) return lang.google || internalCode.toLowerCase();
    return internalCode;
  }

  _checkRateLimit() {
    const now    = Date.now();
    const window = BUFFER_CONFIG.RATE_LIMIT_WINDOW;

    // Remove timestamps older than the window
    this._requestTimestamps = this._requestTimestamps.filter(t => now - t < window);

    if (this._requestTimestamps.length >= BUFFER_CONFIG.RATE_LIMIT_MAX_REQ) {
      throw new Error('MeetLingo: Rate limit exceeded. Please slow down.');
    }

    this._requestTimestamps.push(now);
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
