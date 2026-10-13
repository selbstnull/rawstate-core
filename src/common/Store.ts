import { ATTACH, CELLS, CHECK, DISPOSE, INTERNALS } from "./internal";
import { diffRows, type RowMap } from "./Rows";
import { ValidationError } from "./validate";
import { deepFreeze } from "./freeze";
import type { Observer } from "./Observer";
import { Engine } from "./Engine";
import { Relation } from "./Relation";
import type { Rule } from "./Rule";
import type {
  CollectionInternals,
  CollectionLike,
} from "../types/collection.types";
import type {
  CollectionChanges,
  CommitEvent,
  StoreChanges,
  StoreSnapshot,
  TransactionOptions,
} from "../types/store.types";
import { TxContext, TxManager } from "./Transaction";
import { SliceLike } from "../types/slice.types";

/**
 * What a transaction can return: anything but a Promise, a transaction is synchronous
 */
export type SyncResult =
  | void
  | null
  | undefined
  | boolean
  | number
  | string
  | bigint
  | symbol
  | (object & { then?: undefined });

/**
 * Named transactions of the store. The first argument is the slices of the store, the others are yours
 */
export type TransactionDefs<T extends Record<string, SliceLike>> = Record<
  string,
  (slices: T, ...args: never[]) => SyncResult
>;

/**
 * Transactions as they are called from outside: without the slices argument
 */
export type BoundTransactions<
  T extends Record<string, SliceLike>,
  X extends TransactionDefs<T>
> = {
  [K in keyof X]: X[K] extends (slices: T, ...args: infer P) => infer R
    ? (...args: P) => R
    : never;
};

function isPromise(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export class Store<
  T extends Record<string, SliceLike>,
  X extends TransactionDefs<T> = Record<never, never>
> {
  private readonly tx = new TxManager();
  private readonly collectionsByName = new Map<string, CollectionInternals>();
  private readonly statesByName = new Map<
    string,
    { slice: SliceLike; cells: ReadonlyMap<string, Observer<unknown>> }
  >();
  private readonly commitListeners = new Set<(event: CommitEvent) => void>();
  private readonly cleanups = new Set<() => void>();
  private isDisposed = false;

  /**
   * Named transactions of the store, call them like functions: `store.transactions.openCredit(id, 100)`
   */
  readonly transactions: BoundTransactions<T, X>;

  /**
   * Creates the store that will server slices
   * @param slices is a slices to stored to, a key of slice is its name in the store
   * @param definitions is a named transactions that change several slices at once
   * @param relations is a links between collections of the store, they are kept by every transaction
   * @param rules is a reactions to changes of collections, they run inside the transaction that caused them
   */
  constructor(
    readonly slices: T,
    definitions?: X,
    relations: readonly Relation[] = [],
    rules: readonly Rule[] = []
  ) {
    Object.values(slices).forEach((slice) => slice[ATTACH](this.tx));
    for (const [name, slice] of Object.entries(slices)) {
      if (INTERNALS in slice) {
        this.collectionsByName.set(name, (slice as CollectionLike)[INTERNALS]());
      } else {
        this.statesByName.set(name, { slice, cells: slice[CELLS]() });
      }
    }
    this.tx.listeners.push((journal, context) => {
      if (this.commitListeners.size === 0) return;
      const event = this.describe(journal, context);
      // a transaction that ended with the same values as it started with is not a change
      if (
        Object.keys(event.collections).length === 0 &&
        Object.keys(event.states).length === 0
      ) {
        return;
      }
      this.commitListeners.forEach((listener) => listener(event));
    });
    this.keepRules(relations, rules);

    const bound: Record<string, (...args: unknown[]) => unknown> = {};
    for (const [name, fn] of Object.entries(definitions ?? {})) {
      bound[name] = (...args) =>
        this.run(() =>
          (fn as (slices: T, ...args: unknown[]) => unknown)(slices, ...args)
        );
    }
    this.transactions = bound as BoundTransactions<T, X>;
  }

  /**
   * `true` after `dispose()`
   */
  get disposed(): boolean {
    return this.isDisposed;
  }

  /**
   * Frees everything the store owns. Use it when the store is not needed any more: at the end of
   * a request, of a test, when a module is closed.
   * - what was registered with `onDispose` is called (`persistStore` stops itself this way)
   * - listeners of `onCommit` and everybody who watches the states, rows and views are dropped
   * - rules, relations and named transactions stop working, changing the store throws
   * - slices and collections leave the store, they work on their own and can join another store
   * Calling it again does nothing
   */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    for (const cleanup of [...this.cleanups].reverse()) {
      try {
        cleanup();
      } catch (error) {
        console.error("rawstate: a cleanup of the store failed", error);
      }
    }
    this.cleanups.clear();
    this.commitListeners.clear();
    this.tx.guards.length = 0;
    this.tx.listeners.length = 0;
    Object.values(this.slices).forEach((slice) => slice[DISPOSE]());
  }

  /**
   * Registers something to do when the store is disposed
   * @returns Function that removes it
   */
  onDispose(cleanup: () => void): () => void {
    this.assertAlive();
    this.cleanups.add(cleanup);
    return () => {
      this.cleanups.delete(cleanup);
    };
  }

  /**
   * The whole contents of the store as plain data: rows of every collection in their order
   * and states of every slice. It is what `load` takes, so it is how a store is passed from
   * a server to a client or saved: `defineStore(...).create({ snapshot })`
   */
  snapshot(): StoreSnapshot {
    const collections: Record<string, readonly object[]> = {};
    for (const [name, internals] of this.collectionsByName) {
      const rows = internals.rows();
      collections[name] = internals.ids().map((id) => rows.get(String(id))!);
    }
    const states: Record<string, Record<string, unknown>> = {};
    for (const [name, { slice }] of this.statesByName) {
      states[name] = { ...(slice.snapshot() as Record<string, unknown>) };
    }
    return { collections, states };
  }

  private assertAlive() {
    if (this.isDisposed) throw new Error("The store is disposed");
  }

  private keepRules(relations: readonly Relation[], rules: readonly Rule[]) {
    if (relations.length === 0 && rules.length === 0) return;

    const names = new Map<CollectionLike, string>();
    for (const [name, slice] of Object.entries(this.slices)) {
      if (INTERNALS in slice) names.set(slice as CollectionLike, name);
    }
    const used = [
      ...relations.flatMap((r) => [r.child, r.parent]),
      ...rules.flatMap((rule) => rule.sources),
    ];
    for (const collection of used) {
      if (!names.has(collection)) {
        throw new Error(
          "A relation or a rule uses a collection that is not in the store"
        );
      }
    }

    const engine = new Engine(names, relations, rules);
    this.tx.guards.push(engine.guard);
    engine.reconcile(this.tx);
  }

  /**
   * This method allows to get slice from the store
   * @param key is a key of slice to get to
   * @returns Slice
   */
  getSlice<K extends keyof T>(key: K): T[K] {
    return this.slices[key];
  }

  /**
   * Runs changes of any slices of the store as one: all of them are applied or none,
   * and subscribers are notified once, when everything is done. Throw to cancel the changes.
   * The function must be synchronous. Options tell where the changes came from (`origin`)
   * and whether they are trusted, so rules and relations are not run for them
   */
  transaction<R>(
    fn: () => R extends PromiseLike<unknown> ? never : R,
    options?: TransactionOptions
  ): R {
    return this.run(fn, options);
  }

  /**
   * Calls `listener` after every commit that changed something, with what changed in the end.
   * Persistence and sync use it. It is calculated only while somebody listens
   * @returns Unsubscribe function
   */
  onCommit(listener: (event: CommitEvent) => void): () => void {
    this.assertAlive();
    this.commitListeners.add(listener);
    return () => {
      this.commitListeners.delete(listener);
    };
  }

  /**
   * Applies changes that came from outside (the same format `onCommit` gives out) as one transaction.
   * `origin` is `remote` by default. Unknown names throw
   */
  apply(changes: StoreChanges, options: TransactionOptions = {}): void {
    this.run(() => this.write(changes, false), {
      origin: "remote",
      ...options,
    });
  }

  /**
   * Loads contents, for example from storage at start: the given collections are replaced
   * with the rows, the given states get the values. It is trusted data with origin `hydrate`
   * by default, so rules and relations are not run
   */
  load(snapshot: StoreSnapshot, options: TransactionOptions = {}): void {
    this.run(() => this.write(snapshot, true), {
      origin: "hydrate",
      trusted: true,
      ...options,
    });
  }

  private write(
    data: {
      collections?: Readonly<Record<string, unknown>>;
      states?: StoreChanges["states"];
    },
    replace: boolean
  ) {
    for (const [name, value] of Object.entries(data.collections ?? {})) {
      const collection = this.collectionsByName.get(name);
      if (!collection) throw new Error(`There is no collection "${name}" in the store`);
      try {
        if (replace) collection.replaceAll(value as readonly object[]);
        else collection.applyChanges(value as CollectionChanges);
      } catch (error) {
        throw error instanceof ValidationError ? error.at(name) : error;
      }
    }
    for (const [name, values] of Object.entries(data.states ?? {})) {
      const found = this.statesByName.get(name);
      if (!found) throw new Error(`There is no slice "${name}" in the store`);
      for (const key of Object.keys(values)) {
        if (!found.cells.has(key)) throw new Error(`There is no state "${name}.${key}"`);
      }
      let checked: Record<string, unknown>;
      try {
        checked = found.slice[CHECK]({ ...values });
      } catch (error) {
        throw error instanceof ValidationError ? error.at(name) : error;
      }
      for (const [key, value] of Object.entries(checked)) {
        this.tx.write(found.cells.get(key)!, deepFreeze(value));
      }
    }
  }

  private describe(
    journal: ReadonlyMap<object, unknown>,
    context: TxContext
  ): CommitEvent {
    const collections: Record<string, CommitEvent["collections"][string]> = {};
    for (const [name, internals] of this.collectionsByName) {
      const rows = internals.rows();
      const before = (journal.has(internals.cell)
        ? journal.get(internals.cell)
        : rows) as RowMap<object>;
      const ids = internals.ids();
      const idsChanged =
        journal.has(internals.idsCell) &&
        journal.get(internals.idsCell) !== ids;
      if (before === rows && !idsChanged) continue;

      const upserted: object[] = [];
      const removed: (string | number)[] = [];
      diffRows(before, rows, (_key, was, now) => {
        if (now !== undefined) upserted.push(now);
        else if (was !== undefined) {
          removed.push((was as Record<string, string | number>)[internals.key]);
        }
      });
      collections[name] = idsChanged ? { upserted, removed, ids } : { upserted, removed };
    }

    const states: Record<string, Record<string, unknown>> = {};
    for (const [name, { cells }] of this.statesByName) {
      for (const [key, cell] of cells) {
        if (!journal.has(cell)) continue;
        const value = cell.get();
        if (Object.is(journal.get(cell), value)) continue;
        (states[name] ??= {})[key] = value;
      }
    }

    return {
      origin: context.origin,
      trusted: context.trusted,
      collections,
      states,
    };
  }

  private run<R>(fn: () => R, options?: TransactionOptions): R {
    this.assertAlive();
    return this.tx.run(() => {
      const result = fn();
      if (isPromise(result)) {
        throw new Error("Transaction function must be synchronous");
      }
      return result;
    }, options);
  }
}

/**
 * Creates the store with the slices, and if needed links between collections and named transactions
 * @example
 * const store = createStore({ users, credits }, {
 *   relations: [relation(credits, "userId", users, { onDelete: "cascade" })],
 *   rules: [rollup(users, "debt", sum(credits, "userId", "amount"))],
 *   transactions: {
 *     openCredit: (s, userId: string, amount: number) => {
 *       s.credits.actions.add({ id: nextId(), userId, amount });
 *       s.users.actions.update(userId, (u) => ({ debt: u.debt + amount }));
 *     },
 *   },
 * });
 * store.transactions.openCredit("u1", 100);
 */
export function createStore<
  T extends Record<string, SliceLike>,
  X extends TransactionDefs<T>
>(
  slices: T,
  options: {
    relations?: readonly Relation[];
    rules?: readonly Rule[];
    transactions: X;
  }
): Store<T, X>;
export function createStore<T extends Record<string, SliceLike>>(
  slices: T,
  options?: { relations?: readonly Relation[]; rules?: readonly Rule[] }
): Store<T>;
export function createStore(
  slices: Record<string, SliceLike>,
  options?: {
    relations?: readonly Relation[];
    rules?: readonly Rule[];
    transactions?: TransactionDefs<Record<string, SliceLike>>;
  }
): unknown {
  return new Store(
    slices,
    options?.transactions,
    options?.relations,
    options?.rules
  );
}
