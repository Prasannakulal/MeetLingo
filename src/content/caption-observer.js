/**
 * caption-observer.js
 * Attaches a MutationObserver to Google Meet's live caption container.
 * Uses a 3-tier selector cascade for resilience against Meet UI updates.
 */

import { CAPTION_SELECTORS, BUFFER_CONFIG } from '../utils/constants.js';

export class CaptionObserver {
  /**
   * @param {(payload: {speaker: string, text: string, timestamp: number}) => void} onChunk
   */
  constructor(onChunk) {
    this.onChunk         = onChunk;
    this.observer        = null;
    this.activeContainer = null;
    this.pollTimer       = null;
    this.manualBindMode  = false;
    this._onManualClick  = this._onManualClick.bind(this);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  start() {
    this._locateAndAttach();
    this._startPolling();
  }

  stop() {
    if (this.observer)  { this.observer.disconnect(); this.observer = null; }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    this._exitManualBindMode();
    this.activeContainer = null;
  }

  // ─── Container Detection ─────────────────────────────────────────────────────

  _locateAndAttach() {
    const container = this._findContainer();

    if (!container) {
      // Fallback: try to click the caption enable button first
      this._tryEnableCaptions();
      return;
    }

    if (container === this.activeContainer) return; // Already attached

    this.activeContainer = container;

    if (this.observer) this.observer.disconnect();

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        this._handleMutation(mutation);
      }
    });

    this.observer.observe(container, {
      childList:     true,
      subtree:       true,
      characterData: true,
    });

    console.debug('[MeetLingo] CaptionObserver attached to:', container);
  }

  /** Try each tier of selectors in order, return first match. */
  _findContainer() {
    for (const selector of CAPTION_SELECTORS.CONTAINER) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  /** Attempt to programmatically enable Meet closed captions. */
  _tryEnableCaptions() {
    for (const sel of CAPTION_SELECTORS.CAPTION_BUTTON) {
      const btn = document.querySelector(sel);
      if (btn) {
        const pressed = btn.getAttribute('aria-pressed');
        if (pressed !== 'true') {
          btn.click();
          console.debug('[MeetLingo] Auto-enabled captions via:', sel);
        }
        return;
      }
    }
    // Last resort: enter manual bind mode
    if (!this.manualBindMode) this._enterManualBindMode();
  }

  // ─── Manual Bind Mode ────────────────────────────────────────────────────────

  _enterManualBindMode() {
    this.manualBindMode = true;
    console.warn('[MeetLingo] Could not auto-detect caption container. Click the caption area to bind.');
    document.addEventListener('click', this._onManualClick, { capture: true });
  }

  _exitManualBindMode() {
    this.manualBindMode = false;
    document.removeEventListener('click', this._onManualClick, { capture: true });
  }

  _onManualClick(event) {
    // Walk up from click target, look for an aria-live or large text node
    let el = event.target;
    while (el && el !== document.body) {
      if (el.getAttribute('aria-live') === 'polite' || el.getAttribute('role') === 'region') {
        this.activeContainer = el;
        this._locateAndAttach();
        this._exitManualBindMode();
        console.debug('[MeetLingo] Manual bind to:', el);
        return;
      }
      el = el.parentElement;
    }
  }

  // ─── Polling ─────────────────────────────────────────────────────────────────

  _startPolling() {
    this.pollTimer = setInterval(() => {
      // Re-attach if Meet unmounts the caption container (e.g. after a reconnect)
      if (!this.activeContainer || !document.body.contains(this.activeContainer)) {
        this.activeContainer = null;
        this._locateAndAttach();
      }
    }, BUFFER_CONFIG.POLL_INTERVAL_MS);
  }

  // ─── Mutation Handling ───────────────────────────────────────────────────────

  _handleMutation(mutation) {
    // Process text-node changes directly
    if (mutation.type === 'characterData') {
      this._extractAndDispatch(mutation.target.parentElement);
      return;
    }

    // For childList, process added nodes
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      for (const node of mutation.addedNodes) {
        const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        if (el) this._extractAndDispatch(el);
      }
    }
  }

  /**
   * Walk up the DOM from the mutated node to find the nearest "speech block"
   * that contains both a speaker label and the full current transcript text.
   */
  _extractAndDispatch(startNode) {
    if (!startNode) return;

    // Walk up to find the block that contains a speaker name
    let block = startNode;
    let speakerName = null;
    let depth = 0;

    while (block && block !== this.activeContainer && depth < 8) {
      speakerName = this._extractSpeaker(block);
      if (speakerName) break;
      block  = block.parentElement;
      depth++;
    }

    // Fall back to whole container if we couldn't find a specific block
    if (!block || block === this.activeContainer) {
      block = this.activeContainer;
    }

    const text = (block?.innerText || block?.textContent || '').trim();
    if (!text || text.length < 2) return;

    this.onChunk({
      speaker:   speakerName || 'Speaker',
      text,
      timestamp: Date.now(),
    });
  }

  /** Try all speaker selectors within a given element. */
  _extractSpeaker(el) {
    for (const sel of CAPTION_SELECTORS.SPEAKER) {
      const found = el.querySelector?.(sel);
      if (found) {
        return (
          found.getAttribute('data-sender-name') ||
          found.getAttribute('alt')              ||
          found.textContent.trim()               ||
          null
        );
      }
    }
    // Check self
    const selfName = el.getAttribute?.('data-sender-name');
    if (selfName) return selfName;
    return null;
  }
}
