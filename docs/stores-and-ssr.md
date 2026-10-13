# Many stores, server rendering and cleanup

`createStore` makes one store from slice instances, and a slice can belong to only one store. When you need many stores (one per request on a server, per test, per session, per mounted module) describe the store once with `defineStore`.

```ts
import { defineStore, createCollection, relation, rollup, sum } from "rawstate-core";

export const appStore = defineStore({
  slices: () => ({                                    // new slices for every store
    users: createCollection<User>()({ key: "id" }),
    credits: createCollection<Credit>()({ key: "id" }),
  }),
  relations: (s) => [relation(s.credits, "userId", s.users, { onDelete: "cascade" })],
  rules: (s) => [rollup(s.users, "debt", sum(s.credits, "userId", "amount"))],
  transactions: {
    openCredit: (s, userId: string, amount: number) => { /* ... */ },
  },
});

const store = appStore.create();                      // an empty store
const loaded = appStore.create({ snapshot });         // a store that starts with data
```

Everything that has instances is made by functions, so every `create()` gets its own and stores know nothing about each other. If you return the same slice twice from `slices`, the second `create()` fails and says so.

Big stores are built from plain functions: `slices: () => ({ ...authSlices(), ...billingSlices() })`, and relations between the parts are declared once in `relations`.

## Snapshots

`store.snapshot()` gives the whole contents as plain data: rows of every collection in their order, and the states of every slice. `create({ snapshot })` and `store.load(snapshot)` take it back. The data is trusted (rules are not run again) and checked by schemas.

## Server rendering

```tsx
// server, for every request
const store = appStore.create();
await loadData(store);                                   // fill it
const html = renderToString(<Provider store={store}><App /></Provider>);
const state = JSON.stringify(store.snapshot());          // into the page (escape it for HTML)
store.dispose();                                         // end of the request

// client
const store = appStore.create({ snapshot: JSON.parse(window.__STATE__) });
hydrateRoot(root, <Provider store={store}><App /></Provider>);
```

With a schema, values that JSON can not carry (dates) are restored when the snapshot is loaded.

## dispose

`store.dispose()` frees everything the store owns, once:

- what you registered with `store.onDispose(fn)` is called, the last registered first (`persistStore` stops itself this way);
- listeners of `onCommit` and everybody who watches states, rows and views are dropped; an answer of the server that is still on its way is not taken;
- rules, relations and named transactions stop; changing the store (`transaction`, `apply`, `load`, `transactions.*`) throws `The store is disposed`; `snapshot()` still reads;
- slices and collections leave the store: they work on their own again and can join another store.

## React

With a blueprint, `createStoreContext(appStore)` gives `Scope` (makes a store for its children and disposes it when removed, safe in StrictMode) and `Provider store={...}` for a store you made outside. See `rawstate-react`.
