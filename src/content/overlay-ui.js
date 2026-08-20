/**
 * overlay-ui.js
 * Isolated Shadow DOM subtitle overlay injected directly into the Google Meet page.
 * Features: glassmorphism card, speaker badge, drag-and-drop, auto-fade, smooth animations.
 */

import { BUFFER_CONFIG }              from '../utils/constants.js';
import { saveOverlayPosition, getOverlayPosition } from '../utils/storage.js';

// Speaker name → accent colour mapping (stable per session)
const SPEAKER_COLORS = [
  '#38BDF8', // sky-400
  '#A78BFA', // violet-400
  '#34D399', // emerald-400
  '#FB923C', // orange-400
  '#F472B6', // pink-400
  '#FACC15', // yellow-400
  '#60A5FA', // blue-400
  '#4ADE80', // green-400
];

export class SubtitleOverlay {
  constructor() {
    this.hostEl      = null;
    this.shadow      = null;
    this.card        = null;
    this.fadeTimer   = null;
    this.speakerMap  = new Map(); // name → colour index

    this._settings   = {
      showOriginal:   true,
      overlayOpacity: 0.88,
      fontSize:       17,
    };

    this._init();
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Display a translated subtitle.
   * @param {{ speaker: string, translatedText: string, originalText: string }} opts
   */
  show({ speaker, translatedText, originalText }) {
    const color = this._speakerColor(speaker);

    this.shadow.getElementById('spk').textContent   = speaker;
    this.shadow.getElementById('spk').style.color   = color;
    this.shadow.getElementById('trans').textContent  = translatedText;
    this.shadow.getElementById('orig').textContent   = originalText;
    this.shadow.getElementById('orig').style.display =
      this._settings.showOriginal ? 'block' : 'none';

    this.card.classList.remove('hidden', 'fade-out');
    this.card.classList.add('visible');

    clearTimeout(this.fadeTimer);
    this.fadeTimer = setTimeout(() => this.hide(), BUFFER_CONFIG.FADE_AFTER_MS);
  }

  /** Show an error message briefly. */
  showError(message) {
    this.shadow.getElementById('spk').textContent  = '⚠ MeetLingo';
    this.shadow.getElementById('spk').style.color  = '#F87171';
    this.shadow.getElementById('trans').textContent = message;
    this.shadow.getElementById('orig').textContent  = '';

    this.card.classList.remove('hidden', 'fade-out');
    this.card.classList.add('visible');

    clearTimeout(this.fadeTimer);
    this.fadeTimer = setTimeout(() => this.hide(), 5000);
  }

  hide() {
    this.card.classList.add('fade-out');
    setTimeout(() => {
      this.card.classList.remove('visible', 'fade-out');
      this.card.classList.add('hidden');
    }, 300);
  }

  /** Apply settings changes from popup without re-creating the DOM. */
  applySettings(settings) {
    Object.assign(this._settings, settings);
    if (settings.overlayOpacity !== undefined) {
      this.card.style.setProperty('--bg-opacity', settings.overlayOpacity);
    }
    if (settings.fontSize !== undefined) {
      this.card.style.setProperty('--font-size', settings.fontSize + 'px');
    }
  }

  /** Remove the overlay from the page entirely. */
  destroy() {
    clearTimeout(this.fadeTimer);
    if (this.hostEl) this.hostEl.remove();
  }

  // ─── Private: DOM Initialisation ─────────────────────────────────────────────

  async _init() {
    // Restore previous position
    const savedPos = await getOverlayPosition().catch(() => null);

    this.hostEl = document.createElement('div');
    this.hostEl.id = 'meetlingo-root';
    Object.assign(this.hostEl.style, {
      position:     'fixed',
      bottom:       savedPos ? '' : '84px',
      top:          savedPos?.top  || '',
      left:         savedPos?.left || '50%',
      transform:    savedPos ? 'none' : 'translateX(-50%)',
      zIndex:       '2147483647',
      pointerEvents:'none',
      display:      'block',
    });
    document.body.appendChild(this.hostEl);

    this.shadow = this.hostEl.attachShadow({ mode: 'open' });
    this.shadow.appendChild(this._buildStyle());

    this.card = this._buildCard();
    this.shadow.appendChild(this.card);

    this._makeDraggable(this.card);
  }

  _buildStyle() {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .card {
        --bg-opacity: 0.88;
        --font-size: 17px;
        --accent: #38BDF8;

        pointer-events: auto;
        background: rgba(10, 14, 30, var(--bg-opacity));
        backdrop-filter: blur(16px) saturate(180%);
        -webkit-backdrop-filter: blur(16px) saturate(180%);
        border: 1px solid rgba(255, 255, 255, 0.10);
        box-shadow:
          0 0 0 1px rgba(255,255,255,0.04) inset,
          0 8px 40px rgba(0, 0, 0, 0.55),
          0 0 80px rgba(56, 189, 248, 0.05);
        color: #F1F5F9;
        padding: 14px 22px 16px;
        border-radius: 16px;
        max-width: 700px;
        min-width: 300px;
        text-align: center;
        cursor: grab;
        user-select: none;
        transition: opacity 0.3s ease, transform 0.3s ease;
      }

      .card:active { cursor: grabbing; }

      .card.hidden {
        opacity: 0;
        transform: translateY(6px);
        pointer-events: none;
      }

      .card.fade-out {
        opacity: 0;
        transform: translateY(6px);
      }

      .card.visible {
        opacity: 1;
        transform: translateY(0px);
      }

      .speaker-tag {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        color: var(--accent);
        margin-bottom: 6px;
        opacity: 0.9;
      }

      .speaker-dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: currentColor;
        animation: pulse 1.8s ease-in-out infinite;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50%       { opacity: 0.4; transform: scale(0.6); }
      }

      .translated-line {
        font-size: var(--font-size);
        font-weight: 600;
        line-height: 1.45;
        color: #F8FAFC;
        letter-spacing: -0.01em;
      }

      .original-line {
        font-size: 11.5px;
        color: #64748B;
        margin-top: 5px;
        font-style: italic;
        line-height: 1.4;
      }

      .drag-handle {
        position: absolute;
        top: 6px;
        right: 10px;
        font-size: 12px;
        color: rgba(255,255,255,0.2);
        cursor: grab;
        line-height: 1;
      }

      .drag-handle:hover { color: rgba(255,255,255,0.5); }
    `;
    return style;
  }

  _buildCard() {
    const card = document.createElement('div');
    card.className = 'card hidden';
    card.innerHTML = `
      <span class="drag-handle" title="Drag to move">⠿</span>
      <div class="speaker-tag">
        <span class="speaker-dot"></span>
        <span id="spk"></span>
      </div>
      <div class="translated-line" id="trans"></div>
      <div class="original-line"   id="orig"></div>
    `;
    return card;
  }

  // ─── Drag & Drop ─────────────────────────────────────────────────────────────

  _makeDraggable(card) {
    let startX, startY, origLeft, origTop;

    card.addEventListener('mousedown', (e) => {
      // Allow text selection on translated line
      if (e.target.id === 'trans' || e.target.id === 'orig') return;

      e.preventDefault();
      startX   = e.clientX;
      startY   = e.clientY;

      const rect = this.hostEl.getBoundingClientRect();
      origLeft = rect.left;
      origTop  = rect.top;

      // Switch to absolute positioning on first drag
      this.hostEl.style.bottom    = '';
      this.hostEl.style.transform = 'none';

      const onMove = (eMove) => {
        const dx = eMove.clientX - startX;
        const dy = eMove.clientY - startY;

        const newLeft = Math.max(0, Math.min(window.innerWidth  - rect.width,  origLeft + dx));
        const newTop  = Math.max(0, Math.min(window.innerHeight - rect.height, origTop  + dy));

        this.hostEl.style.left = newLeft + 'px';
        this.hostEl.style.top  = newTop  + 'px';
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);

        // Persist new position
        saveOverlayPosition({
          top:  this.hostEl.style.top,
          left: this.hostEl.style.left,
        }).catch(() => {});
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  _speakerColor(name) {
    if (!this.speakerMap.has(name)) {
      const idx = this.speakerMap.size % SPEAKER_COLORS.length;
      this.speakerMap.set(name, SPEAKER_COLORS[idx]);
    }
    return this.speakerMap.get(name);
  }
}
