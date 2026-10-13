import type { INTERNALS } from "../common/internal";
import type { RowMap } from "../common/Rows";
import type { CollectionChanges } from "./store.types";
import type { DeepReadonly, SliceLike } from "./slice.types";

/**
 * Keys of a row that can be an id: the field must be string or number
 */
export type IdKeys<Row> = {
  [K in keyof Row]-?: Row[K] extends string | number ? K : never;
}[keyof Row] &
  string;

/**
 * What can be changed in a row by `update`: any field except the id
 */
export type RowPatch<Row, Key extends keyof Row> = {
  [K in Exclude<keyof Row, Key>]?: DeepReadonly<Row[K]>;
};

/**
 * Actions every collection has. Every one is a transaction: it is applied completely or not at all
 */
export interface CollectionActions<Row, Key extends keyof Row> {
  /** Adds the row. Throws if a row with this id is already there */
  add(row: DeepReadonly<Row>): void;
  /** Adds all the rows or none of them */
  addMany(rows: readonly DeepReadonly<Row>[]): void;
  /** Adds the row, or replaces the row with the same id */
  upsert(row: DeepReadonly<Row>): void;
  /**
   * Changes fields of the row, id can not be changed. Throws if there is no such row.
   * Accepts a patch or a function that gets the current row and returns a patch
   */
  update(
    id: Row[Key],
    change:
      | RowPatch<Row, Key>
      | ((row: DeepReadonly<Row>) => RowPatch<Row, Key>)
  ): void;
  /** Changes the same fields in several rows. Throws, and changes nothing, if one of the rows is missing */
  updateMany(
    ids: readonly Row[Key][],
    change:
      | RowPatch<Row, Key>
      | ((row: DeepReadonly<Row>) => RowPatch<Row, Key>)
  ): void;
  /** Removes the row. Does nothing if there is no such row */
  remove(id: Row[Key]): void;
  /** Removes the rows that exist, ignores the others */
  removeMany(ids: readonly Row[Key][]): void;
  /** Replaces all the rows */
  replaceAll(rows: readonly DeepReadonly<Row>[]): void;
  /** Removes all the rows */
  clear(): void;
}

/**
 * What the store needs from a collection to keep relations
 */
export interface CollectionInternals {
  /** Field of a row that is its id */
  readonly key: string;
  /** Observer of all the rows, it is a key in the journal of a transaction */
  readonly cell: object;
  /** Observer of the order of ids */
  readonly idsCell: object;
  /** Current ids in their order */
  ids(): readonly (string | number)[];
  /** Replaces all the rows */
  replaceAll(rows: readonly object[]): void;
  /** Applies changes of rows that came from outside */
  applyChanges(changes: CollectionChanges): void;
  /** Current rows by id */
  rows(): RowMap<object>;
  /**
   * Rows whose field is equal to the value written as text (`"5"` finds `5` and `"5"`).
   * It goes through an index, so it does not look at the other rows
   */
  lookup(field: string, value: string): object[];
  removeMany(ids: readonly (string | number)[]): void;
  setField(ids: readonly (string | number)[], field: string, value: unknown): void;
}

/**
 * A collection of any rows, as relations see it
 */
export interface CollectionLike extends SliceLike {
  readonly key: string;
  /** @internal */
  [INTERNALS](): CollectionInternals;
}
