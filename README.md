# rawstate

**Raw state, kept honest.** Your data stays raw: plain objects, rows and values that you can print, compare, serialize and send anywhere. rawstate does not wrap it. It puts the guarantees around it: types, atomic changes, references that stay valid, borders that are checked.

```
npm i rawstate
```

No dependencies, about 9 KB gzipped, works in browsers and Node.

## The idea

Most state libraries wrap your data in something: observables, proxies, classes, a store object with hidden machinery. rawstate does the opposite. The state is **raw**, and what is around it is a few things you **declare** instead of writing by hand:

1. **State is data.** Plain objects and arrays, frozen in development so nothing changes them by accident. A snapshot of the whole store is just JSON.
2. **One way to change it.** An action returns what changes, nothing else writes. A wrong key or a wrong type does not compile.
3. **Relations are declared, not wired by hand.** Instead of effects that keep two lists in step, you say how things relate (a credit belongs to a user, a debt is the sum of credits), like a schema in a database, and the store keeps it true.
4. **Changes are atomic.** A transaction is all or nothing, and subscribers are told once, when everything is already written.
5. **The borders are checked.** Data from a server, a storage or another tab comes with a mark of where it came from and is checked by your schema. It is never trusted blindly and never counted twice.
6. **Small and fast.** A change costs the same in 100 rows and in 100 000.

## A small example

```ts
import { createSlice, createStore } from "rawstate";

const counter = createSlice({
  state: { count: 0 },
  actions: {
    increment: (state, by: number) => ({ count: state.count + by }),
  },
});

const store = createStore({ counter });

counter.actions.increment(2);              // arguments and result are checked by types
counter.getState("count").get();           // 2
counter.getState("count").subscribe((n) => console.log(n));
```

An action gets the current (read-only) state and returns **what changes**. That is the only way to write.

## Data with links

```ts
import { createCollection, createStore, relation, increment } from "rawstate";

const users = createCollection<User>()({ key: "id" });
const credits = createCollection<Credit>()({ key: "id" });

const store = createStore(
  { users, credits },
  {
    // a credit must belong to a user; removing a user removes his credits
    relations: [relation(credits, "userId", users, { onDelete: "cascade" })],
    // the debt of a user follows his credits: added, changed, removed
    rules: [increment(users, "debt").from(credits, { to: (c) => c.userId, by: (c) => c.amount })],
    // one operation over several collections, all or nothing
    transactions: {
      openCredit: (s, userId: string, amount: number) => {
        s.credits.actions.add({ id: nextId(), userId, amount });
      },
    },
  }
);

store.transactions.openCredit("ann", 100);   // the debt of Ann is 100 now
credits.where("userId", "ann");              // found by an index, not by a scan
```

Collections are tables with an id: ready actions, one row to watch, an index on any field. Relations are checked when a transaction ends, so the order of changes inside it does not matter, and any violation rolls everything back.

## With React

```
npm i rawstate-react
```

```tsx
import { useObserver, useAction } from "rawstate-react";

function Counter() {
  const count = useObserver(counter, "count");          // rerenders only when `count` changes
  const increment = useAction(counter, "increment");
  return <button onClick={() => increment(1)}>{count}</button>;
}
```

## What is in it

- **Slices**: typed states and actions; async actions that can not lose an update ([docs](docs/slices.md)).
- **Collections**: tables with an id, `where` and `by` through indexes, one row to watch ([docs](docs/collections.md)).
- **Relations and rules**: references that stay valid, cascades, counters and sums that follow the data ([docs](docs/relations-and-rules.md)).
- **Transactions**: all or nothing, one notification, named transactions ([docs](docs/transactions-and-sync.md)).
- **Data from outside**: the server, storage and other tabs are marked by where they came from ([docs](docs/transactions-and-sync.md)).
- **Validation**: any [Standard Schema](https://standardschema.dev) (zod, valibot, arktype) at the borders ([docs](docs/validation.md)).
- **Many stores**: blueprints, snapshots, `dispose`, server rendering ([docs](docs/stores-and-ssr.md)).
- **Fast**: one change in 100 000 rows takes microseconds ([numbers](docs/performance.md)).

Also: [`rawstate-react`](https://www.npmjs.com/package/rawstate-react) (hooks) and [`rawstate-idb`](https://www.npmjs.com/package/rawstate-idb) (save to IndexedDB, keep tabs in sync).

## Live demo

Every feature running in the browser, with a log of each change: [rawstate-demo](https://github.com/selbstnull/rawstate-demo).

## Documentation

[Getting started](docs/getting-started.md) · [Slices](docs/slices.md) · [Collections](docs/collections.md) · [Relations and rules](docs/relations-and-rules.md) · [Transactions and sync](docs/transactions-and-sync.md) · [Validation](docs/validation.md) · [Stores and SSR](docs/stores-and-ssr.md) · [Testing](docs/testing.md) · [Performance](docs/performance.md) · [API](docs/api.md)

## Requirements

TypeScript 5 is recommended: the types are the main interface. Works in browsers and Node 18+, no DOM needed.

## License

Apache-2.0
