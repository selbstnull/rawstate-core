import type {
  CollectionLike,
  IdKeys,
  RowPatch,
} from "../types/collection.types";
import type { DeepReadonly } from "../types/slice.types";
import type { Collection } from "./Collection";
import { INTERNALS } from "./internal";

/**
 * Number fields of a row: the ones that can be incremented or hold a sum
 */
export type NumberFields<Row> = {
  [K in keyof Row]-?: Row[K] extends number ? K : never;
}[keyof Row] &
  string;

/**
 * Fields that can hold an id of another row
 */
export type RefFields<Row> = {
  [K in keyof Row]-?: NonNullable<Row[K]> extends string | number ? K : never;
}[keyof Row] &
  string;

/**
 * One change of data, described as a value. The store runs it inside the running transaction.
 * Create it with `op.*`
 */
export interface Operation {
  readonly kind: "add" | "upsert" | "update" | "increment" | "remove";
  readonly collection: CollectionLike;
  run(): void;
}

/**
 * What a rule handler may return: nothing, one operation or a list of them
 */
export type OperationResult =
  | Operation
  | readonly Operation[]
  | void
  | null
  | undefined;

/**
 * What happened to the rows of a collection between two moments
 * @internal
 */
export interface RowChanges {
  inserted: object[];
  removed: object[];
  updated: { before: object; after: object }[];
}

/**
 * Reaction of the store to changes of data: it gets the changed rows and gives operations.
 * Create it with `rule`, `increment`, `decrement` or `rollup` and give it to `createStore`
 */
export interface Rule {
  readonly name?: string;
  /**
   * Collections whose changes the rule reacts to
   * @internal
   */
  readonly sources: readonly CollectionLike[];
  /**
   * @internal
   */
  react(changes: ReadonlyMap<CollectionLike, RowChanges>): readonly Operation[];
  /**
   * Operations that bring the data in line when the store is created
   * @internal
   */
  initial?(): readonly Operation[];
}

interface MissingOptions {
  /**
   * What to do when there is no such row: throw, or skip the operation
   */
  ifMissing?: "throw" | "skip";
}

const toList = (result: OperationResult): readonly Operation[] =>
  result == null ? [] : Array.isArray(result) ? result : [result as Operation];

/**
 * Operations as values, to return from rule handlers. They are typed like actions of a collection
 */
export const op = {
  /** Adds a row */
  add<Row extends object, Key extends IdKeys<Row>>(
    collection: Collection<Row, Key>,
    row: DeepReadonly<Row>
  ): Operation {
    return { kind: "add", collection, run: () => collection.actions.add(row) };
  },

  /** Adds a row or replaces the row with the same id */
  upsert<Row extends object, Key extends IdKeys<Row>>(
    collection: Collection<Row, Key>,
    row: DeepReadonly<Row>
  ): Operation {
    return {
      kind: "upsert",
      collection,
      run: () => collection.actions.upsert(row),
    };
  },

  /** Changes a row. Throws if there is no such row, unless `ifMissing: "skip"` */
  update<Row extends object, Key extends IdKeys<Row>>(
    collection: Collection<Row, Key>,
    id: Row[Key],
    change:
      | RowPatch<Row, Key>
      | ((row: DeepReadonly<Row>) => RowPatch<Row, Key>),
    options: MissingOptions = {}
  ): Operation {
    return {
      kind: "update",
      collection,
      run: () => {
        if (options.ifMissing === "skip" && !collection.has(id)) return;
        collection.actions.update(id, change);
      },
    };
  },

  /**
   * Adds `by` to a number field of a row, `by` may be negative.
   * If there is no such row it is skipped (a counter disappears with its owner), unless `ifMissing: "throw"`
   */
  increment<
    Row extends object,
    Key extends IdKeys<Row>,
    F extends NumberFields<Row>
  >(
    collection: Collection<Row, Key>,
    id: Row[Key],
    field: F,
    by: number,
    options: MissingOptions = {}
  ): Operation {
    return {
      kind: "increment",
      collection,
      run: () => {
        if ((options.ifMissing ?? "skip") === "skip" && !collection.has(id)) {
          return;
        }
        if (by === 0) return;
        collection.actions.update(id, (row) => {
          const current = (row as unknown as Record<string, number>)[field];
          return { [field]: current + by } as RowPatch<Row, Key>;
        });
      },
    };
  },

  /** Removes a row. Does nothing if there is no such row */
  remove<Row extends object, Key extends IdKeys<Row>>(
    collection: Collection<Row, Key>,
    id: Row[Key]
  ): Operation {
    return {
      kind: "remove",
      collection,
      run: () => collection.actions.remove(id),
    };
  },
};

export interface RuleHandlers<Row> {
  /** A row appeared */
  inserted?: (row: DeepReadonly<Row>) => OperationResult;
  /** A row was removed, you get the row as it was */
  removed?: (row: DeepReadonly<Row>) => OperationResult;
  /** A row changed: the row before, after and names of the changed fields */
  updated?: (change: {
    before: DeepReadonly<Row>;
    after: DeepReadonly<Row>;
    changed: readonly string[];
  }) => OperationResult;
}

/**
 * Describes how the store reacts to changes of a collection. Handlers get the changed rows
 * and return operations, the store runs them in the same transaction, so the result is
 * applied together with the change or not at all.
 * Rows are seen as the net result of the transaction: a row added and removed inside one
 * transaction is not seen at all.
 * @example
 * rule(credits, {
 *   inserted: (credit) => op.increment(users, credit.userId, "debt", credit.amount),
 *   removed: (credit) => op.increment(users, credit.userId, "debt", -credit.amount),
 * })
 */
export function rule<Row extends object, Key extends IdKeys<Row>>(
  source: Collection<Row, Key>,
  handlers: RuleHandlers<Row>,
  options: { name?: string } = {}
): Rule {
  return {
    name: options.name,
    sources: [source],
    react(changes) {
      const found = changes.get(source);
      if (!found) return [];
      const ops: Operation[] = [];
      for (const row of found.inserted) {
        ops.push(...toList(handlers.inserted?.(row as DeepReadonly<Row>)));
      }
      for (const { before, after } of found.updated) {
        if (!handlers.updated) break;
        const b = before as Record<string, unknown>;
        const a = after as Record<string, unknown>;
        const changed = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(
          (field) => !Object.is(b[field], a[field])
        );
        ops.push(
          ...toList(
            handlers.updated({
              before: before as DeepReadonly<Row>,
              after: after as DeepReadonly<Row>,
              changed,
            })
          )
        );
      }
      for (const row of found.removed) {
        ops.push(...toList(handlers.removed?.(row as DeepReadonly<Row>)));
      }
      return ops;
    },
  };
}

interface IncrementOptions<CRow, Id> {
  /** Id of the row whose field changes. `null` or `undefined` means "nobody" */
  to: (row: DeepReadonly<CRow>) => Id | null | undefined;
  /** How much to add for one row, 1 by default */
  by?: (row: DeepReadonly<CRow>) => number;
}

function counter<
  PRow extends object,
  PKey extends IdKeys<PRow>,
  F extends NumberFields<PRow>
>(target: Collection<PRow, PKey>, field: F, sign: 1 | -1) {
  return {
    /**
     * Source of the changes: a row that appears adds to the field, a removed row takes it back,
     * a changed row moves the difference (or moves the amount to another row)
     */
    from<CRow extends object, CKey extends IdKeys<CRow>>(
      source: Collection<CRow, CKey>,
      options: IncrementOptions<CRow, PRow[PKey]>
    ): Rule {
      const amount = (row: DeepReadonly<CRow>) => (options.by?.(row) ?? 1) * sign;
      const bump = (row: DeepReadonly<CRow>, direction: 1 | -1) => {
        const id = options.to(row);
        return id == null
          ? []
          : [op.increment(target, id, field, amount(row) * direction)];
      };

      return rule(source, {
        inserted: (row) => bump(row, 1),
        removed: (row) => bump(row, -1),
        updated: ({ before, after }) => {
          const from = options.to(before);
          const to = options.to(after);
          if (from != null && to != null && String(from) === String(to)) {
            return [op.increment(target, to, field, amount(after) - amount(before))];
          }
          return [...bump(before, -1), ...bump(after, 1)];
        },
      });
    },
  };
}

/**
 * Keeps a number field of a row equal to the sum of what rows of another collection give.
 * The change is reversible: removing the source row takes the amount back.
 * @example increment(users, "debt").from(credits, { to: (c) => c.userId, by: (c) => c.amount })
 */
export function increment<
  PRow extends object,
  PKey extends IdKeys<PRow>,
  F extends NumberFields<PRow>
>(target: Collection<PRow, PKey>, field: F) {
  return counter(target, field, 1);
}

/**
 * The same as `increment`, but the source rows take from the field
 * @example decrement(users, "debt").from(payments, { to: (p) => p.userId, by: (p) => p.amount })
 */
export function decrement<
  PRow extends object,
  PKey extends IdKeys<PRow>,
  F extends NumberFields<PRow>
>(target: Collection<PRow, PKey>, field: F) {
  return counter(target, field, -1);
}

/**
 * How rows of a child collection are collected into one number for a parent row
 */
export interface Aggregate<Id> {
  readonly child: CollectionLike;
  readonly fk: string;
  readonly value: (row: object) => number;
  /** Type of the reference, to check it against the id of the parent */
  readonly idType?: Id;
}

/**
 * The number of child rows that refer to the parent row
 * @example rollup(users, "creditCount", count(credits, "userId"))
 */
export function count<
  CRow extends object,
  CKey extends IdKeys<CRow>,
  F extends RefFields<CRow>
>(child: Collection<CRow, CKey>, fk: F): Aggregate<NonNullable<CRow[F]>> {
  return { child, fk, value: () => 1 };
}

/**
 * The sum of a number field of child rows that refer to the parent row
 * @example rollup(users, "debt", sum(credits, "userId", "amount"))
 */
export function sum<
  CRow extends object,
  CKey extends IdKeys<CRow>,
  F extends RefFields<CRow>,
  V extends NumberFields<CRow>
>(
  child: Collection<CRow, CKey>,
  fk: F,
  valueField: V
): Aggregate<NonNullable<CRow[F]>> {
  return {
    child,
    fk,
    value: (row) => Number((row as Record<string, unknown>)[valueField] ?? 0),
  };
}

/**
 * Makes a number field of the parent a value that is calculated from the rows that refer to it.
 * Unlike `increment` it can not drift: every time the parent or its children change the value is
 * calculated from the children again, so editing the field by hand does not hold. When the store is
 * created the field of every row is brought in line too.
 * @example rollup(users, "debt", sum(credits, "userId", "amount"))
 */
export function rollup<
  PRow extends object,
  PKey extends IdKeys<PRow>,
  F extends NumberFields<PRow>
>(
  target: Collection<PRow, PKey>,
  field: F,
  aggregate: Aggregate<PRow[PKey]>
): Rule {
  const recompute = (keys: Iterable<string>): Operation[] => {
    const children = aggregate.child[INTERNALS]();
    const parents = (target as CollectionLike)[INTERNALS]().rows();
    const ops: Operation[] = [];
    for (const k of keys) {
      const row = parents.get(k) as Record<string, unknown> | undefined;
      if (!row) continue;
      let total = 0;
      for (const child of children.lookup(aggregate.fk, k)) total += aggregate.value(child);
      if (row[field] !== total) {
        ops.push(
          op.update(target, row[target.key] as PRow[PKey], {
            [field]: total,
          } as RowPatch<PRow, PKey>)
        );
      }
    }
    return ops;
  };

  return {
    name: `rollup ${field}`,
    sources: [aggregate.child, target],
    react(changes) {
      const affected = new Set<string>();
      const touch = (row: object, name: string) => {
        const value = (row as Record<string, unknown>)[name];
        if (value != null) affected.add(String(value));
      };

      const fromChildren = changes.get(aggregate.child);
      if (fromChildren) {
        fromChildren.inserted.forEach((row) => touch(row, aggregate.fk));
        fromChildren.removed.forEach((row) => touch(row, aggregate.fk));
        fromChildren.updated.forEach(({ before, after }) => {
          touch(before, aggregate.fk);
          touch(after, aggregate.fk);
        });
      }
      const fromParents = changes.get(target);
      if (fromParents) {
        fromParents.inserted.forEach((row) => touch(row, target.key));
        fromParents.updated.forEach(({ after }) => touch(after, target.key));
      }
      return affected.size > 0 ? recompute(affected) : [];
    },
    initial() {
      return recompute((target as CollectionLike)[INTERNALS]().rows().keys());
    },
  };
}
