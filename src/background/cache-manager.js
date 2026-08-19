/**
 * cache-manager.js
 * Standalone LRU (Least Recently Used) cache for translation results.
 * Keeps the translation-service.js clean and this module independently testable.
 */

export class LRUCache {
  /**
   * @param {number} maxSize  Maximum number of entries before eviction
   */
  constructor(maxSize = 500) {
    this.maxSize  = maxSize;
    this.cache    = new Map(); // Map preserves insertion order
    this.hits     = 0;
    this.misses   = 0;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Retrieve a cached value.  Accessing it promotes it to "most recently used".
   * @param {string} key
   * @returns {string | undefined}
   */
  get(key) {
    if (!this.cache.has(key)) {
      this.misses++;
      return undefined;
    }
    // Promote to most-recently-used by deleting and re-inserting
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    this.hits++;
    return value;
  }

  /**
   * Store a key-value pair, evicting the oldest entry if over capacity.
   * @param {string} key
   * @param {string} value
   */
  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key); // Re-insert to update position
    } else if (this.cache.size >= this.maxSize) {
      // Evict LRU: first key in insertion order
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, value);
  }

  /**
   * Check if key exists without affecting LRU order.
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * Remove a specific entry.
   * @param {string} key
   */
  delete(key) {
    this.cache.delete(key);
  }

  /** Clear all entries and reset stats. */
  clear() {
    this.cache.clear();
    this.hits   = 0;
    this.misses = 0;
  }

  /**
   * Return cache statistics.
   * @returns {{ size: number, maxSize: number, hits: number, misses: number, hitRate: string }}
   */
  stats() {
    const total   = this.hits + this.misses;
    const hitRate = total > 0 ? ((this.hits / total) * 100).toFixed(1) + '%' : '0%';
    return {
      size:     this.cache.size,
      maxSize:  this.maxSize,
      hits:     this.hits,
      misses:   this.misses,
      hitRate,
    };
  }
}
