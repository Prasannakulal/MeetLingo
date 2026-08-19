/**
 * background.js – Service Worker
 * Central message hub for MeetLingo.
 * Handles: translation requests, settings reads/writes, session stats.
 */

import { TranslationService }             from './translation-service.js';
import { ACTIONS, DEFAULT_SETTINGS }      from '../utils/constants.js';
import {
  getSettings, saveSettings,
  getSession, patchSession, addCharsTranslated, recordCacheHit, resetSession,
} from '../utils/storage.js';

// ─── Singleton service instance (persists for lifetime of service worker) ─────
let translationService = null;
let currentSettings    = { ...DEFAULT_SETTINGS };

// ─── Initialise on Service Worker boot ───────────────────────────────────────
async function init() {
  currentSettings = await getSettings();
  translationService = new TranslationService({
    apiKey:   currentSettings.apiKey,
    provider: currentSettings.provider,
  });

  // Initialise session start time if not already set
  const session = await getSession();
  if (!session.sessionStart) {
    await patchSession({ sessionStart: Date.now() });
  }

  console.debug('[MeetLingo BG] Service worker initialised. Provider:', currentSettings.provider);
}

init();

// ─── Message Router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => {
      console.error('[MeetLingo BG] Error handling message:', err);
      sendResponse({ success: false, error: err.message });
    });

  // Return true to keep the message channel open for async response
  return true;
});

async function handleMessage(message, sender) {
  const { action } = message;

  switch (action) {
    // ── Translation Request ────────────────────────────────────────────────────
    case ACTIONS.TRANSLATE: {
      const { text, targetLang, sourceLang } = message;

      if (!currentSettings.enabled) {
        return { success: true, skipped: true, reason: 'extension_disabled' };
      }

      if (!currentSettings.apiKey) {
        return { success: false, error: 'No API key configured. Please open MeetLingo settings.' };
      }

      // Daily character limit safeguard
      if (currentSettings.dailyCharLimit > 0) {
        const session = await getSession();
        if (session.charsTranslated >= currentSettings.dailyCharLimit) {
          return {
            success: false,
            error: `Daily character limit (${currentSettings.dailyCharLimit.toLocaleString()}) reached.`,
          };
        }
      }

      const result = await translationService.translate(
        text,
        targetLang  || currentSettings.targetLang,
        sourceLang  === 'AUTO' ? null : (sourceLang || null),
      );

      if (result.fromCache) {
        await recordCacheHit();
      } else {
        await addCharsTranslated(text.length);
      }

      return {
        success:            true,
        translatedText:     result.translatedText,
        detectedSourceLang: result.detectedSourceLang,
        fromCache:          result.fromCache,
      };
    }

    // ── Get Settings ───────────────────────────────────────────────────────────
    case ACTIONS.GET_SETTINGS: {
      const settings = await getSettings();
      return { success: true, settings };
    }

    // ── Save Settings ──────────────────────────────────────────────────────────
    case ACTIONS.SAVE_SETTINGS: {
      const { settings } = message;
      await saveSettings(settings);
      currentSettings = { ...currentSettings, ...settings };

      // Propagate new API key / provider to the service instance
      translationService.configure({
        apiKey:   currentSettings.apiKey,
        provider: currentSettings.provider,
      });

      // Broadcast settings change to all Meet and Teams tabs
      const meetTabs  = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
      const teamsTabs = await chrome.tabs.query({ url: 'https://teams.microsoft.com/*' });
      for (const tab of [...meetTabs, ...teamsTabs]) {
        chrome.tabs.sendMessage(tab.id, {
          action:   ACTIONS.SETTINGS_UPDATED,
          settings: currentSettings,
        }).catch(() => {}); // Ignore if content script not ready
      }

      return { success: true };
    }

    // ── Get Session Stats ──────────────────────────────────────────────────────
    case ACTIONS.GET_STATS: {
      const session    = await getSession();
      const cacheStats = translationService.cacheStats();
      return { success: true, session, cacheStats };
    }

    // ── Reset Session Stats ────────────────────────────────────────────────────
    case ACTIONS.RESET_STATS: {
      await resetSession();
      translationService.configure({}); // No-op; just keep cache alive
      return { success: true };
    }

    // ── Toggle Overlay (enabled/disabled) ─────────────────────────────────────
    case ACTIONS.TOGGLE_OVERLAY: {
      currentSettings.enabled = message.enabled;
      await saveSettings({ enabled: message.enabled });

      const meetTabs  = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
      const teamsTabs = await chrome.tabs.query({ url: 'https://teams.microsoft.com/*' });
      for (const tab of [...meetTabs, ...teamsTabs]) {
        chrome.tabs.sendMessage(tab.id, {
          action:  ACTIONS.SETTINGS_UPDATED,
          settings: { enabled: message.enabled },
        }).catch(() => {});
      }
      return { success: true };
    }

    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}

// ─── Service Worker Lifecycle – re-initialise on wake ────────────────────────
self.addEventListener('activate', () => {
  if (!translationService) init();
});
