import type { Readable } from "../types/readable.types";

export type ReadableValues<D extends readonly Readable<unknown>[]> = {
  -readonly [K in keyof D]: D[K] extends Readable<infer V> ? V : never;
};

export interface ViewOptions<R> {
  /**
   * Tells that the new result is the same as the old one, so nobody is notified. `Object.is` by default
   */
  equals?: (previous: R, next: R) => boolean;
}

/**
 * Value that is calculated from other readable values and changes together with them
 */
export class View<R> implements Readable<R> {
  private cache: { inputs: unknown[]; value: R } | null = null;
  private subscribers: ((value: R) => void)[] = [];
  private disconnect: (() => void)[] = [];

  constructor(
    private readonly deps: readonly Readable<unknown>[],
    private readonly compute: (...values: never[]) => R,
    private readonly equals: (previous: R, next: R) => boolean = Object.is
  ) {}

  /**
   * Current result. It is calculated again only when one of the sources has another value
   */
  get = (): R => {
    const inputs = this.deps.map((dep) => dep.get());
    const cache = this.cache;
    if (cache && cache.inputs.every((v, i) => Object.is(v, inputs[i]))) {
      return cache.value;
    }
    const next = (this.compute as (...values: unknown[]) => R)(...inputs);
    const value = cache && this.equals(cache.value, next) ? cache.value : next;
    this.cache = { inputs, value };
    return value;
  };

  subscribe = (fn: (value: R) => void): (() => void) => {
    this.subscribers.push(fn);
    if (this.subscribers.length === 1) this.connect();
    return () => {
      this.subscribers = this.subscribers.filter((f) => f !== fn);
      if (this.subscribers.length === 0) this.release();
    };
  };

  private connect() {
    this.get();
    this.disconnect = this.deps.map((dep) => dep.subscribe(this.onSourceChange));
  }

  private release() {
    this.disconnect.forEach((off) => off());
    this.disconnect = [];
  }

  private onSourceChange = () => {
    const previous = this.cache?.value;
    const value = this.get();
    if (Object.is(previous, value)) return;

    let failed = false;
    let error: unknown;
    for (const fn of this.subscribers.slice()) {
      try {
        fn(value);
      } catch (e) {
        if (!failed) {
          failed = true;
          error = e;
        }
      }
    }
    if (failed) throw error;
  };
}

/**
 * Creates a value calculated from other readable values (states of slices, other views)
 * @example view([a.getState("price"), b.getState("count")], (price, count) => price * count)
 */
export function view<const D extends readonly Readable<unknown>[], R>(
  deps: D,
  compute: (...values: ReadableValues<D>) => R,
  options: ViewOptions<R> = {}
): View<R> {
  return new View<R>(deps, compute as (...values: never[]) => R, options.equals);
}

/**
 * Creates views by argument and remembers them: the same argument gives the same view
 * @example const debtOf = viewFamily((id: string) => view([debts.getState("byId")], (m) => m[id]))
 */
export function viewFamily<A, R>(factory: (arg: A) => Readable<R>) {
  const cache = new Map<A, Readable<R>>();
  const get = (arg: A): Readable<R> => {
    let found = cache.get(arg);
    if (!found) {
      found = factory(arg);
      cache.set(arg, found);
    }
    return found;
  };
  /** Forgets the views that were made, to free the memory */
  return Object.assign(get, { clear: () => cache.clear() });
}
