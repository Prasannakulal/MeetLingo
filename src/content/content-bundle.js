/**
 * content-bundle.js
 * Single self-contained content script injected into Google Meet.
 * No ES module imports — all code is inlined for Chrome MV3 compatibility.
 *
 * Modules inlined: CaptionObserver, SpeechTextBuffer, SubtitleOverlay, main orchestrator.
 */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTANTS
  // ═══════════════════════════════════════════════════════════════════════════
  const ACTIONS = {
    TRANSLATE:        'TRANSLATE',
    GET_SETTINGS:     'GET_SETTINGS',
    SAVE_SETTINGS:    'SAVE_SETTINGS',
    SETTINGS_UPDATED: 'SETTINGS_UPDATED',
    GET_STATS:        'GET_STATS',
    RESET_STATS:      'RESET_STATS',
    TOGGLE_OVERLAY:   'TOGGLE_OVERLAY',
  };

  // Meet notification patterns to IGNORE (these are UI toasts, not speech)
  const NOTIFICATION_PATTERNS = [
    /panel is (open|closed)/i,
    /is now (on|off|muted|unmuted)/i,
    /turned (on|off)/i,
    /has (joined|left) the (call|meeting)/i,
    /you are (now )?muted/i,
    /caption.{0,30}(on|off|enabled|disabled)/i,
    /translation.{0,30}(on|off|enabled|disabled|everyone)/i,
    /^(you|someone) (are|is) (now )?sharing/i,
    /recording (started|stopped)/i,
    /\bpresenting\b/i,
    /^[^\s]{0,30}\s(joined|left)$/i,
  ];

  const CAPTION_SELECTORS = {
    // Specific known jsname selectors for Meet's CC container
    CONTAINER_SPECIFIC: [
      'div[jsname="tgaKEf"]',
      'div[jsname="YSxPC"]',
      'div[jsname="Kk7lMc"]',
    ],
    // Broader ARIA fallbacks — filtered by position
    CONTAINER_ARIA: [
      'div[aria-live="polite"][jsname]',
      'div[role="region"][aria-label*="caption" i]',
      'div[role="region"][aria-label*="closed caption" i]',
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
      'button[aria-label*="turn on captions" i]',
    ],
  };

  const DEBOUNCE_MS      = 450;
  const FADE_AFTER_MS    = 8000;
  const POLL_INTERVAL_MS = 2000;

  const SPEAKER_COLORS = [
    '#38BDF8','#A78BFA','#34D399','#FB923C',
    '#F472B6','#FACC15','#60A5FA','#4ADE80',
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // CAPTION OBSERVER
  // ═══════════════════════════════════════════════════════════════════════════
  class CaptionObserver {
    constructor(onChunk) {
      this.onChunk         = onChunk;
      this.observer        = null;
      this.activeContainer = null;
      this.pollTimer       = null;
      this._lastRawText    = '';
    }

    start() {
      this._locateAndAttach();
      this._startPolling();
    }

    stop() {
      if (this.observer)  { this.observer.disconnect(); this.observer = null; }
      if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
      this.activeContainer = null;
      this._lastRawText    = '';
    }

    _locateAndAttach() {
      const container = this._findContainer();
      if (container === this.activeContainer) return;

      this.activeContainer = container;
      this._lastRawText    = '';
      if (this.observer) this.observer.disconnect();

      this.observer = new MutationObserver((mutations) => {
        for (const m of mutations) this._handleMutation(m);
      });

      this.observer.observe(container, {
        childList: true, subtree: true, characterData: true,
      });

      const label = container === document.body ? 'document.body (broad mode)' : container;
      console.debug('[MeetLingo] Observer attached to:', label);
    }

    /**
     * 4-tier container detection:
     * Tiers 1-3 use specific selectors with position validation.
     * Tier 4 falls back to document.body — works for ANY obfuscated-class
     * Meet caption container (e.g. <div class="ygicle VbkSUe">).
     */
    _findContainer() {
      // Tier 1: Known specific Meet CC jsname attributes
      for (const sel of CAPTION_SELECTORS.CONTAINER_SPECIFIC) {
        const el = document.querySelector(sel);
        if (el && this._isInContentArea(el)) return el;
      }

      // Tier 2: ARIA selectors filtered by position
      for (const sel of CAPTION_SELECTORS.CONTAINER_ARIA) {
        const el = document.querySelector(sel);
        if (el && this._isInContentArea(el)) return el;
      }

      // Tier 3: Any aria-live in the content area
      const allLive = document.querySelectorAll('[aria-live="polite"], [aria-live="assertive"]');
      for (const el of allLive) {
        if (this._isInContentArea(el)) return el;
      }

      // Tier 4: Broad mode — observe entire body, filter inside _extractAndDispatch
      return document.body;
    }

    /** Element must be in the main content zone (not toolbar, not controls bar). */
    _isInContentArea(el) {
      try {
        const rect = el.getBoundingClientRect();
        const vh   = window.innerHeight;
        return rect.width > 50 && rect.bottom > vh * 0.1 && rect.top < vh * 0.92;
      } catch (_) { return false; }
    }

    _tryEnableCaptions() {
      for (const sel of CAPTION_SELECTORS.CAPTION_BUTTON) {
        const btn = document.querySelector(sel);
        if (btn) {
          if (btn.getAttribute('aria-pressed') !== 'true') btn.click();
          return;
        }
      }
    }

    _startPolling() {
      this.pollTimer = setInterval(() => {
        // In broad mode keep observer alive; otherwise re-attach if container removed
        if (this.activeContainer === document.body) return;
        if (!this.activeContainer || !document.body.contains(this.activeContainer)) {
          this.activeContainer = null;
          this._locateAndAttach();
        }
      }, POLL_INTERVAL_MS);
    }

    _handleMutation(mutation) {
      if (mutation.type === 'characterData') {
        // Direct text-node mutation — most reliable signal
        this._extractAndDispatch(mutation.target.parentElement, true);
        return;
      }
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 5) {
            this._extractAndDispatch(node.parentElement, false);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const txt = (node.innerText || node.textContent || '').trim();
            if (txt.length > 10) this._extractAndDispatch(node, false);
          }
        }
      }
    }

    /**
     * Walk from the mutated node upward to find the best "caption block":
     *  - Leaf-like: mostly text, ≤8 child elements
     *  - Substantial text (≥10 chars)
     *  - In content area (broad-mode position check)
     *  - Not a notification
     */
    _extractAndDispatch(startNode, isCharData) {
      if (!startNode || startNode === document.body || startNode === document.documentElement) return;

      const isBroadMode = this.activeContainer === document.body;

      let el = startNode;
      let bestEl = null;

      for (let depth = 0; depth < 8; depth++) {
        if (!el || el === document.body) break;

        const text = (el.innerText || el.textContent || '').trim();
        if (text.length < 10) { el = el.parentElement; continue; }

        const childElemCount = el.children ? el.children.length : 0;
        if (childElemCount <= 8) {
          bestEl = el;
          if (childElemCount <= 2 || isCharData) break;
        }
        el = el.parentElement;
      }

      if (!bestEl) return;

      // In broad mode: enforce strict position check
      if (isBroadMode) {
        const rect = bestEl.getBoundingClientRect();
        const vh   = window.innerHeight;
        if (rect.top < vh * 0.10 || rect.bottom > vh * 0.92) return;
        if (rect.width < 80) return;
      }

      const text = (bestEl.innerText || bestEl.textContent || '').trim();

      if (!text || text.length < 10) return;
      if (this._isNotification(text)) {
        console.debug('[MeetLingo] Skipped notification:', text.slice(0, 60));
        return;
      }
      if (text === this._lastRawText) return;  // Deduplicate

      this._lastRawText = text;
      const speakerName = this._extractSpeaker(bestEl);
      this.onChunk({ speaker: speakerName || 'Speaker', text, timestamp: Date.now() });
    }

    _isNotification(text) {
      for (const pattern of NOTIFICATION_PATTERNS) {
        if (pattern.test(text)) return true;
      }
      return false;
    }

    _extractSpeaker(el) {
      for (const sel of CAPTION_SELECTORS.SPEAKER) {
        const found = el.querySelector?.(sel);
        if (found) {
          return found.getAttribute('data-sender-name')
              || found.getAttribute('alt')
              || found.textContent.trim()
              || null;
        }
      }
      return el.getAttribute?.('data-sender-name') || null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SPEECH TEXT BUFFER
  // ═══════════════════════════════════════════════════════════════════════════
  class SpeechTextBuffer {
    constructor(flushCallback) {
      this.flushCallback   = flushCallback;
      this.debounceTimer   = null;
      this.lastFlushedText = '';
      this.currentSpeaker  = null;
      this.currentText     = '';
      this.terminalRegex   = /[.!?…。！？\n][\s"'»\]\)]*$/;
    }

    push(payload) {
      const { speaker, text } = payload;
      if (!text || text.trim().length < 2) return;

      if (this.currentSpeaker && speaker !== this.currentSpeaker) {
        this._flushNow(this.currentSpeaker, this.currentText);
      }

      this.currentSpeaker = speaker;
      this.currentText    = text.trim();

      clearTimeout(this.debounceTimer);
      if (this.currentText === this.lastFlushedText) return;

      if (this.terminalRegex.test(this.currentText)) {
        this._flushNow(speaker, this.currentText);
        return;
      }

      this.debounceTimer = setTimeout(() => {
        this._flushNow(this.currentSpeaker, this.currentText);
      }, DEBOUNCE_MS);
    }

    forceFlush() {
      if (this.currentText && this.currentText !== this.lastFlushedText) {
        this._flushNow(this.currentSpeaker || 'Speaker', this.currentText);
      }
    }

    reset() {
      clearTimeout(this.debounceTimer);
      this.lastFlushedText = '';
      this.currentSpeaker  = null;
      this.currentText     = '';
    }

    _flushNow(speaker, fullText) {
      clearTimeout(this.debounceTimer);
      if (!fullText || fullText === this.lastFlushedText) return;

      let deltaText = fullText;
      if (this.lastFlushedText && fullText.startsWith(this.lastFlushedText)) {
        deltaText = fullText.slice(this.lastFlushedText.length).trim();
      }

      if (!deltaText || deltaText.length < 2) return;

      this.lastFlushedText = fullText;
      this.flushCallback({ speaker, text: deltaText, fullText, timestamp: Date.now() });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUBTITLE OVERLAY (Shadow DOM)
  // ═══════════════════════════════════════════════════════════════════════════
  class SubtitleOverlay {
    constructor() {
      this.hostEl     = null;
      this.shadow     = null;
      this.card       = null;
      this.fadeTimer  = null;
      this.speakerMap = new Map();
      this._settings  = { showOriginal: true, overlayOpacity: 0.88, fontSize: 17 };
      this._init();
    }

    show({ speaker, translatedText, originalText }) {
      if (!this.card) return;
      const color = this._speakerColor(speaker);

      this.shadow.getElementById('ml-spk').textContent  = speaker;
      this.shadow.getElementById('ml-spk').style.color  = color;
      this.shadow.getElementById('ml-trans').textContent = translatedText;

      const origEl = this.shadow.getElementById('ml-orig');
      origEl.textContent  = originalText;
      origEl.style.display = this._settings.showOriginal && originalText ? 'block' : 'none';

      this.card.classList.remove('ml-hidden', 'ml-fade');
      this.card.classList.add('ml-visible');

      clearTimeout(this.fadeTimer);
      this.fadeTimer = setTimeout(() => this.hide(), FADE_AFTER_MS);
    }

    showError(msg) {
      if (!this.card) return;
      this.shadow.getElementById('ml-spk').textContent  = '⚠ MeetLingo';
      this.shadow.getElementById('ml-spk').style.color  = '#F87171';
      this.shadow.getElementById('ml-trans').textContent = msg;
      this.shadow.getElementById('ml-orig').textContent  = '';

      this.card.classList.remove('ml-hidden', 'ml-fade');
      this.card.classList.add('ml-visible');
      clearTimeout(this.fadeTimer);
      this.fadeTimer = setTimeout(() => this.hide(), 5000);
    }

    hide() {
      if (!this.card) return;
      this.card.classList.add('ml-fade');
      setTimeout(() => {
        if (this.card) {
          this.card.classList.remove('ml-visible', 'ml-fade');
          this.card.classList.add('ml-hidden');
        }
      }, 300);
    }

    applySettings(s) {
      Object.assign(this._settings, s);
    }

    destroy() {
      clearTimeout(this.fadeTimer);
      if (this.hostEl) this.hostEl.remove();
      this.hostEl = this.shadow = this.card = null;
    }

    _init() {
      // Remove any previous instance
      const old = document.getElementById('meetlingo-root');
      if (old) old.remove();

      this.hostEl = document.createElement('div');
      this.hostEl.id = 'meetlingo-root';
      Object.assign(this.hostEl.style, {
        position: 'fixed',
        bottom:   '84px',
        left:     '50%',
        transform:'translateX(-50%)',
        zIndex:   '2147483647',
        pointerEvents: 'none',
      });
      document.body.appendChild(this.hostEl);

      this.shadow = this.hostEl.attachShadow({ mode: 'open' });

      const style = document.createElement('style');
      style.textContent = `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
        :host { all: initial; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .ml-card {
          pointer-events: auto;
          background: rgba(10, 14, 30, 0.90);
          backdrop-filter: blur(16px) saturate(180%);
          -webkit-backdrop-filter: blur(16px) saturate(180%);
          border: 1px solid rgba(255,255,255,0.10);
          box-shadow: 0 8px 40px rgba(0,0,0,0.55), 0 0 80px rgba(56,189,248,0.06);
          color: #F1F5F9;
          padding: 14px 22px 16px;
          border-radius: 16px;
          max-width: 700px;
          min-width: 300px;
          text-align: center;
          cursor: grab;
          user-select: none;
          transition: opacity 0.3s ease, transform 0.3s ease;
          position: relative;
        }
        .ml-card:active { cursor: grabbing; }
        .ml-hidden  { opacity: 0; transform: translateY(6px); pointer-events: none; display: none; }
        .ml-fade    { opacity: 0; transform: translateY(6px); }
        .ml-visible { opacity: 1; transform: translateY(0); display: block; }
        .ml-drag    { position: absolute; top: 6px; right: 10px; font-size: 12px; color: rgba(255,255,255,0.2); cursor: grab; }
        .ml-drag:hover { color: rgba(255,255,255,0.5); }
        .ml-spk-row { display: inline-flex; align-items: center; gap: 5px; margin-bottom: 6px; }
        .ml-dot     { width: 5px; height: 5px; border-radius: 50%; background: currentColor;
                      animation: mlpulse 1.8s ease-in-out infinite; }
        @keyframes mlpulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.6)} }
        .ml-spk     { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .8px; }
        .ml-trans   { font-size: 17px; font-weight: 600; line-height: 1.45; color: #F8FAFC; }
        .ml-orig    { font-size: 11.5px; color: #64748B; margin-top: 5px; font-style: italic; }
      `;
      this.shadow.appendChild(style);

      this.card = document.createElement('div');
      this.card.className = 'ml-card ml-hidden';
      this.card.innerHTML = `
        <span class="ml-drag" title="Drag to move">⠿</span>
        <div class="ml-spk-row">
          <span class="ml-dot"></span>
          <span class="ml-spk" id="ml-spk"></span>
        </div>
        <div class="ml-trans" id="ml-trans"></div>
        <div class="ml-orig"  id="ml-orig"></div>
      `;
      this.shadow.appendChild(this.card);
      this._makeDraggable(this.card);
    }

    _makeDraggable(card) {
      let startX, startY, origLeft, origTop;
      card.addEventListener('mousedown', (e) => {
        if (e.target.id === 'ml-trans' || e.target.id === 'ml-orig') return;
        e.preventDefault();
        startX = e.clientX; startY = e.clientY;
        const rect = this.hostEl.getBoundingClientRect();
        origLeft = rect.left; origTop = rect.top;
        this.hostEl.style.bottom    = '';
        this.hostEl.style.transform = 'none';

        const onMove = (ev) => {
          const newLeft = Math.max(0, Math.min(window.innerWidth  - rect.width,  origLeft + ev.clientX - startX));
          const newTop  = Math.max(0, Math.min(window.innerHeight - rect.height, origTop  + ev.clientY - startY));
          this.hostEl.style.left = newLeft + 'px';
          this.hostEl.style.top  = newTop  + 'px';
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup',   onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
      });
    }

    _speakerColor(name) {
      if (!this.speakerMap.has(name)) {
        this.speakerMap.set(name, SPEAKER_COLORS[this.speakerMap.size % SPEAKER_COLORS.length]);
      }
      return this.speakerMap.get(name);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN ORCHESTRATOR
  // ═══════════════════════════════════════════════════════════════════════════
  let observer = null;
  let buffer   = null;
  let overlay  = null;
  let settings = null;
  let running  = false;

  async function bootstrap() {
    try {
      const res = await chrome.runtime.sendMessage({ action: ACTIONS.GET_SETTINGS });
      if (!res?.success) { console.warn('[MeetLingo] Could not load settings'); return; }

      settings = res.settings;
      if (!settings.enabled) return;
      startPipeline();
    } catch (err) {
      console.error('[MeetLingo] Bootstrap error:', err);
    }
  }

  function startPipeline() {
    if (running) return;
    running = true;

    overlay = new SubtitleOverlay();
    overlay.applySettings(settings);

    buffer = new SpeechTextBuffer(async (payload) => {
      const { speaker, text, fullText } = payload;
      try {
        const result = await chrome.runtime.sendMessage({
          action:     ACTIONS.TRANSLATE,
          text,
          targetLang: settings.targetLang,
          sourceLang: settings.sourceLang === 'AUTO' ? null : settings.sourceLang,
        });

        if (!result || result.skipped) return;

        if (!result.success) {
          overlay.showError(result.error || 'Translation failed.');
          return;
        }

        overlay.show({
          speaker,
          translatedText: result.translatedText,
          originalText:   settings.showOriginal ? (fullText || text) : '',
        });
      } catch (err) {
        console.error('[MeetLingo] Translation error:', err);
      }
    });

    observer = new CaptionObserver((chunk) => buffer.push(chunk));
    observer.start();
    console.debug('[MeetLingo] Pipeline started.');
  }

  function stopPipeline() {
    if (!running) return;
    running = false;
    if (observer) { observer.stop(); observer = null; }
    if (buffer)   { buffer.forceFlush(); buffer.reset(); buffer = null; }
    if (overlay)  { overlay.hide(); }
    console.debug('[MeetLingo] Pipeline stopped.');
  }

  // Settings updates from popup/background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action !== ACTIONS.SETTINGS_UPDATED) return;
    const updated   = message.settings;
    const wasEnabled = settings?.enabled;
    settings = { ...(settings || {}), ...updated };

    if (updated.enabled === false && wasEnabled) { stopPipeline(); return; }
    if (updated.enabled === true  && !wasEnabled) { startPipeline(); return; }
    if (overlay && running) overlay.applySettings(settings);
  });

  // Re-attach on tab becoming visible
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && running && observer) {
      observer._locateAndAttach();
    }
  });

  window.addEventListener('beforeunload', () => {
    stopPipeline();
    if (overlay) overlay.destroy();
  });

  // Start
  bootstrap();

})();
