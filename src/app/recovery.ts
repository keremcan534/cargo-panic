/**
 * Recovery from an unexpected runtime error, so the game never freezes on
 * one. Every uncaught error and unhandled promise rejection on the page (and
 * whatever a frame callback throws, reported by FrameLoop) comes here:
 *
 * - Errors that are not the game's are left alone: a browser extension's
 *   script, a cross-origin "Script error.", the browser's benign
 *   ResizeObserver warning, a media or abort rejection from a browser API.
 * - The game's own error is logged once, the save is written now, and the
 *   player is taken back to the main menu with a short notice. Leaving the
 *   game saves it as the one to resume (Game.exit), so CONTINUE brings it
 *   back: no progress is lost.
 * - A burst of errors (one frame can raise several) is one recovery.
 * - A crash loop does not spin: after MAX_RECOVERIES recoveries within
 *   CRASH_WINDOW_MS the notice is shown once more and the game stays where
 *   it is (the menu), logging nothing more, until CRASH_WINDOW_MS pass
 *   without an error.
 *
 * The policy is plain logic (RecoveryPolicy, isForeignError); installRecovery
 * wires it to an event target with hooks main.ts supplies. No DOM or game
 * imports, so both run under the unit tests.
 */

/** Errors this close together count towards one crash loop. */
export const CRASH_WINDOW_MS = 10_000;
/** Recoveries allowed within CRASH_WINDOW_MS; the next error holds instead. */
export const MAX_RECOVERIES = 3;
/** Errors this soon after a recovery belong to it (the same frame, the same burst). */
export const COALESCE_MS = 1_000;

/** What is known about an error: from an ErrorEvent, or an Error / rejection reason. */
export interface ErrorInfo {
  message?: string;
  /** The script the error was raised in (ErrorEvent.filename), if known. */
  filename?: string;
  stack?: string;
  /** The error's name (DOMException names: AbortError, NotAllowedError, ...). */
  name?: string;
}

/**
 * - `recover`: log it, save, back to the menu, show the notice.
 * - `hold`: a crash loop. Log it and show the notice, but do not navigate.
 * - `ignore`: part of a recovery already made, or of a loop already held.
 */
export type RecoveryAction = 'recover' | 'hold' | 'ignore';

const EXTENSION_URL = /\b(?:chrome|moz|safari|safari-web|ms-browser|edge)-extension:\/\//;
const BENIGN_MESSAGES = [/ResizeObserver loop/i];
/** Rejections browser APIs raise in normal use (an interrupted media play, an autoplay or permission refusal). */
const BENIGN_NAMES = new Set(['AbortError', 'NotAllowedError']);

/**
 * True when the error is clearly not the game's: raised in an extension's or
 * another origin's script, a cross-origin "Script error." with nothing more,
 * or a known benign browser warning. Anything else (including an error with
 * no location at all) counts as the game's.
 */
export function isForeignError(info: ErrorInfo, origin: string): boolean {
  const message = info.message ?? '';
  if (BENIGN_MESSAGES.some((re) => re.test(message))) return true;
  if (info.name && BENIGN_NAMES.has(info.name)) return true;
  const file = info.filename ?? '';
  if (file) {
    if (EXTENSION_URL.test(file)) return true;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(file) && !file.startsWith(origin)) return true;
    return false;
  }
  const stack = info.stack ?? '';
  if (stack) {
    // From the game's own code if any frame is on our origin; else foreign if an extension raised it.
    if (origin && stack.includes(origin)) return false;
    if (EXTENSION_URL.test(stack)) return true;
    return false;
  }
  // Cross-origin scripts are reported only as "Script error." with no location; the game's scripts are same-origin.
  return /^Script error\.?$/i.test(message.trim());
}

/** Reads what can be known about a thrown value or rejection reason. */
export function describe(error: unknown): ErrorInfo {
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; stack?: unknown; name?: unknown };
    return {
      message: typeof e.message === 'string' ? e.message : String(error),
      stack: typeof e.stack === 'string' ? e.stack : undefined,
      name: typeof e.name === 'string' ? e.name : undefined,
    };
  }
  return { message: String(error) };
}

/** Decides what each of the game's errors leads to (see the file comment). */
export class RecoveryPolicy {
  private recoveries: number[] = [];
  private lastError = -Infinity;
  private holding = false;

  constructor(
    private readonly windowMs = CRASH_WINDOW_MS,
    private readonly maxRecoveries = MAX_RECOVERIES,
    private readonly coalesceMs = COALESCE_MS,
  ) {}

  /** In a held crash loop (until windowMs pass without an error). */
  get held(): boolean {
    return this.holding;
  }

  record(now: number): RecoveryAction {
    const quiet = now - this.lastError >= this.windowMs;
    this.lastError = now;
    if (this.holding) {
      if (!quiet) return 'ignore';
      this.holding = false;
      this.recoveries = [];
    }
    this.recoveries = this.recoveries.filter((t) => now - t < this.windowMs);
    const last = this.recoveries[this.recoveries.length - 1];
    if (last !== undefined && now - last < this.coalesceMs) return 'ignore';
    if (this.recoveries.length >= this.maxRecoveries) {
      this.holding = true;
      return 'hold';
    }
    this.recoveries.push(now);
    return 'recover';
  }
}

export interface RecoveryHooks {
  /** Writes the save now. */
  flush(): void;
  /** Leaves the current screen, whatever state it is in, for the main menu. */
  toMenu(): void;
  /** Shows the "the game recovered" notice. */
  notify(): void;
  /** Logs the error (once per recovery or hold). */
  log(error: unknown, action: Exclude<RecoveryAction, 'ignore'>): void;
}

export interface RecoveryOptions {
  /** The page's origin: errors from scripts elsewhere are not the game's. */
  origin: string;
  now?: () => number;
  /** Runs the recovery outside the throwing frame or event (default: a zero-delay timeout). */
  schedule?: (run: () => void) => void;
  policy?: RecoveryPolicy;
}

export interface Recovery {
  /** Reports an error caught elsewhere (FrameLoop's onError). */
  report(error: unknown): void;
  /** Stops listening. */
  dispose(): void;
}

type ErrorEventLike = Event & { message?: string; filename?: string; error?: unknown };
type RejectionEventLike = Event & { reason?: unknown };

/** Listens for 'error' and 'unhandledrejection' on `target` (the window) and recovers per the policy. */
export function installRecovery(target: EventTarget, hooks: RecoveryHooks, opts: RecoveryOptions): Recovery {
  const policy = opts.policy ?? new RecoveryPolicy();
  const now = opts.now ?? (() => Date.now());
  const schedule = opts.schedule ?? ((run: () => void) => void setTimeout(run, 0));
  let pending = false;

  const attempt = (step: () => void) => {
    try {
      step();
    } catch (e) {
      // The recovery's own step failed (the menu would not open, say): that counts as one more error.
      handle(e, describe(e));
    }
  };

  /** Returns true when the error was the game's (handled here). */
  function handle(error: unknown, info: ErrorInfo): boolean {
    if (isForeignError(info, opts.origin)) return false;
    const action = policy.record(now());
    if (action === 'ignore') return true;
    try {
      hooks.log(error, action);
    } catch {
      // Logging must never stop the recovery.
    }
    if (pending) return true;
    pending = true;
    schedule(() => {
      pending = false;
      attempt(() => hooks.flush());
      if (action === 'recover') attempt(() => hooks.toMenu());
      attempt(() => hooks.notify());
    });
    return true;
  }

  const onError = (event: Event) => {
    const e = event as ErrorEventLike;
    const info = { ...describe(e.error ?? e.message), filename: e.filename || undefined };
    if (!info.message && e.message) info.message = e.message;
    // Handled here (logged once, or deliberately quiet in a held loop): no second "Uncaught" line.
    if (handle(e.error ?? e.message, info)) event.preventDefault();
  };
  const onRejection = (event: Event) => {
    const reason = (event as RejectionEventLike).reason;
    if (handle(reason, describe(reason))) event.preventDefault();
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return {
    report: (error) => void handle(error, describe(error)),
    dispose() {
      target.removeEventListener('error', onError);
      target.removeEventListener('unhandledrejection', onRejection);
    },
  };
}
