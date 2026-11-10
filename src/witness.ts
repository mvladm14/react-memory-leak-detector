// Garbage-collection evidence for the leak verdict.
//
// A marker still in memory `leakAgeMs` after its component unmounted proves
// nothing by itself: the browser may not have collected garbage since, and an
// idle tab can go a long time without doing so. So an instance is reported
// only once a *major* garbage collection has run after it went stale and left
// it in memory.
//
// Why major only: a minor collection (a scavenge) is no evidence in a
// browser. Chrome's DOM objects live in a heap of their own (Blink's Oilpan),
// swept only together with V8's major collections. A cleared timer, a removed
// listener or a cancelled animation frame leaves a dead record there that
// still points at the component's callback, and a scavenge treats that
// pointer as live. A component that cleaned up correctly therefore survives
// every scavenge until the next major collection. A major collection traces
// both heaps and frees it.
//
// The evidence is a *witness*: an object the runtime holds until some
// instances go stale, then releases, keeping only a WeakRef. Nothing else
// references it. Witnesses are taken from a small stock of objects the
// runtime has held through two collections, by which point V8 has promoted
// them to the old generation: only a major collection can free one.
//
// An instance going stale is given the current witness if it is still in
// memory, and a fresh one from the stock only if it isn't. A witness still
// here when the instance goes stale has not been freed yet, so the major
// collection that frees it finishes after that moment, just as it would for
// a witness released then. Checking it is a deref(), which, like releasing a
// fresh one, keeps it alive until the end of the job. So the stock is drawn
// on once per major collection, not once per unmount. A burst of unmounts
// between two DevTools "Collect garbage" clicks all share one witness, and
// the next click judges every one of them.
//
// A witness gone therefore means a major collection finished after the
// instance went stale, which freed every marker that was unreachable. A
// marker still here is really held.
//
// Collections are counted with a probe, a fresh object registered with a
// FinalizationRegistry, whose callback counts one collection and re-arms it.
// The probe runs only while a stock object is still seasoning or an instance
// waits for a witness. Callbacks can be late, never early, so the count is a
// lower bound: seasoning can only take longer.

import { _config } from "./config.js";
import { live } from "./store.js";
import type { LiveEntry, Witness } from "./types.js";

/** Collections a stock object is held through before it may be a witness. */
const SEASONING_GCS = 2;
/** Stock objects kept seasoning or seasoned, oldest first. */
const STOCK = 3;

let gcCount = 0;
let probeArmed = false;

type StockObject = { obj: object; born: number };
const stock: StockObject[] = [];
/** Stale instances waiting for a seasoned witness (right after install). */
const waiting = new Set<LiveEntry>();
/** The latest released witness, shared until a collection frees it. */
let current: Witness | null = null;

const probes = new FinalizationRegistry<undefined>(() => {
  probeArmed = false;
  noteGc();
});

function armProbe(): void {
  if (probeArmed) return;
  probeArmed = true;
  probes.register({}, undefined);
}

function seasoned(s: StockObject): boolean {
  return gcCount - s.born >= SEASONING_GCS;
}

function restock(): void {
  while (stock.length < STOCK) {
    // An already-armed probe may be cleared by a collection that ran before
    // this object existed. Don't count that one.
    stock.push({ obj: {}, born: gcCount + (probeArmed ? 1 : 0) });
    armProbe();
  }
}

/**
 * The witness for instances going stale now, or `null` while no stock object
 * is seasoned yet.
 */
function releaseWitness(): Witness | null {
  // Still in memory: no collection has freed it, so the one that does
  // finishes after now. The deref() keeps it alive until the end of the job.
  if (current && current.ref.deref() !== undefined) return current;
  if (stock.length === 0 || !seasoned(stock[0])) return null;
  const { obj } = stock.shift()!;
  // Creating the WeakRef keeps the object alive until the end of the current
  // job, like every marker dereferenced in this job: a collection later in
  // this job can't free it.
  current = { ref: new WeakRef(obj) };
  restock();
  return current;
}

/**
 * Count one garbage collection, and hand a witness to the instances waiting
 * for one. Called by the probe's finalizer; exported so unit tests can stand
 * in for a collection.
 */
export function noteGc(): void {
  gcCount += 1;
  if (waiting.size > 0) {
    const witness = releaseWitness();
    if (witness) {
      const now = Date.now();
      waiting.forEach((entry) => {
        if (live.has(entry) && isOverAge(entry, now)) entry.witness = witness;
      });
      waiting.clear();
    }
  }
  restock();
  if (waiting.size > 0 || !stock.every(seasoned)) armProbe();
}

/** Unmounted for at least `leakAgeMs`. */
export function isOverAge(entry: LiveEntry, now: number): boolean {
  return (
    entry.unmountedAt != null && now - entry.unmountedAt >= _config.leakAgeMs
  );
}

/**
 * Bring the entry's witness in line with its state: one while the instance is
 * over age (as soon as a seasoned one is available), none otherwise. Call
 * after every change to `unmountedAt` and on every sweep, since `leakAgeMs`
 * turns instances stale with time and can be reconfigured.
 */
export function syncWitness(entry: LiveEntry, now: number): void {
  if (isOverAge(entry, now)) {
    if (entry.witness !== null || waiting.has(entry)) return;
    const witness = releaseWitness();
    if (witness) entry.witness = witness;
    else {
      waiting.add(entry);
      armProbe();
    }
  } else {
    // Mounted again, or `leakAgeMs` was raised: a collection from before
    // doesn't count once it goes stale again.
    entry.witness = null;
    waiting.delete(entry);
  }
}

/**
 * The instance went stale, a major collection has run since, and its marker
 * is still here. The caller must have just dereferenced the marker; the
 * witness is dereferenced in the same job, so a collection can't free one of
 * them while the job keeps the other alive.
 */
export function survivedGc(entry: LiveEntry): boolean {
  return entry.witness !== null && entry.witness.ref.deref() === undefined;
}

// Start seasoning at install, so witnesses are ready by the time components
// go stale.
restock();
