/**
 * content.js
 * Main entry point injected into every Google Meet page.
 * Wires together: CaptionObserver → SpeechTextBuffer → translation → SubtitleOverlay.
 */

import { CaptionObserver } from './caption-observer.js';
import { SpeechTextBuffer } from './text-buffer.js';
import { SubtitleOverlay  } from './overlay-ui.js';
import { ACTIONS }          from '../utils/constants.js';

// ─── Module-level state ───────────────────────────────────────────────────────
let observer  = null;
let buffer    = null;
let overlay   = null;
let settings  = null;
let running   = false;

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap() {
  // Fetch current settings from background
  const response = await chrome.runtime.sendMessage({ action: ACTIONS.GET_SETTINGS });
  if (!response?.success) return;

  settings = response.settings;

  if (!settings.enabled) {
    console.debug('[MeetLingo] Extension disabled via settings.');
    return;
  }

  startPipeline();
}

function startPipeline() {
  if (running) return;
  running = true;

  // 1. Overlay
  overlay = new SubtitleOverlay();
  overlay.applySettings(settings);

  // 2. Buffer → Translation → Display
  buffer = new SpeechTextBuffer(async (payload) => {
    const { speaker, text, fullText } = payload;

    const result = await chrome.runtime.sendMessage({
      action:     ACTIONS.TRANSLATE,
      text,
      targetLang: settings.targetLang,
      sourceLang: settings.sourceLang === 'AUTO' ? null : settings.sourceLang,
    });

    if (!result) return;

    if (result.skipped) return; // Extension disabled mid-session

    if (!result.success) {
      overlay.showError(result.error || 'Translation failed.');
      return;
    }

    overlay.show({
      speaker,
      translatedText: result.translatedText,
      originalText:   settings.showOriginal ? (fullText || text) : '',
    });
  });

  // 3. Observer → Buffer
  observer = new CaptionObserver((chunk) => {
    buffer.push(chunk);
  });

  observer.start();

  console.debug('[MeetLingo] Pipeline started.');
}

function stopPipeline() {
  if (!running) return;
  running = false;

  if (observer) { observer.stop();   observer = null; }
  if (buffer)   { buffer.forceFlush(); buffer.reset(); buffer = null; }
  if (overlay)  { overlay.hide();    }

  console.debug('[MeetLingo] Pipeline stopped.');
}

// ─── Settings Updates from Background / Popup ─────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.action !== ACTIONS.SETTINGS_UPDATED) return;

  const updated = message.settings;
  const wasEnabled = settings?.enabled;

  settings = { ...(settings || {}), ...updated };

  if (updated.enabled === false && wasEnabled) {
    stopPipeline();
    return;
  }

  if (updated.enabled === true && !wasEnabled) {
    startPipeline();
    return;
  }

  // Apply non-lifecycle changes to the overlay if it exists
  if (overlay && running) {
    overlay.applySettings(settings);
  }
});

// ─── Page Lifecycle Hooks ─────────────────────────────────────────────────────

// Re-attach observer if tab returns from background (e.g. alt-tab back)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && running && observer) {
    observer._locateAndAttach();
  }
});

// Clean up if the page is navigating away
window.addEventListener('beforeunload', () => {
  stopPipeline();
  if (overlay) overlay.destroy();
});

// ─── Start ────────────────────────────────────────────────────────────────────
bootstrap();
