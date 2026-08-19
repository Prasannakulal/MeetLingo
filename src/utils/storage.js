/**
 * storage.js
 * Typed wrappers around chrome.storage.sync (settings) and
 * chrome.storage.local (ephemeral session data).
 */

import { DEFAULT_SETTINGS } from './constants.js';

// ─── Settings (sync – follows user across devices) ────────────────────────────

/**
 * Retrieve all extension settings, merged with defaults for any missing keys.
 * @returns {Promise<typeof DEFAULT_SETTINGS>}
 */
export async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      resolve(items);
    });
  });
}

/**
 * Persist a partial settings object.  Only provided keys are overwritten.
 * @param {Partial<typeof DEFAULT_SETTINGS>} partial
 * @returns {Promise<void>}
 */
export async function saveSettings(partial) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(partial, resolve);
  });
}

/**
 * Convenience: retrieve a single settings key.
 * @param {string} key
 * @returns {Promise<any>}
 */
export async function getSetting(key) {
  const settings = await getSettings();
  return settings[key];
}

// ─── Session / Local State ────────────────────────────────────────────────────

const SESSION_KEY = 'meetlingo_session';

const DEFAULT_SESSION = {
  charsTranslated: 0,
  requestCount:    0,
  cacheHits:       0,
  sessionStart:    null,
};

/**
 * Read ephemeral session statistics.
 * @returns {Promise<typeof DEFAULT_SESSION>}
 */
export async function getSession() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [SESSION_KEY]: DEFAULT_SESSION }, (items) => {
      resolve(items[SESSION_KEY]);
    });
  });
}

/**
 * Update session statistics with a partial patch.
 * @param {Partial<typeof DEFAULT_SESSION>} patch
 */
export async function patchSession(patch) {
  const current = await getSession();
  const updated  = { ...current, ...patch };
  return new Promise((resolve) => {
    chrome.storage.local.set({ [SESSION_KEY]: updated }, resolve);
  });
}

/**
 * Increment session character counter.
 * @param {number} count
 */
export async function addCharsTranslated(count) {
  const session = await getSession();
  await patchSession({
    charsTranslated: (session.charsTranslated || 0) + count,
    requestCount:    (session.requestCount    || 0) + 1,
    sessionStart:    session.sessionStart || Date.now(),
  });
}

/**
 * Record a cache hit (avoids API call, no chars charged).
 */
export async function recordCacheHit() {
  const session = await getSession();
  await patchSession({ cacheHits: (session.cacheHits || 0) + 1 });
}

/**
 * Reset session statistics (called from popup).
 */
export async function resetSession() {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [SESSION_KEY]: DEFAULT_SESSION }, resolve);
  });
}

// ─── Overlay Position (local – device-specific) ──────────────────────────────

/**
 * Persist the overlay card's last position so it survives page navigations.
 * @param {{ top: string, left: string }} pos
 */
export async function saveOverlayPosition(pos) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ meetlingo_overlay_pos: pos }, resolve);
  });
}

/**
 * Retrieve the last saved overlay position.
 * @returns {Promise<{ top: string, left: string } | null>}
 */
export async function getOverlayPosition() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ meetlingo_overlay_pos: null }, (items) => {
      resolve(items.meetlingo_overlay_pos);
    });
  });
}
