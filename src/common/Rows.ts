import { deepFreeze, isDev } from "./freeze";

/**
 * Rows by key that never change: every change gives a new map and leaves the old one as it was.
 * It is a hash table of small buckets: a change copies one bucket and the list of buckets,
 * not all the rows, so it does not get slower as the collection grows. Two versions are
 * compared bucket by bucket, so finding what changed costs as much as what changed, not as much as the size.
 */
export interface RowMap<V> {
  readonly size: number;
  get(key: string): V | undefined;
  has(key: string): boolean;
  /** A map with the value set. The same map if the value is already there */
  set(key: string, value: V): RowMap<V>;
  /** A map without the key. The same map if it is not there */
  delete(key: string): RowMap<V>;
  /** Many changes at once: much cheaper than the same changes one by one */
  edit(change: (draft: RowDraft<V>) => void): RowMap<V>;
  forEach(visit: (value: V, key: string) => void): void;
  keys(): string[];
  values(): V[];
}

/**
 * The map while it is being edited by `edit`
 */
export interface RowDraft<V> {
  readonly size: number;
  /** Tells that about that many rows will be added, so the table is made big enough at once */
  reserve(extra: number): void;
  get(key: string): V | undefined;
  has(key: string): boolean;
  set(key: string, value: V): void;
  delete(key: string): void;
}

type Bucket<V> = Record<string, V>;
type Buckets<V> = readonly (Bucket<V> | undefined)[];

const MIN_BUCKETS = 16;
/** The average number of rows in a bucket the table is made for */
const LOAD = 24;

function hash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The number of buckets for that many rows: a power of two */
function bucketsFor(size: number): number {
  let count = MIN_BUCKETS;
  while (size > count * LOAD) count *= 2;
  return count;
}

const freezeInDev = <T extends object>(value: T): T =>
  isDev ? Object.freeze(value) : value;

const newBucket = <V>(from?: Bucket<V>): Bucket<V> =>
  Object.assign(Object.create(null) as Bucket<V>, from);

class Rows<V extends object> implements RowMap<V> {
  constructor(
    readonly size: number,
    readonly buckets: Buckets<V>
  ) {
    freezeInDev(buckets);
    freezeInDev(this);
  }

  get(key: string): V | undefined {
    return this.buckets[hash(key) & (this.buckets.length - 1)]?.[key];
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  set(key: string, value: V): RowMap<V> {
    const i = hash(key) & (this.buckets.length - 1);
    const old = this.buckets[i];
    const previous = old?.[key];
    if (previous === value) return this;

    const bucket = newBucket(old);
    bucket[key] = deepFreeze(value);
    const buckets = this.buckets.slice();
    buckets[i] = freezeInDev(bucket);
    return resized(new Rows(previous === undefined ? this.size + 1 : this.size, buckets));
  }

  delete(key: string): RowMap<V> {
    const i = hash(key) & (this.buckets.length - 1);
    const old = this.buckets[i];
    if (old?.[key] === undefined) return this;

    const bucket = newBucket(old);
    delete bucket[key];
    const buckets = this.buckets.slice();
    buckets[i] = Object.keys(bucket).length === 0 ? undefined : freezeInDev(bucket);
    return resized(new Rows(this.size - 1, buckets));
  }

  edit(change: (draft: RowDraft<V>) => void): RowMap<V> {
    const draft = new Draft<V>(this.size, this.buckets);
    change(draft);
    return draft.finish(this);
  }

  forEach(visit: (value: V, key: string) => void): void {
    for (const bucket of this.buckets) {
      if (bucket === undefined) continue;
      for (const key in bucket) visit(bucket[key], key);
    }
  }

  keys(): string[] {
    const keys: string[] = [];
    this.forEach((_, key) => keys.push(key));
    return keys;
  }

  values(): V[] {
    const values: V[] = [];
    this.forEach((value) => values.push(value));
    return values;
  }
}

/**
 * Changes of a map that is being edited: a bucket is copied once, the first time it is changed
 */
class Draft<V extends object> implements RowDraft<V> {
  private buckets: (Bucket<V> | undefined)[];
  private readonly own = new Set<number>();

  constructor(
    public size: number,
    buckets: Buckets<V>
  ) {
    this.buckets = buckets.slice();
  }

  get(key: string): V | undefined {
    return this.buckets[hash(key) & (this.buckets.length - 1)]?.[key];
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  private bucket(i: number): Bucket<V> {
    const found = this.buckets[i];
    if (found !== undefined && this.own.has(i)) return found;
    const copy = newBucket(found);
    this.buckets[i] = copy;
    this.own.add(i);
    return copy;
  }

  set(key: string, value: V): void {
    const i = hash(key) & (this.buckets.length - 1);
    const previous = this.buckets[i]?.[key];
    if (previous === value) return;
    this.bucket(i)[key] = deepFreeze(value);
    if (previous === undefined) {
      this.size++;
      // a big load must not pile the rows into a few buckets
      if (this.size > this.buckets.length * LOAD) this.grow(this.size * 2);
    }
  }

  reserve(extra: number): void {
    if (this.size + extra > this.buckets.length * LOAD) this.grow(this.size + extra);
  }

  /** Spreads the rows over more buckets. All of them are ours after that: they are new */
  private grow(rows: number) {
    const wanted = bucketsFor(rows);
    if (wanted <= this.buckets.length) return;
    const next: (Bucket<V> | undefined)[] = new Array(wanted).fill(undefined);
    for (const bucket of this.buckets) {
      if (bucket === undefined) continue;
      for (const key in bucket) {
        (next[hash(key) & (wanted - 1)] ??= newBucket<V>())[key] = bucket[key];
      }
    }
    this.buckets = next;
    this.own.clear();
    next.forEach((b, i) => b !== undefined && this.own.add(i));
  }

  delete(key: string): void {
    const i = hash(key) & (this.buckets.length - 1);
    if (this.buckets[i]?.[key] === undefined) return;
    delete this.bucket(i)[key];
    this.size--;
  }

  finish(origin: Rows<V>): RowMap<V> {
    if (this.own.size === 0) return origin;
    for (const i of this.own) {
      const bucket = this.buckets[i]!;
      this.buckets[i] = Object.keys(bucket).length === 0 ? undefined : freezeInDev(bucket);
    }
    return resized(new Rows(this.size, this.buckets));
  }
}

/** Makes the table bigger or smaller when the number of rows is far from what it is made for */
function resized<V extends object>(rows: Rows<V>): Rows<V> {
  const wanted = bucketsFor(rows.size);
  const have = rows.buckets.length;
  if (have >= wanted && have <= wanted * 4) return rows;

  const buckets: (Bucket<V> | undefined)[] = new Array(wanted).fill(undefined);
  rows.forEach((value, key) => {
    const i = hash(key) & (wanted - 1);
    (buckets[i] ??= newBucket<V>())[key] = value;
  });
  buckets.forEach((b) => b && freezeInDev(b));
  return new Rows(rows.size, buckets);
}

/**
 * An empty map
 */
export function emptyRows<V extends object>(): RowMap<V> {
  return new Rows<V>(0, new Array(MIN_BUCKETS).fill(undefined));
}

/**
 * Makes a map of rows
 */
export function rowsFrom<V extends object>(
  entries: Iterable<readonly [string, V]>
): RowMap<V> {
  return emptyRows<V>().edit((draft) => {
    for (const [key, value] of entries) draft.set(key, value);
  });
}

/**
 * Tells what is different between two versions of a map: for every key that has another value
 * (or is not in one of them) `visit` gets the value before and after. Buckets that are the same
 * object are skipped, so it is quick when little changed
 */
export function diffRows<V extends object>(
  before: RowMap<V>,
  after: RowMap<V>,
  visit: (key: string, before: V | undefined, after: V | undefined) => void
): void {
  if (before === after) return;
  const a = before as Rows<V>;
  const b = after as Rows<V>;

  if (a.buckets.length !== b.buckets.length) {
    // the table was rebuilt: nothing to skip
    a.forEach((value, key) => {
      const now = b.get(key);
      if (now !== value) visit(key, value, now);
    });
    b.forEach((value, key) => {
      if (a.get(key) === undefined) visit(key, undefined, value);
    });
    return;
  }

  for (let i = 0; i < a.buckets.length; i++) {
    const was = a.buckets[i];
    const now = b.buckets[i];
    if (was === now) continue;
    if (was !== undefined) {
      for (const key in was) {
        const value = now?.[key];
        if (value !== was[key]) visit(key, was[key], value);
      }
    }
    if (now !== undefined) {
      for (const key in now) {
        if (was?.[key] === undefined) visit(key, undefined, now[key]);
      }
    }
  }
}
