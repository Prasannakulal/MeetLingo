# Comprehensive Architecture & Development Plan: Real-Time Translation Chrome Extension for Google Meet

---

## 1. Executive Summary & System Overview

### 1.1 Objective
Build a lightweight, production-grade Google Chrome Extension (Manifest V3) that provides real-time, low-latency multilingual translation of spoken dialogue during Google Meet video calls.

### 1.2 Core Architectural Strategy
Rather than streaming raw tab audio to an external Automatic Speech Recognition (ASR) service—which introduces high network bandwidth overhead, CPU throttling, and substantial API costs—this architecture leverages **Google Meet's Native In-Browser Closed Captions (STT)** as the transcription engine. 

The extension uses a DOM-level `MutationObserver` pipeline coupled with an intelligent **Debounce & Sentence Boundary Buffer** to extract finalized speech tokens, dispatch them via a background service worker to high-speed Neural Machine Translation (NMT) backends (DeepL API / Google Cloud Translation / Local LLM endpoints), and render a customizable floating overlay onto the Meet viewport.

---

## 2. End-to-End System Architecture

### 2.1 Architectural Flow Diagram (ASCII)

```
+-----------------------------------------------------------------------------------+
|                              GOOGLE MEET CLIENT TAB                               |
|                                                                                   |
|  +--------------------+       WebRTC Audio Stream                                 |
|  | Native Meet Audio  | ----------------------------+                             |
|  +--------------------+                             |                             |
|                                                     v                             |
|  +-----------------------------------------------------------------------------+  |
|  | Meet Native Caption Engine (On-device / Cloud STT)                          |  |
|  +-----------------------------------------------------------------------------+  |
|                                                     |                             |
|                                                     v (Streams words to DOM)      |
|  +-----------------------------------------------------------------------------+  |
|  | Meet DOM: Caption Container Element (aria-live / jsname / dynamic classes)  |  |
|  +-----------------------------------------------------------------------------+  |
|                                                     |                             |
|                                                     v (DOM Node Mutations)        |
|  +-----------------------------------------------------------------------------+  |
|  | EXTENSION CONTENT SCRIPT (content.js)                                       |  |
|  |                                                                             |  |
|  |  +-----------------------------------------------------------------------+  |  |
|  |  | 1. MutationObserver Hook                                              |  |  |
|  |  |    - Tracks childList & characterData additions                       |  |  |
|  |  |    - Extracts speaker ID + incremental subtitle chunks                |  |  |
|  |  +-----------------------------------------------------------------------+  |  |
|  |                                      |                                      |  |
|  |                                      v                                      |  |
|  |  +-----------------------------------------------------------------------+  |  |
|  |  | 2. Dynamic Sentence Boundary & Debounce Buffer Engine                |  |  |
|  |  |    - Trailing debounce timer (400ms - 600ms)                          |  |  |
|  |  |    - Punctuation delimiter regex ([.!?\n] / CJK full-stops)          |  |  |
|  |  |    - Deduplication hash table                                         |  |  |
|  |  +-----------------------------------------------------------------------+  |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
                                          |
                                          | chrome.runtime.sendMessage()
                                          | (Message Passing Protocol)
                                          v
+-----------------------------------------------------------------------------------+
| EXTENSION BACKGROUND SERVICE WORKER (background.js)                               |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | 1. API Rate Limiting & Sliding-Window Request Queue                         |  |
|  +-----------------------------------------------------------------------------+  |
|                                         |                                         |
|                                         v                                         |
|  +-----------------------------------------------------------------------------+  |
|  | 2. Translation Gateway (REST / WebSocket / SSE)                             |  |
|  |    - DeepL API (v2/translate)                                               |  |
|  |    - Google Cloud Translation v3                                            |  |
|  |    - Self-hosted Ollama / Whisper-Translate fallback                        |  |
|  +-----------------------------------------------------------------------------+  |
|                                         |                                         |
|                                         v                                         |
|  +-----------------------------------------------------------------------------+  |
|  | 3. In-Memory Cache (LRU: Hash(SourceText + TargetLang) -> Translation)       |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
                                          |
                                          | Response Promise / Message Stream
                                          v
+-----------------------------------------------------------------------------------+
| CONTENT SCRIPT UI INJECTOR (overlay.js / shadow-dom)                              |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | Isolated Shadow DOM Container (#meet-translator-root)                       |  |
|  |  - High z-index floating HUD                                                |  |
|  |  - Drag-and-drop boundary clipping                                          |  |
|  |  - Dual-line display: [Speaker Badge] + [Translated Text] + [Original Text] |  |
|  |  - Auto-fade & FIFO history buffer (clears after X seconds)                 |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 3. Chrome Extension Architecture & Manifest V3 Configuration

### 3.1 Directory Structure
```
meet-translator-extension/
├── manifest.json                  # Manifest V3 configuration
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── src/
│   ├── background/
│   │   ├── background.js          # Service worker orchestrator
│   │   ├── translation-service.js # API adapter (DeepL, Google, LLM)
│   │   └── cache-manager.js       # LRU translation cache
│   ├── content/
│   │   ├── content.js             # Main entrypoint injected into Google Meet
│   │   ├── caption-observer.js    # MutationObserver logic
│   │   ├── text-buffer.js         # Sentence boundary & debouncing engine
│   │   ├── overlay-ui.js          # Shadow DOM subtitle renderer
│   │   └── styles.css             # Shadow DOM scoped styles
│   ├── popup/
│   │   ├── popup.html             # Control panel UI
│   │   ├── popup.js               # Settings handler
│   │   └── popup.css              # Control panel styling
│   └── utils/
│       ├── constants.js           # Selectors, language codes, action types
│       └── storage.js             # chrome.storage.sync/local wrappers
└── build/                         # Production bundled artifacts
```

### 3.2 `manifest.json` Specifications
```json
{
  "manifest_version": 3,
  "name": "MeetLingo - Real-Time Google Meet Translator",
  "version": "1.0.0",
  "description": "Real-time multilingual live translation overlay for Google Meet video calls.",
  "permissions": [
    "storage",
    "activeTab"
  ],
  "host_permissions": [
    "https://meet.google.com/*",
    "https://api-free.deepl.com/*",
    "https://api.deepl.com/*",
    "https://translation.googleapis.com/*"
  ],
  "background": {
    "service_worker": "src/background/background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://meet.google.com/*"],
      "js": ["src/content/content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "src/popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  }
}
```

---

## 4. Deep-Dive Component Engineering

### 4.1 DOM Scraping & MutationObserver Strategy
Google Meet dynamically updates its class names via obfuscation pipelines (e.g., `jsname`, `jSs7Fc`). To guarantee long-term stability across Google Meet UI rollouts, extraction targets deterministic structural cues and ARIA attributes rather than brittle CSS utility classes.

#### Stable Target Selectors:
1. **Caption Button Check / Auto-Enabler:**
   - Selector: `button[aria-label*="caption" i], button[jsname="r8qRAd"]`
2. **Main Caption Container Region:**
   - Selector: `div[aria-live="polite"][jsname="tgaKEf"], div[role="region"][aria-label*="caption" i]`
3. **Speaker Identity:**
   - Located in the ancestor block preceding the streaming transcript span.

```javascript
// src/content/caption-observer.js

export class CaptionObserver {
  constructor(onTextChunkReceived) {
    this.callback = onTextChunkReceived;
    this.observer = null;
    this.activeContainer = null;
  }

  start() {
    this.locateContainerAndAttach();
    this.pollForContainer();
  }

  locateContainerAndAttach() {
    // Search for the primary aria-live region used by Google Meet
    const container = document.querySelector('div[aria-live="polite"]') || 
                      document.querySelector('div[role="region"][aria-label*="captions" i]');

    if (container && container !== this.activeContainer) {
      this.activeContainer = container;
      if (this.observer) this.observer.disconnect();

      this.observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList' || mutation.type === 'characterData') {
            this.parseMutation(mutation.target);
          }
        }
      });

      this.observer.observe(container, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
  }

  parseMutation(targetNode) {
    const speechBlock = targetNode.closest('[jsname], [data-sender-name], div');
    if (!speechBlock) return;

    // Extract speaker identification
    const speakerElem = speechBlock.querySelector('[data-sender-name], img[alt]') || 
                        speechBlock.parentElement?.querySelector('[data-sender-name]');
    const speakerName = speakerElem?.getAttribute('data-sender-name') || 
                        speakerElem?.getAttribute('alt') || 
                        'Speaker';

    // Extract full text content within this active block
    const textContent = speechBlock.innerText || speechBlock.textContent || '';
    if (textContent.trim().length > 0) {
      this.callback({
        speaker: speakerName,
        text: textContent.trim(),
        timestamp: Date.now()
      });
    }
  }

  pollForContainer() {
    // Ensure attachment persists if Meet dynamically mounts/unmounts caption regions
    this.intervalId = setInterval(() => {
      if (!this.activeContainer || !document.body.contains(this.activeContainer)) {
        this.locateContainerAndAttach();
      }
    }, 2000);
  }

  disconnect() {
    if (this.observer) this.observer.disconnect();
    if (this.intervalId) clearInterval(this.intervalId);
  }
}
```

---

### 4.2 Intelligent Sentence Boundary & Debounce Engine

#### The Problem:
Meet emits partial transcripts on every word or phoneme change (e.g., `"Hello" -> "Hello everyone" -> "Hello everyone welcome to"`). Sending every delta to an NMT API results in:
1. Fragmented, unintelligible translations (NMT engines need semantic context).
2. Rate-limit exhaustion and extreme cost multiplication ($10–$50/call).

#### The Solution:
A dual-trigger buffer:
1. **Sentence Boundary Trigger:** If text ends with terminal punctuation (`.`, `!`, `?`, `。`, `！`, `？`), flush immediately.
2. **Debounce Fallback Trigger:** If the speaker pauses for ≥450ms without formal punctuation, flush the accrued delta buffer.

```javascript
// src/content/text-buffer.js

export class SpeechTextBuffer {
  constructor(flushCallback, debounceDelay = 450) {
    this.flushCallback = flushCallback;
    this.debounceDelay = debounceDelay;
    this.lastProcessedText = '';
    this.debounceTimer = null;
    this.terminalPunctuationRegex = /[.!?。！？
]$/;
  }

  push(payload) {
    const { speaker, text, timestamp } = payload;

    // If new text is identical or already fully processed, skip
    if (text === this.lastProcessedText) return;

    // Determine newly spoken delta if text is appended cumulatively
    let delta = text;
    if (text.startsWith(this.lastProcessedText)) {
      delta = text.slice(this.lastProcessedText.length).trim();
    }

    clearTimeout(this.debounceTimer);

    // Condition 1: Terminal Punctuation Detected -> Flush Immediately
    if (this.terminalPunctuationRegex.test(text)) {
      this.flush(speaker, text);
      return;
    }

    // Condition 2: Debounce Timer for continuous speech pauses
    this.debounceTimer = setTimeout(() => {
      this.flush(speaker, text);
    }, this.debounceDelay);
  }

  flush(speaker, fullText) {
    clearTimeout(this.debounceTimer);
    if (!fullText || fullText === this.lastProcessedText) return;

    const sentenceToTranslate = fullText;
    this.lastProcessedText = fullText;

    this.flushCallback({
      speaker,
      text: sentenceToTranslate,
      timestamp: Date.now()
    });
  }

  reset() {
    clearTimeout(this.debounceTimer);
    this.lastProcessedText = '';
  }
}
```

---

### 4.3 Background Service Worker & Translation Pipeline

```javascript
// src/background/translation-service.js

export class TranslationService {
  constructor(apiKey, provider = 'deepl') {
    this.apiKey = apiKey;
    this.provider = provider;
    this.cache = new Map(); // Simple LRU Cache
  }

  async translate(text, targetLang = 'ES', sourceLang = null) {
    const cacheKey = `${sourceLang || 'auto'}->${targetLang}:${text}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    let translatedText = '';

    if (this.provider === 'deepl') {
      translatedText = await this.translateViaDeepL(text, targetLang, sourceLang);
    } else if (this.provider === 'google') {
      translatedText = await this.translateViaGoogle(text, targetLang, sourceLang);
    }

    // Cache management (keep under 500 items)
    if (this.cache.size > 500) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(cacheKey, translatedText);

    return translatedText;
  }

  async translateViaDeepL(text, targetLang, sourceLang) {
    const endpoint = this.apiKey.endsWith(':fx') 
      ? 'https://api-free.deepl.com/v2/translate' 
      : 'https://api.deepl.com/v2/translate';

    const params = new URLSearchParams();
    params.append('auth_key', this.apiKey);
    params.append('text', text);
    params.append('target_lang', targetLang.toUpperCase());
    if (sourceLang) params.append('source_lang', sourceLang.toUpperCase());

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!res.ok) throw new Error(`DeepL API Error: ${res.status} ${res.statusText}`);
    const data = await res.json();
    return data.translations[0].text;
  }

  async translateViaGoogle(text, targetLang, sourceLang) {
    const url = `https://translation.googleapis.com/language/translate/v2?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text,
        target: targetLang.toLowerCase(),
        source: sourceLang ? sourceLang.toLowerCase() : undefined,
        format: 'text'
      })
    });

    if (!res.ok) throw new Error(`Google API Error: ${res.status} ${res.statusText}`);
    const data = await res.json();
    return data.data.translations[0].translatedText;
  }
}
```

---

### 4.4 Shadow DOM Subtitle Overlay System

Using a standard DOM insertion causes style collisions with Google Meet's internal CSS resets. Injecting into an **Isolated Shadow DOM** guarantees strict CSS isolation.

```javascript
// src/content/overlay-ui.js

export class SubtitleOverlay {
  constructor() {
    this.host = null;
    this.shadow = null;
    this.container = null;
    this.init();
  }

  init() {
    this.host = document.createElement('div');
    this.host.id = 'meet-translator-root';
    document.body.appendChild(this.host);

    this.shadow = this.host.attachShadow({ mode: 'open' });
    
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        position: fixed;
        bottom: 84px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        pointer-events: none;
      }
      .overlay-card {
        pointer-events: auto;
        background: rgba(15, 23, 42, 0.88);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
        color: #FFFFFF;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        padding: 12px 20px;
        border-radius: 12px;
        max-width: 680px;
        min-width: 320px;
        text-align: center;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        cursor: grab;
      }
      .overlay-card:active { cursor: grabbing; }
      .speaker-tag {
        display: inline-block;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #38BDF8;
        margin-bottom: 4px;
      }
      .translated-line {
        font-size: 17px;
        font-weight: 600;
        line-height: 1.4;
        color: #F8FAFC;
      }
      .original-line {
        font-size: 12px;
        color: #94A3B8;
        margin-top: 4px;
        font-style: italic;
      }
      .hide { display: none; }
    `;

    this.shadow.appendChild(style);

    this.container = document.createElement('div');
    this.container.className = 'overlay-card hide';
    this.container.innerHTML = `
      <div class="speaker-tag" id="spk"></div>
      <div class="translated-line" id="trans"></div>
      <div class="original-line" id="orig"></div>
    `;

    this.shadow.appendChild(this.container);
    this.makeDraggable(this.container);
  }

  display(speaker, translatedText, originalText) {
    const spkEl = this.shadow.getElementById('spk');
    const transEl = this.shadow.getElementById('trans');
    const origEl = this.shadow.getElementById('orig');

    spkEl.textContent = speaker;
    transEl.textContent = translatedText;
    origEl.textContent = originalText;

    this.container.classList.remove('hide');

    // Auto-clear after 8 seconds of silence
    clearTimeout(this.fadeTimer);
    this.fadeTimer = setTimeout(() => {
      this.container.classList.add('hide');
    }, 8000);
  }

  makeDraggable(elem) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    elem.onmousedown = (e) => {
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = () => {
        document.onmouseup = null;
        document.onmousemove = null;
      };
      document.onmousemove = (eMove) => {
        eMove.preventDefault();
        pos1 = pos3 - eMove.clientX;
        pos2 = pos4 - eMove.clientY;
        pos3 = eMove.clientX;
        pos4 = eMove.clientY;
        elem.style.position = 'fixed';
        elem.style.top = (elem.offsetTop - pos2) + 'px';
        elem.style.left = (elem.offsetLeft - pos1) + 'px';
        elem.style.transform = 'none';
      };
    };
  }
}
```

---

## 5. Development Roadmap & Milestones

| Phase | Milestone | Deliverables | Duration |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Scaffolding & Manifest Setup | Manifest V3 setup, Chrome storage abstraction, basic popup options UI for API keys & language selection | Days 1–3 |
| **Phase 2** | Robust DOM Scraping Engine | Caption container detection, resilient `MutationObserver` with fallback selectors, auto-enabler for Meet CC | Days 4–6 |
| **Phase 3** | Text Normalization & Debouncer | Sentence boundary detection, token deduplicator, sliding-window buffer to eliminate duplicate API calls | Days 7–9 |
| **Phase 4** | Translation Layer & Caching | Background worker API adapter for DeepL & Google Translate, LRU in-memory translation cache | Days 10–12 |
| **Phase 5** | Isolated Shadow DOM UI | Drag-and-drop floating subtitle card, typography scaling, high-contrast theming, auto-fade timers | Days 13–15 |
| **Phase 6** | E2E Testing & Edge Handling | Multi-speaker handling, reconnection recovery, token budget protection, Chrome Web Store packaging | Days 16–18 |

---

## 6. Edge Case Handling & Production Hardening

### 6.1 Speaker Turn Changes & Interleaving
When multiple participants speak in quick succession, Meet splits or merges caption nodes. The `SpeechTextBuffer` tracks speaker transitions: whenever the extracted speaker name changes, the current buffer is immediately finalized and dispatched before starting the new speaker's accumulator.

### 6.2 Meet Dynamic Class Renaming Resilience
Google frequently re-obfuscates frontend bundles. The selector module uses a **3-Tier Fallback Cascade**:
1. Semantic ARIA selectors: `[aria-live="polite"]`, `[role="region"]`.
2. Structural traversal: Searching for video layout sibling containers containing text nodes.
3. User manual-select picker: If automated detection fails, allows user to click the caption area once to bind the observer.

### 6.3 API Rate Limits & Cost Safeguards
- **In-Memory Cache:** Duplicate phrases (e.g., "Thank you", "Can you hear me?", "Yes") return instantly at $0 cost.
- **Char-Count Metering:** Display total characters translated per session in the extension popup to prevent accidental billing overruns.
