# Collections

A collection is a table of rows with an id: ready actions, reading by id, one row to watch, indexes.

```ts
import { createCollection } from "rawstate";

interface User { id: string; name: string; age: number }

const users = createCollection<User>()({ key: "id" });          // key must be a string or number field
// or let the type be inferred from rows:
// createCollection({ key: "id", rows: [{ id: "a", name: "Ann", age: 30 }] })
```

Collections go into `createStore` next to slices. Their actions join its transactions.

## Changing

```ts
users.actions.add({ id: "u1", name: "Ann", age: 30 });
users.actions.addMany([{ id: "u2", name: "Bob", age: 25 }]);
users.actions.upsert({ id: "u1", name: "Anna", age: 31 });        // add or replace
users.actions.update("u1", { age: 32 });                          // a patch...
users.actions.update("u1", (u) => ({ age: u.age + 1 }));          // ...or a function of the row
users.actions.updateMany(["u1", "u2"], { age: 18 });
users.actions.remove("u1");
users.actions.removeMany(["u1", "u2"]);
users.actions.replaceAll(rows);
users.actions.clear();
```

- `add` throws on an id that exists, `update` on a row that does not exist. `remove` of a missing row does nothing.
- The id can not be changed. `addMany` and `updateMany` are all or nothing.
- Every action is a transaction. Rows are frozen (in development): replace, do not mutate.
- An `update` that changes nothing does not notify anyone and keeps the same row object.

## Reading

```ts
users.get("u1");                    // the row or undefined
users.has("u1");
users.all();                        // all rows in the order they were added
users.size.get();                   // the count, a value to watch
users.rows;                         // all rows, a value to watch
users.row("u1");                    // one row to watch: tells only when this row changes
users.select((rows) => rows.filter((u) => u.age >= 18));    // a calculated value over the rows
```

`row(id)` gives the same object for the same id, so a component that watches it does not rerender when other rows change.

## Finding by a field: indexes

```ts
credits.where("userId", "u1");      // the rows with this value, no scan
credits.by("userId", "u1");         // the same to watch: tells only when this group changes
credits.where("status", null);      // null and undefined can be looked for too

createCollection<Credit>()({ key: "id", indexes: ["userId"] });   // build an index at once
```

- The first `where` or `by` for a field builds an index. After that it is kept up to date by looking only at what changed, so a search costs as much as the number of rows found, not the size of the collection. Relations and `rollup` use the same indexes.
- Only simple values can be looked for: text, number, boolean, `null`, `undefined`. `1` and `"1"` are different values.
- The order of the rows is not guaranteed: it is the order of the collection when the index is built, and rows that came into a group later are at its end. Sort the result when you need an order.

## Rows from the server

```ts
await users.syncFrom(() => api.users());                         // the list is the whole truth
await users.syncFrom(() => api.newUsers(), { mode: "merge" });   // add and update, keep the others
users.sync(rows);                                                // the same when you have the rows
```

Rows that did not change keep their objects, so nobody who watches them is told. If another `syncFrom` started while this one waited, the old answer is dropped. More in [Transactions and sync](transactions-and-sync.md).

## With React

```tsx
import { useRow, useRows } from "rawstate-react";

const user = useRow(users, "u1");        // rerenders only when this row changes
const all = useRows(users);
```
