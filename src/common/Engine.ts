import type {
  CollectionInternals,
  CollectionLike,
} from "../types/collection.types";
import { INTERNALS } from "./internal";
import { diffRows } from "./Rows";
import {
  cascadeRelations,
  Dict,
  IntegrityError,
  Relation,
  RelationContext,
  validateRelations,
} from "./Relation";
import type { Operation, Rule, RowChanges } from "./Rule";
import type { TxContext, TxManager } from "./Transaction";

const MAX_PASSES = 1000;

function diff(before: Dict, after: Dict): RowChanges {
  const changes: RowChanges = { inserted: [], removed: [], updated: [] };
  diffRows(before, after, (_key, was, now) => {
    if (was === undefined && now !== undefined) changes.inserted.push(now);
    else if (was !== undefined && now === undefined) changes.removed.push(was);
    else if (was !== undefined && now !== undefined) {
      changes.updated.push({ before: was, after: now });
    }
  });
  return changes;
}

/**
 * Keeps relations and rules of a store. It runs before commit of every transaction:
 * cascades and rules change data in passes until nothing changes any more,
 * then the references are checked. Any error rolls the transaction back
 * @internal
 */
export class Engine {
  private readonly internals = new Map<CollectionLike, CollectionInternals>();
  private readonly watched = new Set<CollectionLike>();
  private readonly context: RelationContext;

  constructor(
    private readonly names: ReadonlyMap<CollectionLike, string>,
    private readonly relations: readonly Relation[],
    private readonly rules: readonly Rule[]
  ) {
    names.forEach((_, collection) =>
      this.internals.set(collection, collection[INTERNALS]())
    );
    relations.forEach((r) => {
      this.watched.add(r.child);
      this.watched.add(r.parent);
    });
    rules.forEach((rule) => rule.sources.forEach((s) => this.watched.add(s)));

    this.context = {
      rows: (c) => this.dict(c),
      lookup: (c, field, value) => this.internals.get(c)!.lookup(field, value),
      removeMany: (c, ids) => this.internals.get(c)!.removeMany(ids),
      setField: (c, ids, field, value) =>
        this.internals.get(c)!.setField(ids, field, value),
      nameOf: (c) => this.names.get(c) ?? "collection",
    };
  }

  private dict(collection: CollectionLike): Dict {
    return this.internals.get(collection)!.rows();
  }

  private run(operation: Operation) {
    if (!this.names.has(operation.collection)) {
      throw new Error("A rule changes a collection that is not in the store");
    }
    operation.run();
  }

  private ruleName(rule: Rule) {
    return rule.name ?? `rule on ${this.context.nameOf(rule.sources[0])}`;
  }

  /**
   * Brings the data in line with the rules that keep values (rollup), when the store is created
   */
  reconcile(tx: TxManager) {
    tx.run(() => {
      for (const rule of this.rules) {
        rule.initial?.().forEach((operation) => this.run(operation));
      }
    });
  }

  guard = (journal: ReadonlyMap<object, unknown>, context: TxContext) => {
    // trusted data was already calculated and checked where it came from
    if (context.trusted) return;
    const watchedTouched = [...this.watched].some((c) =>
      journal.has(this.internals.get(c)!.cell)
    );
    if (!watchedTouched) return;

    const all = [...this.names.keys()];
    const snapshot = () => new Map(all.map((c) => [c, this.dict(c)]));
    const origin = new Map(
      all.map((c) => {
        const cell = this.internals.get(c)!.cell;
        return [c, (journal.has(cell) ? journal.get(cell) : this.dict(c)) as Dict];
      })
    );

    let last = origin;
    for (let pass = 1; ; pass++) {
      const now = snapshot();
      const fired: string[] = [];

      cascadeRelations(this.relations, this.context, last, now);

      const diffs = new Map<CollectionLike, RowChanges | null>();
      const changesOf = (c: CollectionLike) => {
        if (!diffs.has(c)) {
          const before = last.get(c)!;
          const after = now.get(c)!;
          diffs.set(c, before === after ? null : diff(before, after));
        }
        return diffs.get(c)!;
      };

      for (const rule of this.rules) {
        const changes = new Map<CollectionLike, RowChanges>();
        for (const source of rule.sources) {
          const found = changesOf(source);
          if (found) changes.set(source, found);
        }
        if (changes.size === 0) continue;

        const operations = rule.react(changes);
        if (operations.length > 0) fired.push(this.ruleName(rule));
        operations.forEach((operation) => this.run(operation));
      }

      const after = snapshot();
      if (all.every((c) => after.get(c) === now.get(c))) break;
      if (pass >= MAX_PASSES) {
        throw new IntegrityError(
          "rule-loop",
          `Rules and cascades did not settle after ${MAX_PASSES} passes. Last active rules: ${
            [...new Set(fired)].join(", ") || "none, check cascade relations"
          }`
        );
      }
      last = now;
    }

    validateRelations(this.relations, this.context, origin);
  };
}
