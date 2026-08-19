/**
 * content-bundle.js
 * Single self-contained content script injected into Google Meet.
 * No ES module imports — all code is inlined for Chrome MV3 compatibility.
 *
 * Modules inlined: CaptionObserver, SpeechTextBuffer, SubtitleOverlay, TranscriptSidebar, main orchestrator.
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

  const DEBOUNCE_MS      = 1200;
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

    _findContainer() {
      for (const sel of CAPTION_SELECTORS.CONTAINER_SPECIFIC) {
        const el = document.querySelector(sel);
        if (el && this._isInContentArea(el)) return el;
      }

      for (const sel of CAPTION_SELECTORS.CONTAINER_ARIA) {
        const el = document.querySelector(sel);
        if (el && this._isInContentArea(el)) return el;
      }

      const allLive = document.querySelectorAll('[aria-live="polite"], [aria-live="assertive"]');
      for (const el of allLive) {
        if (this._isInContentArea(el)) return el;
      }

      return document.body;
    }

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
        if (this.activeContainer === document.body) return;
        if (!this.activeContainer || !document.body.contains(this.activeContainer)) {
          this.activeContainer = null;
          this._locateAndAttach();
        }
      }, POLL_INTERVAL_MS);
    }

    _handleMutation(mutation) {
      if (mutation.type === 'characterData') {
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

      if (isBroadMode) {
        const rect = bestEl.getBoundingClientRect();
        const vh   = window.innerHeight;
        if (rect.top < vh * 0.10 || rect.bottom > vh * 0.92) return;
        if (rect.width < 80) return;
      }

      const text = (bestEl.innerText || bestEl.textContent || '').trim();

      if (!text || text.length < 10) return;
      if (this._isNotification(text)) return;

      if (text === this._lastRawText) return;
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
      const candidates = [el, el.parentElement, el.previousElementSibling];
      for (const c of candidates) {
        if (!c) continue;
        for (const sel of CAPTION_SELECTORS.SPEAKER) {
          const found = c.querySelector?.(sel);
          if (found) {
            return found.getAttribute('data-sender-name')
                || found.getAttribute('alt')
                || found.textContent.trim()
                || null;
          }
        }
      }
      return el.getAttribute?.('data-sender-name') || null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SPEECH TEXT BUFFER (Global Session Deduplication & Zero-Token-Waste Engine)
  // ═══════════════════════════════════════════════════════════════════════════
  class SpeechTextBuffer {
    constructor(flushCallback) {
      this.flushCallback          = flushCallback;
      this.debounceTimer          = null;
      this.lastFlushedFullText    = '';
      this.sessionTranslatedSentences = new Set(); // Global session cache (never cleared on pause!)
      this.currentSpeaker         = null;
      this.currentText            = '';
      this.lastSpeechTime         = Date.now();
      this.utteranceId            = Date.now();
    }

    push(payload) {
      const { speaker, text } = payload;
      if (!text || text.trim().length < 2) return;

      const now = Date.now();
      const trimmedText = text.trim();

      // If speaker changed or > 4 seconds of silence, finalize previous thought & start a NEW utterance block
      if ((this.currentSpeaker && speaker !== this.currentSpeaker) || (now - this.lastSpeechTime > 4000)) {
        this.forceFlush();
        this.currentSpeaker = speaker;
        this.currentText    = '';
        this.lastFlushedFullText = '';
        this.utteranceId    = now;
      }

      this.currentSpeaker = speaker;
      this.currentText    = trimmedText;
      this.lastSpeechTime = now;

      clearTimeout(this.debounceTimer);
      if (this.currentText === this.lastFlushedFullText) return;

      // Extract ONLY untranslated sentences from the growing Google Meet DOM string
      const untranslatedSentences = this._extractUntranslatedSentences(this.currentText);

      if (untranslatedSentences.length > 0) {
        const textToTranslate = untranslatedSentences.join(' ');
        this._flushNow(speaker, textToTranslate, textToTranslate);
      } else {
        // Handle trailing unpunctuated clause if speaker pauses
        this.debounceTimer = setTimeout(() => {
          const trailing = this._getTrailingUnpunctuatedClause(this.currentText);
          if (trailing) {
            this._flushNow(this.currentSpeaker, trailing, trailing);
          }
        }, DEBOUNCE_MS);
      }
    }

    forceFlush() {
      clearTimeout(this.debounceTimer);
    }

    reset() {
      clearTimeout(this.debounceTimer);
      this.lastFlushedFullText = '';
      this.currentSpeaker      = null;
      this.currentText         = '';
      this.utteranceId         = Date.now();
      // NOTE: sessionTranslatedSentences is deliberately NOT reset here to prevent re-translating old DOM sentences!
    }

    _extractUntranslatedSentences(fullText) {
      // Split text by sentence terminals (. ! ? … ! ?)
      const sentences = fullText.split(/(?<=[.!?…。！？])\s+/);
      const untranslated = [];

      for (const sentence of sentences) {
        const norm = sentence.trim().toLowerCase().replace(/[^\w\s]/g, '');
        if (!norm || norm.length < 2) continue;

        // Check if sentence is completed with terminal punctuation
        const isComplete = /[.!?…。！？]$/.test(sentence.trim());

        if (isComplete && !this.sessionTranslatedSentences.has(norm)) {
          this.sessionTranslatedSentences.add(norm);
          untranslated.push(sentence.trim());
        }
      }

      return untranslated;
    }

    _getTrailingUnpunctuatedClause(fullText) {
      const sentences = fullText.split(/(?<=[.!?…。！？])\s+/);
      const lastSegment = sentences[sentences.length - 1]?.trim();
      if (!lastSegment) return null;

      const norm = lastSegment.toLowerCase().replace(/[^\w\s]/g, '');
      if (norm.length >= 3 && !this.sessionTranslatedSentences.has(norm)) {
        this.sessionTranslatedSentences.add(norm);
        return lastSegment;
      }
      return null;
    }

    _flushNow(speaker, textToTranslate, originalText) {
      clearTimeout(this.debounceTimer);
      if (!textToTranslate || textToTranslate.trim().length < 2) return;

      this.lastFlushedFullText = this.currentText;
      this.flushCallback({
        speaker,
        text: textToTranslate.trim(),
        fullText: originalText.trim(),
        utteranceId: this.utteranceId,
        timestamp: Date.now(),
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUBTITLE OVERLAY (Shadow DOM Floating Bottom Card)
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

      this.shadow.getElementById('ml-spk').textContent   = speaker;
      this.shadow.getElementById('ml-trans').textContent = translatedText;

      const origEl    = this.shadow.getElementById('ml-orig');
      const dividerEl = this.shadow.getElementById('ml-divider');
      
      const hasOrig = this._settings.showOriginal && originalText;
      origEl.textContent      = originalText;
      origEl.style.display    = hasOrig ? 'block' : 'none';
      if (dividerEl) dividerEl.style.display = hasOrig ? 'block' : 'none';

      this.card.classList.remove('ml-hidden', 'ml-fade');
      this.card.classList.add('ml-visible');

      clearTimeout(this.fadeTimer);
      this.fadeTimer = setTimeout(() => this.hide(), FADE_AFTER_MS);
    }

    showError(msg) {
      if (!this.card) return;
      this.shadow.getElementById('ml-spk').textContent   = '⚠ MeetLingo';
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
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800&family=Inter:wght@500;600;700&display=swap');
        :host { all: initial; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        
        .ml-card {
          pointer-events: auto;
          background: #FFFFFF;
          border: 3px solid #0F172A;
          box-shadow: 6px 6px 0px #0F172A;
          color: #0F172A;
          padding: 16px 22px 18px;
          border-radius: 16px;
          max-width: 90vw;
          min-width: 280px;
          min-height: 100px;
          resize: both;
          overflow: auto;
          text-align: left;
          cursor: grab;
          user-select: none;
          transition: opacity 0.2s ease, transform 0.2s ease;
          position: relative;
        }
        
        .ml-card:active { cursor: grabbing; }
        .ml-hidden  { opacity: 0; transform: translateY(10px); pointer-events: none; display: none; }
        .ml-fade    { opacity: 0; transform: translateY(10px); }
        .ml-visible { opacity: 1; transform: translateY(0); display: block; }
        
        .ml-drag    { position: absolute; top: 12px; right: 14px; font-size: 12px; font-weight: 800; color: #0F172A; cursor: grab; padding: 2px 7px; border-radius: 6px; background: #FFDE00; border: 2px solid #0F172A; box-shadow: 2px 2px 0px #0F172A; }
        .ml-drag:hover { background: #FFE633; }
        
        .ml-header-row { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; }
        
        .ml-avatar-icon {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: #FFDE00;
          border: 2px solid #0F172A;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #0F172A;
          font-size: 11px;
          font-weight: 800;
          flex-shrink: 0;
          box-shadow: 2px 2px 0px #0F172A;
        }
        
        .ml-spk-info { display: flex; align-items: center; gap: 6px; }
        .ml-dot      { width: 8px; height: 8px; border-radius: 50%; background: #00E699; border: 1.5px solid #0F172A; }
        
        .ml-spk {
          font-family: 'Outfit', sans-serif;
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.04em;
          color: #0F172A;
          text-transform: uppercase;
        }
        
        .ml-trans {
          font-size: 17.5px;
          font-weight: 700;
          line-height: 1.45;
          color: #0F172A;
          letter-spacing: -0.01em;
        }
        
        .ml-divider {
          height: 2px;
          background: #0F172A;
          margin: 10px 0 8px;
        }
        
        .ml-orig {
          font-size: 12.5px;
          font-weight: 600;
          color: #475569;
          line-height: 1.4;
          font-style: normal;
        }
      `;
      this.shadow.appendChild(style);

      this.card = document.createElement('div');
      this.card.className = 'ml-card ml-hidden';
      this.card.innerHTML = `
        <span class="ml-drag" title="Drag overlay">⠿</span>
        <div class="ml-header-row">
          <div class="ml-avatar-icon">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 4-4H8a4 4 0 0 4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <div class="ml-spk-info">
            <span class="ml-spk" id="ml-spk">Speaker</span>
            <span class="ml-dot"></span>
          </div>
        </div>
        <div class="ml-trans" id="ml-trans"></div>
        <div class="ml-divider" id="ml-divider"></div>
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
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSCRIPT SIDEBAR (Collapsible Liquid Glass History Drawer)
  // ═══════════════════════════════════════════════════════════════════════════
  class TranscriptSidebar {
    constructor() {
      this.hostEl         = null;
      this.shadow         = null;
      this.drawer         = null;
      this.toggleBtn      = null;
      this.messagesList   = null;
      this.countBadge     = null;
      this.history        = [];
      this.isOpen         = false;
      this.userIsScrolling = false;
      this._init();
    }

    addEntry({ speaker, translatedText, originalText }) {
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      const entry = {
        id:             Date.now() + Math.random().toString(36).substr(2, 4),
        speaker:        speaker || 'Speaker',
        translatedText: translatedText || '',
        originalText:   originalText || '',
        timeStr,
      };

      this.history.push(entry);
      if (this.history.length > 500) this.history.shift(); // Cap memory

      this._renderMessage(entry);
      this._updateBadge();
    }

    destroy() {
      if (this.hostEl) this.hostEl.remove();
      this.hostEl = this.shadow = this.drawer = this.toggleBtn = null;
    }

    _init() {
      const old = document.getElementById('meetlingo-sidebar-root');
      if (old) old.remove();

      this.hostEl = document.createElement('div');
      this.hostEl.id = 'meetlingo-sidebar-root';
      Object.assign(this.hostEl.style, {
        position: 'fixed',
        top: '0',
        right: '0',
        bottom: '0',
        zIndex: '2147483646',
        pointerEvents: 'none',
      });
      document.body.appendChild(this.hostEl);

      this.shadow = this.hostEl.attachShadow({ mode: 'open' });

      const style = document.createElement('style');
      style.textContent = `
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
        :host { all: initial; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }

        /* Neobrutalism Floating Trigger Tab */
        .sidebar-toggle {
          position: fixed;
          top: 38%;
          right: 0;
          transform: translateY(-50%);
          pointer-events: auto;
          display: flex;
          align-items: center;
          gap: 8px;
          background: #FFDE00;
          border: 2.5px solid #0F172A;
          border-right: none;
          border-radius: 12px 0 0 12px;
          padding: 10px 14px;
          color: #0F172A;
          font-family: 'Outfit', sans-serif;
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.02em;
          cursor: pointer;
          transition: all 0.15s ease-out;
          box-shadow: -4px 4px 0px #0F172A;
        }

        .sidebar-toggle:hover {
          background: #FFE633;
          padding-left: 18px;
        }

        .toggle-icon { font-size: 15px; }
        
        .badge {
          background: #0F172A;
          color: #FFFFFF;
          font-size: 10.5px;
          font-weight: 900;
          padding: 1px 7px;
          border-radius: 99px;
        }

        /* Neobrutalism Drawer Panel */
        .drawer-panel {
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          width: 380px;
          max-width: 90vw;
          pointer-events: auto;
          background: #FFFDF6;
          border-left: 3px solid #0F172A;
          box-shadow: -10px 0px 0px rgba(15, 23, 42, 0.15);
          display: flex;
          flex-direction: column;
          transform: translateX(100%);
          transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .resize-handle-left {
          position: absolute;
          top: 0;
          left: -6px;
          bottom: 0;
          width: 12px;
          cursor: ew-resize;
          z-index: 10;
          background: transparent;
        }

        .resize-handle-left:hover {
          background: rgba(255, 222, 0, 0.5);
          border-left: 2px solid #0F172A;
        }

        .drawer-panel.open {
          transform: translateX(0);
        }

        /* Drawer Header */
        .drawer-header {
          padding: 18px 20px 14px;
          background: #FFDE00;
          border-bottom: 2.5px solid #0F172A;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .header-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .drawer-title-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .drawer-title {
          font-family: 'Outfit', sans-serif;
          font-size: 17px;
          font-weight: 800;
          color: #0F172A;
          letter-spacing: -0.02em;
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .action-btn {
          background: #FFFFFF;
          border: 2px solid #0F172A;
          border-radius: 8px;
          color: #0F172A;
          padding: 5px 10px;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
          box-shadow: 2px 2px 0px #0F172A;
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .action-btn:hover {
          transform: translate(-1px, -1px);
          box-shadow: 3px 3px 0px #0F172A;
        }

        .close-btn {
          background: #FFFFFF;
          border: 2px solid #0F172A;
          color: #0F172A;
          font-size: 16px;
          font-weight: 800;
          cursor: pointer;
          padding: 2px 7px;
          border-radius: 8px;
          box-shadow: 2px 2px 0px #0F172A;
          transition: all 0.15s ease;
        }

        .close-btn:hover { background: #FF477E; color: #FFFFFF; }

        .search-box {
          width: 100%;
          background: #FFFFFF;
          border: 2px solid #0F172A;
          border-radius: 10px;
          padding: 9px 12px;
          color: #0F172A;
          font-size: 13px;
          font-weight: 600;
          outline: none;
          box-shadow: 2px 2px 0px #0F172A;
        }

        .search-box::placeholder { color: #64748B; }

        /* Scrollable Message List */
        .messages-list {
          flex: 1;
          overflow-y: auto;
          padding: 16px 20px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .messages-list::-webkit-scrollbar { width: 6px; }
        .messages-list::-webkit-scrollbar-thumb { background: #0F172A; border-radius: 99px; }

        .empty-state {
          text-align: center;
          color: #64748B;
          font-size: 13px;
          font-weight: 600;
          margin: auto 0;
          padding: 40px 20px;
        }

        /* Message Card */
        .msg-card {
          background: #FFFFFF;
          border: 2.5px solid #0F172A;
          border-radius: 12px;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          box-shadow: 3px 3px 0px #0F172A;
          transition: all 0.15s ease;
        }

        .msg-card:hover {
          transform: translate(-1px, -1px);
          box-shadow: 4px 4px 0px #0F172A;
        }

        .msg-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .msg-speaker {
          font-family: 'Outfit', sans-serif;
          font-size: 12px;
          font-weight: 800;
          color: #0F172A;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          background: #FFDE00;
          padding: 1px 6px;
          border: 1.5px solid #0F172A;
          border-radius: 4px;
        }

        .msg-time {
          font-size: 11px;
          font-weight: 700;
          color: #64748B;
        }

        .msg-trans {
          font-size: 14px;
          font-weight: 700;
          color: #0F172A;
          line-height: 1.45;
        }

        .msg-orig {
          font-size: 12px;
          font-weight: 600;
          color: #475569;
          border-top: 2px solid #0F172A;
          padding-top: 6px;
          margin-top: 2px;
        }

        /* Drawer Footer */
        .drawer-footer {
          padding: 12px 20px;
          background: #FFFFFF;
          border-top: 2.5px solid #0F172A;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 11.5px;
          font-weight: 700;
          color: #0F172A;
        }

        .clear-btn {
          background: #FFFFFF;
          border: 1.5px solid #0F172A;
          color: #0F172A;
          font-size: 11px;
          font-weight: 800;
          cursor: pointer;
          padding: 3px 8px;
          border-radius: 6px;
          box-shadow: 2px 2px 0px #0F172A;
          transition: all 0.15s ease;
        }

        .clear-btn:hover { background: #FF477E; color: #FFFFFF; }
      `;
      this.shadow.appendChild(style);

      // 1. Build Toggle Button
      this.toggleBtn = document.createElement('button');
      this.toggleBtn.className = 'sidebar-toggle';
      this.toggleBtn.innerHTML = `
        <span>Transcript</span>
        <span class="badge" id="count-badge">0</span>
      `;
      this.toggleBtn.addEventListener('click', () => this.toggle());
      this.shadow.appendChild(this.toggleBtn);

      // 2. Build Sliding Drawer Panel with Left Resize Handle
      this.drawer = document.createElement('div');
      this.drawer.className = 'drawer-panel';
      this.drawer.innerHTML = `
        <div class="resize-handle-left" title="Drag to resize sidebar width"></div>
        <div class="drawer-header">
          <div class="header-top">
            <div class="drawer-title-group">
              <span class="drawer-title">Live Transcript</span>
            </div>
            <div class="header-actions">
              <button class="action-btn" id="btn-copy" title="Copy full transcript">Copy</button>
              <button class="close-btn" id="btn-close" title="Close">✕</button>
            </div>
          </div>
          <input type="text" class="search-box" id="search-input" placeholder="Search transcript history..." />
        </div>

        <div class="messages-list" id="messages-list">
          <div class="empty-state">No speech logged yet. Captions will appear here in real time.</div>
        </div>

        <div class="drawer-footer">
          <span id="total-count-label">0 Messages logged</span>
          <button class="clear-btn" id="btn-clear">Clear History</button>
        </div>
      `;
      this.shadow.appendChild(this.drawer);

      // DOM refs inside Shadow DOM
      this.messagesList = this.shadow.getElementById('messages-list');
      this.countBadge   = this.shadow.getElementById('count-badge');

      // Attach Event Listeners
      this.shadow.getElementById('btn-close').addEventListener('click', () => this.close());
      this.shadow.getElementById('btn-clear').addEventListener('click', () => this.clearHistory());
      this.shadow.getElementById('btn-copy').addEventListener('click', () => this.copyTranscript());
      
      const searchInput = this.shadow.getElementById('search-input');
      searchInput.addEventListener('input', (e) => this._filterMessages(e.target.value));

      // Make sidebar width resizable via left handle
      this._makeResizable();

      // Track user scroll position (so auto-scroll stops when reading old messages)
      this.messagesList.addEventListener('scroll', () => {
        const { scrollTop, scrollHeight, clientHeight } = this.messagesList;
        this.userIsScrolling = (scrollHeight - scrollTop - clientHeight) > 40;
      });
    }

    toggle() {
      this.isOpen ? this.close() : this.open();
    }

    open() {
      this.isOpen = true;
      this.drawer.classList.add('open');
      this._scrollToBottom(true);
    }

    close() {
      this.isOpen = false;
      this.drawer.classList.remove('open');
    }

    clearHistory() {
      this.history = [];
      this.messagesList.innerHTML = `<div class="empty-state">Transcript cleared.</div>`;
      this._updateBadge();
    }

    copyTranscript() {
      if (this.history.length === 0) return;
      const text = this.history.map(m => `[${m.timeStr}] ${m.speaker}: ${m.translatedText} (${m.originalText})`).join('\n\n');
      navigator.clipboard.writeText(text).then(() => {
        const copyBtn = this.shadow.getElementById('btn-copy');
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => copyBtn.textContent = '📋 Copy', 2000);
      });
    }

    updateOrAddEntry({ utteranceId, speaker, translatedText, originalText }) {
      const existing = this.history.find(item => item.utteranceId === utteranceId);

      if (existing) {
        // Update existing entry in place
        if (translatedText) {
          if (existing.translatedText && !existing.translatedText.includes(translatedText)) {
            existing.translatedText += ' ' + translatedText;
          } else if (!existing.translatedText) {
            existing.translatedText = translatedText;
          }
        }
        if (originalText) existing.originalText = originalText;

        this._updateCardElement(existing);
      } else {
        // Create new entry
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        const entry = {
          utteranceId:   utteranceId || Date.now(),
          id:             Date.now() + Math.random().toString(36).substr(2, 4),
          speaker:        speaker || 'Speaker',
          translatedText: translatedText || '',
          originalText:   originalText || '',
          timeStr,
        };

        this.history.push(entry);
        if (this.history.length > 500) this.history.shift();

        this._renderMessage(entry);
        this._updateBadge();
      }
    }

    _updateCardElement(entry) {
      const card = this.messagesList.querySelector(`[data-utterance-id="${entry.utteranceId}"]`);
      if (!card) return;

      const transEl = card.querySelector('.msg-trans');
      const origEl  = card.querySelector('.msg-orig');

      if (transEl) transEl.textContent = entry.translatedText;
      if (origEl)  origEl.textContent  = entry.originalText;
      card.setAttribute('data-text', (entry.translatedText + ' ' + entry.originalText + ' ' + entry.speaker).toLowerCase());

      if (!this.userIsScrolling) {
        this._scrollToBottom();
      }
    }

    _renderMessage(entry) {
      const emptyState = this.messagesList.querySelector('.empty-state');
      if (emptyState) emptyState.remove();

      const card = document.createElement('div');
      card.className = 'msg-card';
      card.setAttribute('data-utterance-id', entry.utteranceId);
      card.setAttribute('data-text', (entry.translatedText + ' ' + entry.originalText + ' ' + entry.speaker).toLowerCase());
      card.innerHTML = `
        <div class="msg-meta">
          <span class="msg-speaker">${this._escape(entry.speaker)}</span>
          <span class="msg-time">${entry.timeStr}</span>
        </div>
        <div class="msg-trans">${this._escape(entry.translatedText)}</div>
        ${entry.originalText ? `<div class="msg-orig">${this._escape(entry.originalText)}</div>` : ''}
      `;
      this.messagesList.appendChild(card);

      if (!this.userIsScrolling) {
        this._scrollToBottom();
      }
    }

    _filterMessages(query) {
      const q = query.trim().toLowerCase();
      const cards = this.messagesList.querySelectorAll('.msg-card');
      cards.forEach(card => {
        const txt = card.getAttribute('data-text') || '';
        card.style.display = (!q || txt.includes(q)) ? 'flex' : 'none';
      });
    }

    _updateBadge() {
      const count = this.history.length;
      if (this.countBadge) this.countBadge.textContent = count;
      const lbl = this.shadow.getElementById('total-count-label');
      if (lbl) lbl.textContent = `${count} Message${count === 1 ? '' : 's'} logged`;
    }

    _makeResizable() {
      const handle = this.shadow.querySelector('.resize-handle-left');
      if (!handle) return;

      let startX, startWidth;

      const onMouseMove = (e) => {
        const deltaX = startX - e.clientX;
        const newWidth = Math.max(260, Math.min(window.innerWidth * 0.8, startWidth + deltaX));
        this.drawer.style.width = newWidth + 'px';
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        this.drawer.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
      };

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startX = e.clientX;
        startWidth = this.drawer.getBoundingClientRect().width;
        this.drawer.style.transition = 'none'; // Instant response while dragging
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    }

    _scrollToBottom(force = false) {
      if (force || !this.userIsScrolling) {
        this.messagesList.scrollTop = this.messagesList.scrollHeight;
      }
    }

    _escape(str) {
      return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN ORCHESTRATOR
  // ═══════════════════════════════════════════════════════════════════════════
  let observer = null;
  let buffer   = null;
  let overlay  = null;
  let sidebar  = null;
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

    sidebar = new TranscriptSidebar();

    buffer = new SpeechTextBuffer(async (payload) => {
      const { speaker, text, fullText, utteranceId } = payload;
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

        const originalText = settings.showOriginal ? (fullText || text) : '';

        // 1. Show immediate floating bottom subtitle card
        overlay.show({
          speaker,
          translatedText: result.translatedText,
          originalText,
        });

        // 2. Append or update in-place in real-time Live Transcript Sidebar
        if (sidebar) {
          sidebar.updateOrAddEntry({
            utteranceId,
            speaker,
            translatedText: result.translatedText,
            originalText,
          });
        }
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
    if (sidebar)  { sidebar.destroy(); sidebar = null; }
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
