import type { SliceLike } from "../types/slice.types";
import type { StoreSnapshot } from "../types/store.types";
import type { Relation } from "./Relation";
import type { Rule } from "./Rule";
import { Store, type TransactionDefs } from "./Store";

/**
 * Options of `create`
 */
export interface CreateOptions {
  /**
   * Contents the new store starts with, for example what `store.snapshot()` of the server gave.
   * It is loaded as trusted data, checked by schemas
   */
  snapshot?: StoreSnapshot;
}

/**
 * A blueprint of a store: it makes as many separate stores as you ask, each with its own slices
 */
export interface StoreFactory<
  T extends Record<string, SliceLike>,
  X extends TransactionDefs<T> = Record<never, never>
> {
  /**
   * Makes a new store. Nothing is shared with the other stores of this blueprint
   */
  create(options?: CreateOptions): Store<T, X>;
}

/**
 * What a blueprint is made of. Everything that has instances is made by functions,
 * so every `create()` gets its own
 */
export interface StoreBlueprint<
  T extends Record<string, SliceLike>,
  X extends TransactionDefs<T>
> {
  /** Makes the slices and collections of one store. Create new ones here every time */
  slices: () => T;
  /** Links between collections, made from the slices of the store */
  relations?: (slices: T) => readonly Relation[];
  /** Rules, made from the slices of the store */
  rules?: (slices: T) => readonly Rule[];
  /** Named transactions, they get the slices of the store first */
  transactions?: X;
}

/**
 * Describes a store once and makes it as many times as needed: a store per request on a server,
 * per test, per session, per mounted module. Slices, collections, relations and rules are made
 * again by every `create()`, so stores do not know about each other.
 *
 * @example
 * const appStore = defineStore({
 *   slices: () => ({
 *     users: createCollection<User>()({ key: "id" }),
 *     credits: createCollection<Credit>()({ key: "id" }),
 *   }),
 *   relations: (s) => [relation(s.credits, "userId", s.users, { onDelete: "cascade" })],
 *   rules: (s) => [rollup(s.users, "debt", sum(s.credits, "userId", "amount"))],
 *   transactions: {
 *     openCredit: (s, userId: string, amount: number) => { ... },
 *   },
 * });
 *
 * const store = appStore.create();               // a new, empty store
 * const loaded = appStore.create({ snapshot });  // a new store with data
 * store.dispose();                               // when it is not needed
 */
export function defineStore<
  T extends Record<string, SliceLike>,
  X extends TransactionDefs<T>
>(blueprint: StoreBlueprint<T, X> & { transactions: X }): StoreFactory<T, X>;
export function defineStore<T extends Record<string, SliceLike>>(
  blueprint: Omit<StoreBlueprint<T, Record<never, never>>, "transactions">
): StoreFactory<T>;
export function defineStore(blueprint: {
  slices: () => Record<string, SliceLike>;
  relations?: (slices: Record<string, SliceLike>) => readonly Relation[];
  rules?: (slices: Record<string, SliceLike>) => readonly Rule[];
  transactions?: TransactionDefs<Record<string, SliceLike>>;
}): unknown {
  return {
    create(options: CreateOptions = {}) {
      const slices = blueprint.slices();
      const store = new Store(
        slices,
        blueprint.transactions,
        blueprint.relations?.(slices),
        blueprint.rules?.(slices)
      );
      if (options.snapshot) {
        try {
          store.load(options.snapshot);
        } catch (error) {
          // the slices are free again, nobody keeps a half made store
          store.dispose();
          throw error;
        }
      }
      return store;
    },
  };
}
