# rawstate-core

The core of **rawstate**. **Raw state, kept honest.** Your data stays raw: plain objects, rows and values that you can print, compare, serialize and send anywhere. rawstate does not wrap it. It puts the guarantees around it: types, atomic changes, references that stay valid, borders that are checked.

[![npm](https://img.shields.io/npm/v/rawstate-core?color=0a7ea4)](https://www.npmjs.com/package/rawstate-core)
[![gzip size](https://img.shields.io/bundlephobia/minzip/rawstate-core?label=gzip)](https://bundlephobia.com/package/rawstate-core)
[![types](https://img.shields.io/npm/types/rawstate-core)](https://www.npmjs.com/package/rawstate-core)
[![license](https://img.shields.io/npm/l/rawstate-core?color=informational)](LICENSE)

```
npm i rawstate-core
```

No dependencies, about 9 KB gzipped, works in browsers and Node.

> **Support rawstate-core.** It is free and made in spare time. If it saves you time, donations are what keep it going.
> USDT (TRC-20): `TQbts9Bj1LZJQE8oGbSbo1Qg6R3Co2k8jX` ([details](DONATE.md))
>
> <img src="https://raw.githubusercontent.com/selbstnull/rawstate-core/main/.github/donate-usdt-trc20.png" alt="USDT TRC-20 QR code" width="120">

## The idea

Most state libraries wrap your data in something: observables, proxies, classes, a store object with hidden machinery. rawstate does the opposite. The state is **raw**, and what is around it is a few things you **declare** instead of writing by hand:

1. **State is data.** Plain objects and arrays, frozen in development so nothing changes them by accident. A snapshot of the whole store is just JSON.
2. **One way to change it.** An action returns what changes, nothing else writes. A wrong key or a wrong type does not compile.
3. **Relations are declared, not wired by hand.** Instead of effects that keep two lists in step, you say how things relate (a credit belongs to a user, a debt is the sum of credits), like a schema in a database, and the store keeps it true.
4. **Changes are atomic.** A transaction is all or nothing, and subscribers are told once, when everything is already written.
5. **The borders are checked.** Data from a server, a storage or another tab comes with a mark of where it came from and is checked by your schema. It is never trusted blindly and never counted twice.
6. **Small and fast.** A change costs the same in 100 rows and in 100 000 ([numbers](#how-it-compares)).

## A small example

```ts
import { createSlice, createStore } from "rawstate-core";

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
import { createCollection, createStore, relation, increment } from "rawstate-core";

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

## How it compares

Honestly, not a replacement for everything. rawstate is for **data with structure**: tables, references between them, totals that follow the data, changes that must be all or nothing.

| | rawstate | Zustand | Redux Toolkit | MobX / Valtio |
| --- | :---: | :---: | :---: | :---: |
| Wrong key or type in an action does not compile | yes | partly | yes | no |
| Frozen state, no change by accident | yes (dev) | no | yes | no |
| Tables with ids and indexes | yes | by hand | adapter, no indexes | by hand |
| References that stay valid (cascade, restrict) | yes | no | no | no |
| Totals that follow the data (`rollup`, `increment`) | yes | by hand | by hand | `computed` |
| Atomic transaction with rollback | yes | no | one `dispatch` | no rollback |
| A slow async action can not lose an update | yes | no | no | no |
| Data from outside checked by a schema, with its origin | yes | no | no | no |
| Saved to IndexedDB, tabs in sync | `rawstate-idb` | plugins | `redux-persist` | plugins |
| Size, gzipped | 9 KB | 0.2 KB | 11 KB | 1–16 KB |
| One change in 100 000 rows | 0.01 ms | 41 ms | 94 ms | 0.001–1 ms |

Measured against TanStack DB too (see [Performance](docs/performance.md)). The table above is how each library is used out of the box; with plugins and your own code most of "no" can be built.

If your state is a modal, a theme and a few flags, use [Zustand](https://github.com/pmndrs/zustand): it is smaller and simpler. If it is a normalized model of the world that you now keep in step by hand, this is what rawstate is for. Details and the full tables: [Performance](docs/performance.md); the benchmark is in the repository ([`bench-compare`](bench-compare/README.md)).

## What is in it

- **Slices**: typed states and actions; async actions that can not lose an update ([docs](docs/slices.md)).
- **Collections**: tables with an id, `where` and `by` through indexes, one row to watch ([docs](docs/collections.md)).
- **Relations and rules**: references that stay valid, cascades, counters and sums that follow the data ([docs](docs/relations-and-rules.md)).
- **Transactions**: all or nothing, one notification, named transactions ([docs](docs/transactions-and-sync.md)).
- **Data from outside**: the server, storage and other tabs are marked by where they came from ([docs](docs/transactions-and-sync.md)).
- **Validation**: any [Standard Schema](https://standardschema.dev) (zod, valibot, arktype) at the borders ([docs](docs/validation.md)).
- **Many stores**: blueprints, snapshots, `dispose`, server rendering ([docs](docs/stores-and-ssr.md)).
- **Fast**: one change in 100 000 rows takes microseconds ([numbers](docs/performance.md)).

Around it:

| package | what it does |
| --- | --- |
| [`rawstate-react`](https://www.npmjs.com/package/rawstate-react) | hooks and store scopes for React 18 and 19 |
| [`rawstate-idb`](https://www.npmjs.com/package/rawstate-idb) | save to IndexedDB, load at start, keep tabs in sync |
| [`rawstate-devtools`](https://www.npmjs.com/package/rawstate-devtools) | every commit with its origin, time travel, a panel in the page, Redux DevTools |

## Live demo

Every feature running in the browser, with a log of each change: [rawstate-demo](https://github.com/selbstnull/rawstate-demo).

## Documentation

[Getting started](docs/getting-started.md) · [Slices](docs/slices.md) · [Collections](docs/collections.md) · [Relations and rules](docs/relations-and-rules.md) · [Transactions and sync](docs/transactions-and-sync.md) · [Validation](docs/validation.md) · [Stores and SSR](docs/stores-and-ssr.md) · [Testing](docs/testing.md) · [Performance](docs/performance.md) · [API](docs/api.md)

## Versions

rawstate follows [semantic versioning](https://semver.org) from 1.0.0: the API in the [docs](docs/api.md) does not break inside 1.x. The changes are in the [changelog](CHANGELOG.md).

## Requirements

TypeScript 5 is recommended: the types are the main interface. Works in browsers and Node 18+, no DOM needed.

## License

Apache-2.0
