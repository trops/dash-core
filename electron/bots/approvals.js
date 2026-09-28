/**
 * approvals.js
 *
 * Pending-approval registry for bot tool calls (PRD US-003). When a bot tries
 * a tool that isn't pre-approved, PermissionGate creates an approval here and
 * awaits its resolution. The registry is the shared queue that the Bot Activity
 * Manager renders (Slice 7) and the IPC layer drives (Slice 4): the UI lists
 * pending approvals and calls resolve()/deny() when the user decides.
 *
 * Portable (NFR-006): no Electron, no timers-that-leak. Uses a plain Map and
 * an injected clock/timer only where needed. An unanswered approval auto-denies
 * after `timeoutMs` (default 24h, US-003 edge case) so a run can't hang forever.
 */
"use strict";

const DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h

let _counter = 0;

function _newId() {
  _counter += 1;
  return `appr_${Date.now().toString(36)}_${_counter}`;
}

class ApprovalRegistry {
  /**
   * @param {{ timeoutMs?: number,
   *           setTimer?: (fn: () => void, ms: number) => any,
   *           clearTimer?: (h: any) => void }} [opts]
   *   setTimer/clearTimer are injectable so tests can drive timeouts
   *   deterministically; they default to setTimeout/clearTimeout.
   */
  constructor(opts = {}) {
    this._defaultTimeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
    this._setTimer = opts.setTimer || ((fn, ms) => setTimeout(fn, ms));
    this._clearTimer = opts.clearTimer || ((h) => clearTimeout(h));
    /** @type {Map<string, any>} */
    this._pending = new Map();
  }

  /**
   * Create a pending approval. Returns its id and a promise that settles when
   * resolved/denied/timed-out.
   * @param {object} request  { botId, workspaceId?, toolName, input, serverName?, reason? }
   * @param {{ timeoutMs?: number }} [opts]
   * @returns {{ id: string, promise: Promise<{allow: boolean, reason?: string}> }}
   */
  create(request, opts = {}) {
    const id = _newId();
    let resolveFn;
    const promise = new Promise((resolve) => {
      resolveFn = resolve;
    });

    const timeoutMs = opts.timeoutMs || this._defaultTimeoutMs;
    const timer = this._setTimer(() => {
      // Auto-deny on timeout; drop from the queue first so a late
      // resolve()/deny() is a no-op.
      if (this._pending.has(id)) {
        this._pending.delete(id);
        resolveFn({
          allow: false,
          reason: "approval timed out",
          timedOut: true,
        });
      }
    }, timeoutMs);

    this._pending.set(id, {
      id,
      request,
      createdAt: Date.now(),
      _resolve: resolveFn,
      _timer: timer,
    });

    return { id, promise };
  }

  /** Settle an approval as allowed. No-op for unknown/already-settled ids. */
  resolve(id, decision = {}) {
    return this._settle(id, { allow: true, ...decision });
  }

  /** Settle an approval as denied. No-op for unknown/already-settled ids. */
  deny(id, reason = "denied by user") {
    return this._settle(id, { allow: false, reason });
  }

  _settle(id, result) {
    const entry = this._pending.get(id);
    if (!entry) return false;
    this._pending.delete(id);
    this._clearTimer(entry._timer);
    entry._resolve(result);
    return true;
  }

  /** @returns {object|null} the public view of one pending approval */
  get(id) {
    const e = this._pending.get(id);
    return e ? { id: e.id, request: e.request, createdAt: e.createdAt } : null;
  }

  /** @returns {object[]} public view of all pending approvals */
  list() {
    return [...this._pending.values()].map((e) => ({
      id: e.id,
      request: e.request,
      createdAt: e.createdAt,
    }));
  }

  /** Number of currently-pending approvals. */
  get size() {
    return this._pending.size;
  }
}

module.exports = ApprovalRegistry;
module.exports.DEFAULT_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
