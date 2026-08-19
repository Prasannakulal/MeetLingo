/**
 * text-buffer.js
 * Intelligent sentence boundary detection and debounce buffer.
 * Prevents flooding the translation API with every partial word from Meet's
 * streaming caption engine.
 */

import { BUFFER_CONFIG } from '../utils/constants.js';

export class SpeechTextBuffer {
  /**
   * @param {(payload: {speaker: string, text: string, timestamp: number}) => void} flushCallback
   * @param {number} [debounceMs]
   */
  constructor(flushCallback, debounceMs = BUFFER_CONFIG.DEBOUNCE_MS) {
    this.flushCallback     = flushCallback;
    this.debounceMs        = debounceMs;
    this.debounceTimer     = null;
    this.lastFlushedText   = '';
    this.currentSpeaker    = null;
    this.currentText       = '';

    // Matches terminal punctuation for immediate flush
    // Covers: . ! ? … and CJK equivalents 。 ！ ？ 
    this.terminalRegex = /[.!?…。！？\n][\s"'»\]\)]*$/;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Push a new caption chunk from the observer.
   * @param {{ speaker: string, text: string, timestamp: number }} payload
   */
  push(payload) {
    const { speaker, text } = payload;

    if (!text || text.trim().length < 2) return;

    // Speaker change: flush whatever we have for the previous speaker immediately
    if (this.currentSpeaker && speaker !== this.currentSpeaker) {
      this._flushNow(this.currentSpeaker, this.currentText);
    }

    this.currentSpeaker = speaker;
    this.currentText    = text.trim();

    clearTimeout(this.debounceTimer);

    // If this text is already fully processed, skip
    if (this.currentText === this.lastFlushedText) return;

    // Condition 1: Terminal punctuation detected → flush immediately
    if (this.terminalRegex.test(this.currentText)) {
      this._flushNow(speaker, this.currentText);
      return;
    }

    // Condition 2: Debounce – flush after silence
    this.debounceTimer = setTimeout(() => {
      this._flushNow(this.currentSpeaker, this.currentText);
    }, this.debounceMs);
  }

  /**
   * Force a flush of whatever is in the buffer (e.g. on observer disconnect).
   */
  forceFlush() {
    if (this.currentText && this.currentText !== this.lastFlushedText) {
      this._flushNow(this.currentSpeaker || 'Speaker', this.currentText);
    }
  }

  /**
   * Reset buffer state entirely (e.g. when user disables the extension).
   */
  reset() {
    clearTimeout(this.debounceTimer);
    this.lastFlushedText = '';
    this.currentSpeaker  = null;
    this.currentText     = '';
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  _flushNow(speaker, fullText) {
    clearTimeout(this.debounceTimer);

    if (!fullText || fullText === this.lastFlushedText) return;

    // Extract the NEW delta if Meet keeps appending to the same running text
    let deltaText = fullText;
    if (this.lastFlushedText && fullText.startsWith(this.lastFlushedText)) {
      deltaText = fullText.slice(this.lastFlushedText.length).trim();
    }

    if (!deltaText || deltaText.length < 2) return;

    this.lastFlushedText = fullText;

    this.flushCallback({
      speaker,
      text:      deltaText,    // Only the NEW portion
      fullText,                // Full running transcript (for display as original)
      timestamp: Date.now(),
    });
  }
}
