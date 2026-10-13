import type { CollectionChanges, Origin } from "../types/store.types";
import type {
  StandardSchemaV1,
  ValidateMode,
  ValidationOptions,
} from "../types/schema.types";
import type {
  CollectionActions,
  CollectionInternals,
  CollectionLike,
  IdKeys,
} from "../types/collection.types";
import type { Readable } from "../types/readable.types";
import type { Actions, DeepReadonly } from "../types/slice.types";
import { ATTACH, CELLS, CHECK, DISPOSE, INTERNALS, RUN, UNTRACKED } from "./internal";
import { deepEqual } from "./equal";
import { diffRows, emptyRows, type RowMap } from "./Rows";
import { Slice } from "./Slice";
import { TxManager } from "./Transaction";
import { parseWith, ValidationError } from "./validate";
import { view, viewFamily, ViewOptions } from "./View";

type Id = string | number;
type Rows = RowMap<object>;
type CollectionState = { byId: Rows; ids: Id[] };
type Snapshot = DeepReadonly<CollectionState>;
type Change = { byId?: Rows; ids?: readonly Id[] };

function checkId(value: unknown): Id {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("Id of a row must be a string or a number");
  }
  if (value === "__proto__") throw new Error('"__proto__" can not be an id');
  return value;
}

/**
 * Checks a row against the schema and gives the row the schema gives out
 */
type RowCheck = (row: object) => object;

const noCheck: RowCheck = (row) => row;

function schemaCheck(
  schema: NonNullable<ValidationOptions<object>["schema"]>,
  key: string
): RowCheck {
  return (row) => {
    const id = (row as Record<string, unknown>)?.[key];
    const what = typeof id === "string" || typeof id === "number" ? `row "${id}"` : "row";
    const output = parseWith(schema, row, what);
    if (typeof output !== "object" || output === null) {
      throw new ValidationError(
        [{ message: "The schema must give out an object", path: "" }],
        what
      );
    }
    return output;
  };
}

function insert(
  key: string,
  state: Snapshot,
  rows: readonly object[],
  mode: "add" | "upsert",
  check: RowCheck
): Change {
  let ids: Id[] | undefined;
  const byId = state.byId.edit((draft) => {
    draft.reserve(rows.length);
    for (const given of rows) {
      const row = check(given);
      const id = checkId((row as Record<string, unknown>)[key]);
      const k = String(id);
      if (!draft.has(k)) {
        (ids ??= state.ids.slice()).push(id);
      } else if (mode === "add") {
        throw new Error(`Row with id "${k}" already exists`);
      }
      draft.set(k, row);
    }
  });
  return ids ? { byId, ids } : { byId };
}

/**
 * The ids without the removed ones. One id is found by a quick search, the copy is made by the engine
 */
function withoutIds(ids: readonly Id[], gone: ReadonlySet<string>): Id[] {
  if (gone.size === 1) {
    const [key] = gone;
    let at = ids.indexOf(key);
    if (at < 0 && String(Number(key)) === key) at = ids.indexOf(Number(key));
    if (at >= 0) return ids.slice(0, at).concat(ids.slice(at + 1));
  }
  return ids.filter((id) => !gone.has(String(id)));
}

function removeIds(state: Snapshot, ids: readonly Id[]): Change {
  const gone = new Set<string>();
  for (const id of ids) {
    const k = String(id);
    if (state.byId.has(k)) gone.add(k);
  }
  if (gone.size === 0) return {};
  return {
    byId: state.byId.edit((draft) => gone.forEach((k) => draft.delete(k))),
    ids: withoutIds(state.ids, gone),
  };
}

/**
 * The row with the patch applied, or null if the patch changes nothing
 */
function patchRow(
  key: string,
  s: Snapshot,
  id: Id,
  change: object | ((row: object) => object),
  check: RowCheck
): { k: string; next: object } | null {
  const k = String(id);
  const row = s.byId.get(k) as Record<string, unknown> | undefined;
  if (!row) throw new Error(`Row with id "${k}" does not exist`);

  const patch = (typeof change === "function" ? change(row) : change) as Record<
    string,
    unknown
  >;
  if (
    Object.prototype.hasOwnProperty.call(patch, key) &&
    !Object.is(patch[key], row[key])
  ) {
    throw new Error(`Id of the row "${k}" can not be changed`);
  }
  const changed = Object.keys(patch).some(
    (field) => !Object.is(patch[field], row[field])
  );
  return changed ? { k, next: check({ ...row, ...patch }) } : null;
}

const sameIds = (a: readonly Id[], b: readonly Id[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * `local` checks what actions of the app give, `boundary` checks what comes from outside.
 * Without a schema both do nothing
 */
function makeActions(key: string, local: RowCheck, boundary: RowCheck) {
  return {
    add: (s: Snapshot, row: object) => insert(key, s, [row], "add", local),
    addMany: (s: Snapshot, rows: readonly object[]) =>
      insert(key, s, rows, "add", local),
    upsert: (s: Snapshot, row: object) => insert(key, s, [row], "upsert", local),
    update: (
      s: Snapshot,
      id: Id,
      change: object | ((row: object) => object)
    ): Change => {
      const result = patchRow(key, s, id, change, local);
      return result ? { byId: s.byId.set(result.k, result.next) } : {};
    },
    updateMany: (
      s: Snapshot,
      ids: readonly Id[],
      change: object | ((row: object) => object)
    ): Change => {
      const byId = s.byId.edit((draft) => {
        for (const id of ids) {
          const result = patchRow(key, s, id, change, local);
          if (result) draft.set(result.k, result.next);
        }
      });
      return byId === s.byId ? {} : { byId };
    },
    remove: (s: Snapshot, id: Id) => removeIds(s, [id]),
    removeMany: (s: Snapshot, ids: readonly Id[]) => removeIds(s, ids),
    replaceAll: (_s: Snapshot, rows: readonly object[]) =>
      insert(key, { byId: emptyRows(), ids: [] }, rows, "add", local),
    /**
     * Replaces all the rows with rows that came from outside, for example from storage
     */
    load: (_s: Snapshot, rows: readonly object[]) =>
      insert(key, { byId: emptyRows(), ids: [] }, rows, "add", boundary),
    clear: (): Change => ({ byId: emptyRows(), ids: [] }),
    /**
     * The rows are the list from outside. Rows that did not change keep their objects, so nobody
     * who watches them is notified. `replace` removes the rows that are not in the list
     */
    reconcile: (
      s: Snapshot,
      rows: readonly object[],
      mode: "replace" | "merge",
      check = true
    ): Change => {
      const incoming: Id[] = [];
      const seen = new Set<string>();
      const changed: [string, object][] = [];
      const added: Id[] = [];
      let known = 0;

      for (const given of rows) {
        const row = check ? boundary(given) : given;
        const id = checkId((row as Record<string, unknown>)[key]);
        const k = String(id);
        if (seen.has(k)) throw new Error(`Row with id "${k}" is in the list twice`);
        seen.add(k);
        incoming.push(id);

        const old = s.byId.get(k);
        if (old === undefined) added.push(id);
        else known++;
        if (old === undefined || !deepEqual(old, row)) changed.push([k, row]);
      }

      // rows that were there and are not in the list
      let removed: string[] = [];
      if (mode === "replace" && s.byId.size > known) {
        removed = s.byId.keys().filter((k) => !seen.has(k));
      }

      const change: Change = {};
      if (changed.length > 0 || removed.length > 0) {
        change.byId = s.byId.edit((draft) => {
          changed.forEach(([k, row]) => draft.set(k, row));
          removed.forEach((k) => draft.delete(k));
        });
      }
      const ids = mode === "replace" ? incoming : added.length > 0 ? s.ids.concat(added) : s.ids;
      if (!sameIds(ids, s.ids)) change.ids = ids;
      return change;
    },
    /**
     * Changes of rows that came from outside, for example from another tab
     */
    applyChanges: (s: Snapshot, changes: CollectionChanges): Change => {
      const added: Id[] = [];
      const gone = new Set<string>();

      const byId = s.byId.edit((draft) => {
        for (const given of changes.upserted ?? []) {
          const row = boundary(given);
          const id = checkId((row as Record<string, unknown>)[key]);
          const k = String(id);
          if (!draft.has(k)) added.push(id);
          draft.set(k, row);
        }
        for (const id of changes.removed ?? []) {
          const k = String(id);
          if (draft.has(k)) {
            draft.delete(k);
            gone.add(k);
          }
        }
      });

      let ids: readonly Id[] = s.ids;
      if (added.length > 0 || gone.size > 0) {
        ids = withoutIds(s.ids.concat(added), gone);
      }
      if (changes.ids) {
        const order = changes.ids.filter((id) => byId.has(String(id)));
        const listed = new Set(order.map(String));
        ids = [...order, ...ids.filter((id) => !listed.has(String(id)))];
      }

      const change: Change = {};
      if (byId !== s.byId) change.byId = byId;
      if (!sameIds(ids, s.ids)) change.ids = ids;
      return change;
    },
  };
}

type CollectionImpl = ReturnType<typeof makeActions>;

/**
 * Actions of the inner slice as they are called: without the state argument
 */
interface InnerActions {
  reconcile(rows: readonly object[], mode: "replace" | "merge", check?: boolean): void;
  applyChanges(changes: CollectionChanges): void;
  replaceAll(rows: readonly object[]): void;
  load(rows: readonly object[]): void;
  removeMany(ids: readonly Id[]): void;
  updateMany(ids: readonly Id[], change: object): void;
}

/**
 * The name of a group of an index: the value and its kind. Only simple values can be looked for
 */
function groupOf(value: unknown): string | undefined {
  switch (typeof value) {
    case "string":
      return `s:${value}`;
    case "number":
      return `d:${value}`;
    case "boolean":
      return `b:${value}`;
    case "bigint":
      return `i:${value}`;
    case "undefined":
      return "u:";
    case "object":
      return value === null ? "n:" : undefined;
    default:
      return undefined;
  }
}

/**
 * Rows grouped by the value of one field. It is a cache over the rows: it is brought up to date
 * when it is asked, from what changed since the last time, so changes that are rolled back or made
 * by many transactions are no problem, and nothing is spent while nobody asks
 */
class FieldIndex {
  private readonly groups = new Map<string, Set<string>>();
  private last: Rows | null = null;

  constructor(private readonly field: string) {}

  private put(group: string | undefined, key: string) {
    if (group === undefined) return;
    let keys = this.groups.get(group);
    if (!keys) this.groups.set(group, (keys = new Set()));
    keys.add(key);
  }

  private drop(group: string | undefined, key: string) {
    if (group === undefined) return;
    const keys = this.groups.get(group);
    if (!keys) return;
    keys.delete(key);
    if (keys.size === 0) this.groups.delete(group);
  }

  upTo(rows: Rows, ids: readonly Id[]) {
    if (this.last === rows) return;
    const field = this.field;
    const groupIn = (row: object | undefined) =>
      row === undefined ? undefined : groupOf((row as Record<string, unknown>)[field]);

    if (this.last === null) {
      // in the order of the collection
      for (const id of ids) {
        const key = String(id);
        this.put(groupIn(rows.get(key)), key);
      }
    } else {
      const arrived: string[] = [];
      diffRows(this.last, rows, (key, before, after) => {
        const was = groupIn(before);
        if (before && after && was === groupIn(after)) return;
        this.drop(was, key);
        if (after) arrived.push(key);
      });
      if (arrived.length === 1) {
        this.put(groupIn(rows.get(arrived[0])), arrived[0]);
      } else if (arrived.length > 1) {
        // several at once: they get in the group in the order of the collection
        const wanted = new Set(arrived);
        for (const id of ids) {
          const key = String(id);
          if (wanted.has(key)) this.put(groupIn(rows.get(key)), key);
        }
      }
    }
    this.last = rows;
  }

  keys(group: string): ReadonlySet<string> | undefined {
    return this.groups.get(group);
  }
}

const sameRows = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((row, i) => row === b[i]);

/**
 * Table of rows with an id. Rows are stored by id and in the order of adding.
 * Reading and changing it is as simple as it is in a table, and it is a part of the store:
 * its actions join transactions of the store
 */
export class Collection<Row extends object, Key extends IdKeys<Row>>
  implements CollectionLike
{
  private readonly slice: Slice<CollectionState, CollectionImpl & Actions<CollectionState>>;
  private readonly rowMap: Readable<Rows>;
  private readonly idList: Readable<readonly Id[]>;
  private latestSync = 0;
  private readonly boundary: RowCheck;
  private readonly validates: boolean;
  private readonly rowViews: ((id: Id) => Readable<unknown>) & { clear(): void };
  private readonly indexes = new Map<string, FieldIndex>();
  private readonly groupViews = new Map<string, Readable<unknown>>();

  /**
   * Actions that change the collection
   */
  readonly actions: CollectionActions<Row, Key>;
  /**
   * All the rows in the order they were added. Changes when any row changes
   */
  readonly rows: Readable<readonly DeepReadonly<Row>[]>;
  /**
   * Number of rows
   */
  readonly size: Readable<number>;

  /**
   * @param key Field of a row that is its id
   * @param initial Rows the collection starts with
   * @param options `schema` that rows from outside are checked against (any Standard Schema)
   * and when to check: `boundary` (default) or `always`; `indexes` to build at once
   */
  constructor(
    readonly key: Key,
    initial: readonly DeepReadonly<Row>[] = [],
    options: ValidationOptions<Row> & { indexes?: readonly (keyof Row & string)[] } = {}
  ) {
    const boundary = options.schema
      ? schemaCheck(options.schema as never, key)
      : noCheck;
    this.boundary = boundary;
    this.validates = options.schema !== undefined;
    const local = options.validate === "always" ? boundary : noCheck;
    const impl = makeActions(key, local, boundary);
    const first = insert(
      key,
      { byId: emptyRows(), ids: [] },
      initial,
      "add",
      boundary
    );
    const start: CollectionState = { byId: first.byId!, ids: [...(first.ids ?? [])] };
    this.slice = new Slice<CollectionState, CollectionImpl & Actions<CollectionState>>(
      start,
      impl as never
    );
    // all actions of a collection are synchronous: nothing can get out of date
    this.slice[UNTRACKED]();
    this.actions = this.slice.actions as unknown as CollectionActions<Row, Key>;

    this.rowMap = this.slice.getState("byId") as unknown as Readable<Rows>;
    const ids = this.slice.getState("ids");
    this.idList = ids;
    this.rows = view([ids, this.rowMap], (list, byId) =>
      list.map((id) => byId.get(String(id)))
    ) as unknown as Collection<Row, Key>["rows"];
    this.size = view([ids], (list) => list.length);
    this.rowViews = viewFamily((id: Id) =>
      view([this.rowMap], (byId) => byId.get(String(id)))
    );
    options.indexes?.forEach((field) => this.index(field));
  }

  /**
   * Current row, `undefined` if there is no such row
   */
  get(id: Row[Key]): DeepReadonly<Row> | undefined {
    return this.rowMap.get().get(String(checkId(id))) as DeepReadonly<Row> | undefined;
  }

  has(id: Row[Key]): boolean {
    return this.rowMap.get().has(String(checkId(id)));
  }

  /**
   * Current rows in the order they were added
   */
  all(): readonly DeepReadonly<Row>[] {
    return this.rows.get();
  }

  /**
   * One row to watch. A component that watches it is notified only when this row changes.
   * The same id gives the same object
   */
  row(id: Row[Key]): Readable<DeepReadonly<Row> | undefined> {
    return this.rowViews(checkId(id)) as Readable<DeepReadonly<Row> | undefined>;
  }

  private index(field: string): FieldIndex {
    let found = this.indexes.get(field);
    if (!found) this.indexes.set(field, (found = new FieldIndex(field)));
    found.upTo(this.rowMap.get(), this.idList.get());
    return found;
  }

  private rowsOf(keys: Iterable<string> | undefined): object[] {
    const rows = this.rowMap.get();
    const found: object[] = [];
    if (keys) for (const k of keys) found.push(rows.get(k)!);
    return found;
  }

  /**
   * The rows whose field has this value. The first call for a field builds an index, after that
   * it costs as much as the number of rows found, not as the size of the collection.
   * Only simple values (text, number, boolean, null, undefined) can be looked for.
   * The order of the rows is not guaranteed: it is the order of the collection when the index is built,
   * after that rows that came into the group later are at its end. To have an order, sort the result
   * @example credits.where("userId", "u1")
   */
  where<F extends keyof Row & string>(
    field: F,
    value: Row[F]
  ): readonly DeepReadonly<Row>[] {
    const group = groupOf(value);
    if (group === undefined) return [];
    return this.rowsOf(this.index(field).keys(group)) as DeepReadonly<Row>[];
  }

  /**
   * The same rows as `where`, to watch. It tells only when the group changes: a row came, went
   * or changed, rows of other groups do not matter. The same arguments give the same object
   * @example const list = useReadable(credits.by("userId", id))
   */
  by<F extends keyof Row & string>(
    field: F,
    value: Row[F]
  ): Readable<readonly DeepReadonly<Row>[]> {
    const group = groupOf(value);
    const name = `${field}\u0000${group}`;
    let found = this.groupViews.get(name);
    if (!found) {
      found = view([this.rowMap], () => this.where(field, value), {
        equals: sameRows,
      });
      this.groupViews.set(name, found);
    }
    return found as Readable<readonly DeepReadonly<Row>[]>;
  }

  /**
   * Value calculated from all the rows, for example a filtered list or a sum
   * @example const adults = users.select((rows) => rows.filter((u) => u.age >= 18))
   */
  select<R>(
    fn: (rows: readonly DeepReadonly<Row>[]) => R,
    options?: ViewOptions<R>
  ): Readable<R> {
    return view([this.rows], fn, options);
  }

  /**
   * Takes the list of rows that came from the server. Everything is one transaction with origin
   * `remote`; rows that did not change keep their objects, so components that watch them do not rerender.
   * - `replace` (default): the list is the whole truth, rows that are not in it are removed and the order is the list order
   * - `merge`: rows are added and updated, the others stay
   * Rules and relations are not run for this data (it is trusted), pass `trusted: false` to run them.
   * With a schema every row is checked: one that does not fit rejects the whole list and changes nothing
   * (`ValidationError`), or with `onInvalid: "skip"` it is left out and `onSkip` is told
   */
  sync(rows: readonly DeepReadonly<Row>[], options: SyncOptions = {}): void {
    const actions = this.slice.actions as unknown as InnerActions;
    let list = rows as readonly object[];
    let checked = false;
    if (this.validates && options.onInvalid === "skip") {
      // a row that does not fit the schema is left out, as if the server did not send it
      const valid: object[] = [];
      for (const row of list) {
        try {
          valid.push(this.boundary(row));
        } catch (error) {
          if (!(error instanceof ValidationError)) throw error;
          options.onSkip?.(row, error);
        }
      }
      list = valid;
      checked = true;
    }
    this.slice[RUN](
      () => actions.reconcile(list, options.mode ?? "replace", !checked),
      { origin: options.origin ?? "remote", trusted: options.trusted ?? true }
    );
  }

  /**
   * Gets the rows with `fetcher` and takes them with `sync`. If another `syncFrom` started while this
   * one was waiting, the result of this one is dropped, so an old answer never replaces a newer one.
   * @returns `true` if the rows were taken, `false` if the answer was outdated
   */
  async syncFrom(
    fetcher: () => Promise<readonly DeepReadonly<Row>[]>,
    options: SyncOptions = {}
  ): Promise<boolean> {
    const turn = ++this.latestSync;
    const rows = await fetcher();
    if (turn !== this.latestSync) return false;
    this.sync(rows, options);
    return true;
  }

  snapshot() {
    return this.slice.snapshot();
  }

  /**
   * @internal
   */
  [CHECK](values: Record<string, unknown>) {
    return values;
  }

  /**
   * @internal
   */
  [DISPOSE]() {
    // an answer of the server that is still on its way is not taken any more
    this.latestSync++;
    this.rowViews.clear();
    this.groupViews.clear();
    this.indexes.clear();
    this.slice[DISPOSE]();
  }

  /**
   * @internal
   */
  [ATTACH](tx: TxManager) {
    this.slice[ATTACH](tx);
  }

  /**
   * @internal
   */
  [CELLS]() {
    return this.slice[CELLS]();
  }

  /**
   * @internal
   */
  [RUN]<R>(fn: () => R, options?: Parameters<typeof this.slice[typeof RUN]>[1]): R {
    return this.slice[RUN](fn, options);
  }

  /**
   * @internal
   */
  [INTERNALS](): CollectionInternals {
    const cells = this.slice[CELLS]();
    const inner = this.slice.actions as unknown as InnerActions;
    return {
      key: this.key,
      cell: cells.get("byId")!,
      idsCell: cells.get("ids")!,
      ids: () => this.idList.get(),
      rows: () => this.rowMap.get(),
      lookup: (field, value) => {
        const index = this.index(field);
        return [
          ...this.rowsOf(index.keys(`s:${value}`)),
          ...this.rowsOf(index.keys(`d:${value}`)),
        ];
      },
      replaceAll: (rows) => inner.load(rows),
      applyChanges: (changes) => inner.applyChanges(changes),
      removeMany: (ids) => inner.removeMany(ids),
      setField: (ids, field, value) => inner.updateMany(ids, { [field]: value }),
    };
  }
}

/**
 * Options of `sync` and `syncFrom`
 */
export interface SyncOptions {
  /** `replace` (default): the list is the whole truth. `merge`: add and update, keep the others */
  mode?: "replace" | "merge";
  /** Run rules and relations for this data. `true` (not run) by default */
  trusted?: boolean;
  origin?: Origin;
  /** What to do with a row that does not fit the schema: reject everything (default) or leave it out */
  onInvalid?: "throw" | "skip";
  /** Called for every row that was left out */
  onSkip?: (row: unknown, error: ValidationError) => void;
}

type CollectionDefinition<Row, Key> = {
  key: Key;
  rows?: readonly DeepReadonly<Row>[];
  /** Any Standard Schema (zod, valibot, arktype...) for a row. Rows from outside are checked against it */
  schema?: ValidationOptions<Row>["schema"];
  /** `boundary` (default): data from outside; `always`: results of actions too */
  validate?: ValidateMode;
  /** Fields to build an index for at once. An index is also built by the first `where` or `by` of a field */
  indexes?: readonly (keyof Row & string)[];
};

/**
 * Creates a collection. Describe the row with a type, the key field is checked against it:
 * @example const users = createCollection<User>()({ key: "id" })
 * or let the row type be inferred from the initial rows:
 * @example const users = createCollection({ key: "id", rows: [{ id: "a", name: "A" }] })
 */
export function createCollection<Row extends object>(): <
  Key extends IdKeys<Row>
>(
  definition: CollectionDefinition<Row, Key>
) => Collection<Row, Key>;
export function createCollection<
  Row extends object,
  Key extends IdKeys<Row>
>(definition: {
  key: Key;
  schema: StandardSchemaV1<unknown, Row>;
  rows?: readonly NoInfer<DeepReadonly<Row>>[];
  validate?: ValidateMode;
  indexes?: readonly (keyof NoInfer<Row> & string)[];
}): Collection<Row, Key>;
export function createCollection<
  Row extends object,
  Key extends IdKeys<Row>
>(definition: {
  key: Key;
  rows: readonly Row[];
  schema?: ValidationOptions<NoInfer<Row>>["schema"];
  validate?: ValidateMode;
  indexes?: readonly (keyof NoInfer<Row> & string)[];
}): Collection<Row, Key>;
export function createCollection(definition?: {
  key: string;
  rows?: readonly object[];
  schema?: ValidationOptions<object>["schema"];
  validate?: ValidateMode;
  indexes?: readonly string[];
}): unknown {
  const create = (def: NonNullable<typeof definition>) =>
    new Collection<object, never>(def.key as never, def.rows as never, {
      schema: def.schema,
      validate: def.validate,
      indexes: def.indexes as never,
    });
  return definition ? create(definition) : create;
}
