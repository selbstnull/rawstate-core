/**
 * Where a change came from. Persistence and sync use it to know what to write where:
 * - `local`: made by the user of the app (actions, transactions)
 * - `remote`: data from the server
 * - `hydrate`: data loaded from storage at start
 * - `tab`: data written by another tab
 * Any other string is allowed for your own sources
 */
export type Origin = "local" | "remote" | "hydrate" | "tab" | (string & {});

/**
 * Options of a transaction
 */
export interface TransactionOptions {
  /** Where the change came from, `local` by default */
  origin?: Origin;
  /**
   * The data is trusted: rules and relations are not run for it, because it was already
   * calculated and checked where it came from. `false` by default
   */
  trusted?: boolean;
}

type Id = string | number;

/**
 * Changes of rows of one collection
 */
export interface CollectionChanges {
  /** Rows that are new or changed, whole rows */
  upserted?: readonly object[];
  /** Ids of removed rows */
  removed?: readonly Id[];
  /** All the ids in their order, if the order needs to be set */
  ids?: readonly Id[];
}

/**
 * Changes of a store as data: what a commit gives out and what `store.apply` takes
 */
export interface StoreChanges {
  /** By the name of the collection in the store */
  collections?: Readonly<Record<string, CollectionChanges>>;
  /** By the name of the slice, then by the key of the state: the new value */
  states?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/**
 * Whole contents of a store or of a part of it, for `store.load`
 */
export interface StoreSnapshot {
  /** Rows of collections, they replace all the rows */
  collections?: Readonly<Record<string, readonly object[]>>;
  /** Values of states of slices */
  states?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/**
 * What a commit gives to `store.onCommit`: what changed in the end
 */
export interface CommitEvent {
  readonly origin: Origin;
  readonly trusted: boolean;
  readonly collections: Readonly<
    Record<
      string,
      {
        readonly upserted: readonly object[];
        readonly removed: readonly Id[];
        /** The order of ids, if it changed */
        readonly ids?: readonly Id[];
      }
    >
  >;
  readonly states: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}
