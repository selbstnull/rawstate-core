import type {
  CollectionLike,
  IdKeys,
} from "../types/collection.types";
import type { Collection } from "./Collection";
import { diffRows, type RowMap } from "./Rows";

/**
 * What happens to the rows that refer to a row that is removed
 */
export type OnDelete = "cascade" | "restrict" | "setNull";

/**
 * Fields of a row that can hold an id of the parent: their type fits the id (null and undefined mean "no reference")
 */
export type FkFields<Row, Id> = {
  [K in keyof Row]-?: NonNullable<Row[K]> extends Id ? K : never;
}[keyof Row] &
  string;

export interface RelationOptions<Value> {
  /**
   * - `restrict` (default): removing the parent fails while rows refer to it
   * - `cascade`: rows that refer to the parent are removed with it
   * - `setNull`: the field of those rows is set to `null`, only for fields that can be `null`
   */
  onDelete?: "cascade" | "restrict" | (null extends Value ? "setNull" : never);
}

/**
 * Link between two collections: a field of child rows holds an id of a parent row.
 * It is data, create it with `relation(...)` and give it to `createStore`
 */
export interface Relation {
  readonly child: CollectionLike;
  readonly field: string;
  readonly parent: CollectionLike;
  readonly onDelete: OnDelete;
}

/**
 * Error thrown when changes would break a relation. The transaction is rolled back
 */
export class IntegrityError extends Error {
  constructor(
    readonly code: "missing-reference" | "restricted" | "rule-loop",
    message: string
  ) {
    super(message);
    this.name = "IntegrityError";
  }
}

/**
 * Declares that `field` of rows of `child` holds an id of a row of `parent`, like a foreign key.
 * The field type must fit the id type of the parent.
 * @example relation(credits, "userId", users, { onDelete: "cascade" })
 */
export function relation<
  CRow extends object,
  CKey extends IdKeys<CRow>,
  PRow extends object,
  PKey extends IdKeys<PRow>,
  F extends FkFields<CRow, PRow[PKey]>
>(
  child: Collection<CRow, CKey>,
  field: F,
  parent: Collection<PRow, PKey>,
  options: RelationOptions<CRow[F]> = {}
): Relation {
  return {
    child,
    field,
    parent,
    onDelete: options.onDelete ?? "restrict",
  };
}

/** @internal */
export type Dict = RowMap<object>;

/**
 * What the checks of relations need to know about the store
 * @internal
 */
export interface RelationContext {
  rows(collection: CollectionLike): Dict;
  /** Rows of the collection whose field is the given value written as text */
  lookup(collection: CollectionLike, field: string, value: string): object[];
  removeMany(collection: CollectionLike, ids: readonly (string | number)[]): void;
  setField(
    collection: CollectionLike,
    ids: readonly (string | number)[],
    field: string,
    value: unknown
  ): void;
  nameOf(collection: CollectionLike): string;
}

/**
 * Keys of the rows that were in `before` and are not in `after`
 */
function removedKeys(before: Dict, after: Dict): string[] {
  const removed: string[] = [];
  diffRows(before, after, (key, was, now) => {
    if (was !== undefined && now === undefined) removed.push(key);
  });
  return removed;
}

/**
 * Applies `cascade` and `setNull` for the parents that were removed between `last` and `now`
 * @internal
 */
export function cascadeRelations(
  relations: readonly Relation[],
  ctx: RelationContext,
  last: ReadonlyMap<CollectionLike, Dict>,
  now: ReadonlyMap<CollectionLike, Dict>
) {
  for (const rel of relations) {
    if (rel.onDelete === "restrict") continue;
    const before = last.get(rel.parent)!;
    const after = now.get(rel.parent)!;
    if (before === after) continue;

    const ids: (string | number)[] = [];
    for (const key of removedKeys(before, after)) {
      for (const row of ctx.lookup(rel.child, rel.field, key)) {
        ids.push((row as Record<string, string | number>)[rel.child.key]);
      }
    }
    if (ids.length === 0) continue;

    if (rel.onDelete === "cascade") {
      ctx.removeMany(rel.child, ids);
    } else {
      ctx.setField(rel.child, ids, rel.field, null);
    }
  }
}

/**
 * Checks `restrict` and that every reference leads to a row, comparing the rows with
 * what they were before the transaction. Throws `IntegrityError`
 * @internal
 */
export function validateRelations(
  relations: readonly Relation[],
  ctx: RelationContext,
  origin: ReadonlyMap<CollectionLike, Dict>
) {
  for (const rel of relations) {
    const parentBefore = origin.get(rel.parent)!;
    const parentNow = ctx.rows(rel.parent);
    const childBefore = origin.get(rel.child)!;
    const childNow = ctx.rows(rel.child);

    if (rel.onDelete === "restrict" && parentBefore !== parentNow) {
      for (const key of removedKeys(parentBefore, parentNow)) {
        const blocking = ctx.lookup(rel.child, rel.field, key);
        if (blocking.length > 0) {
          throw new IntegrityError(
            "restricted",
            `Can not remove ${ctx.nameOf(rel.parent)}["${key}"]: ${blocking.length} row(s) of ${ctx.nameOf(rel.child)} refer to it by ${rel.field}`
          );
        }
      }
    }

    if (childBefore === childNow) continue;
    diffRows(childBefore, childNow, (key, _before, row) => {
      if (row === undefined) return;
      const value = (row as Record<string, unknown>)[rel.field];
      if (value != null && !parentNow.has(String(value))) {
        throw new IntegrityError(
          "missing-reference",
          `${ctx.nameOf(rel.child)}["${key}"].${rel.field} = "${String(value)}": there is no such row in ${ctx.nameOf(rel.parent)}`
        );
      }
    });
  }
}
