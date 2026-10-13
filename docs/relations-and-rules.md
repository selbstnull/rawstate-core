# Relations and rules

Both are declared in one place, the options of `createStore` (or `defineStore`). Collections do not know about each other, so they stay simple and can be used and tested on their own.

## Relations

A relation says that a field of one collection holds the id of a row of another, like a foreign key.

```ts
import { createStore, relation } from "rawstate";

const store = createStore(
  { users, credits, payments },
  {
    relations: [
      relation(credits, "userId", users, { onDelete: "cascade" }),
      relation(payments, "creditId", credits),               // the default is "restrict"
    ],
  }
);
```

- The field is checked by types: it must be a field of the child row and its type must fit the id of the parent.
- Every reference must lead to a row. `credits.actions.add({ userId: "nobody", ... })` throws `IntegrityError` and changes nothing. `null` and `undefined` mean "no reference".
- `onDelete` is what happens to rows that refer to a row that is removed:
  - `restrict` (default): the removal fails while such rows exist;
  - `cascade`: they are removed too, through any number of levels;
  - `setNull`: their field becomes `null` (only for fields that can be `null`).
- A collection can refer to itself (a tree with `parentId`).
- Collections of the relation must be in the same store.

**Checked at the end of a transaction**, like deferred constraints in a database. Inside one transaction the order does not matter: add a credit before its user, remove a user after his credits. Cascades are done in the same transaction, so subscribers are told once. Any violation rolls the whole transaction back and throws `IntegrityError` with `code` `"missing-reference"` or `"restricted"`.

## Rules

A rule says how the store reacts to changes. It gets the changed rows and returns **operations** (values, not calls). The store runs them in the same transaction, so the result is applied together with the change or not at all.

### Templates

```ts
import { increment, decrement, rollup, count, sum } from "rawstate";

rules: [
  // the debt grows by the amount of a credit, goes back when it is removed or changed
  increment(users, "debt").from(credits, { to: (c) => c.userId, by: (c) => c.amount }),
  // a payment takes from the debt; without `by` it is 1 per row
  decrement(users, "debt").from(payments, { to: (p) => p.userId, by: (p) => p.amount }),
  // a value that is calculated again from the rows, it can not drift
  rollup(users, "creditCount", count(credits, "userId")),
  rollup(users, "totalCredit", sum(credits, "userId", "amount")),
]
```

- `increment(target, field).from(source, { to, by? })`: a new source row adds `by(row)` (1 by default) to the field of the row `to(row)`; a removed row takes it back; a changed row moves the difference, or the amount to another row if `to` changed. `to` may return `null` for "nobody". `decrement` is the opposite.
- `rollup(target, field, count(child, fk) | sum(child, fk, field))`: the field always equals the count or the sum of the rows that refer to the parent. It is calculated again from the children whenever the parent or the children change, so a hand edit does not hold; existing rows are brought in line when the store is created.
- A target row that is gone (removed by a cascade, for example) is skipped by counters.

Which one? `increment` follows changes and works with any `to`. `rollup` is exact and can not drift, but needs a reference field. A field can have one or the other.

### Your own rules

```ts
import { rule, op } from "rawstate";

rule(credits, {
  inserted: (credit) => [
    op.increment(users, credit.userId, "debt", credit.amount),
    op.update(users, credit.userId, { blocked: true }, { ifMissing: "skip" }),
  ],
  updated: ({ before, after, changed }) =>
    changed.includes("amount") ? op.increment(users, after.userId, "debt", after.amount - before.amount) : undefined,
  removed: (credit) => op.remove(archive, credit.id),
})
```

Handlers return nothing, one operation or a list. Operations: `op.add`, `op.upsert`, `op.update` (throws on a missing row unless `ifMissing: "skip"`), `op.increment` (skips a missing row unless `ifMissing: "throw"`), `op.remove`. They are typed like collection actions.

### How rules run

- Rules and cascades run in passes until nothing changes, so rules can follow each other (a rule changes a row, another reacts to it). A loop is detected and the transaction is rolled back with `IntegrityError` (`code: "rule-loop"`).
- Rules see the **net result** of a transaction: a row added and removed inside it is not seen.
- A rule can change only collections of the same store.
- References are checked after the rules ran, so what rules produce must keep them valid.
- **Trusted data does not run rules.** Data that came from the server, storage or another tab already carries its derived values, so a delta rule would count it twice: see [Transactions and sync](transactions-and-sync.md).
