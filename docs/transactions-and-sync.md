# Transactions and sync

## Transactions

```ts
store.transaction(() => {
  users.actions.add(user);
  credits.actions.add(credit);
  // an error here cancels both, nobody is told
});
```

- All changes are applied or none. Subscribers are told **once**, after everything is written, and they see all the changes. If the final values equal the starting ones, nobody is told.
- Reads inside a transaction see its own changes.
- Every action is a transaction by itself. A call inside a transaction joins it.
- The function must be synchronous: a transaction held open across an `await` is a trap. Do the async part first and apply the result in a short transaction (or use an [async action](slices.md#async-actions)).
- Only the state is rolled back. Side effects (a request, a log) are not.
- Relations and rules are checked at the end: [Relations and rules](relations-and-rules.md).

### Named transactions

Describe an operation over several slices once, in the store, and call it as a function:

```ts
const store = createStore(
  { users, credits },
  {
    transactions: {
      openCredit: (s, userId: string, amount: number) => {
        s.credits.actions.add({ id: nextId(), userId, amount });
        s.users.actions.update(userId, (u) => ({ debt: u.debt + amount }));
        return id;                                    // the result is returned
      },
    },
  }
);

store.transactions.openCredit("u1", 100);             // the arguments are typed
```

The first argument is the slices of the store, the others are yours. An error cancels everything. With React: `useTransaction("openCredit")`.

## Where data came from

Every transaction knows **where its data came from** (`origin`) and whether the data is **trusted**:

| origin | what it is | saved by `rawstate-idb` | rules and relations |
| --- | --- | --- | --- |
| `local` | actions and transactions of the app | yes | run |
| `remote` | data from the server | yes | not run (trusted) |
| `hydrate` | loaded from storage at start | no | not run |
| `tab` | written by another tab | no | not run |

Trusted data already carries what rules calculate, so running a delta rule like `increment` on it would count it twice. Shape checks (schemas) are always run.

```ts
store.transaction(() => { /* ... */ }, { origin: "remote", trusted: true });
```

## Data from the server

```ts
await users.syncFrom(() => api.users());                         // the list is the whole truth
await users.syncFrom(() => api.users(), { mode: "merge" });      // add and update, keep the others
users.sync(rows);                                                // when you already have the rows
```

- One transaction with origin `remote`, trusted by default (`{ trusted: false }` runs rules and relations).
- `replace` (default): rows that are not in the list are removed and the order is the list order. `merge`: add and update only.
- Rows that **did not change** (deep comparison) keep their objects, so components that watch them do not rerender and nothing is announced.
- If another `syncFrom` started while this one waited, the old answer is dropped. `syncFrom` resolves to `true` if the rows were taken, `false` if the answer was outdated.
- A failed fetch changes nothing and rejects.
- With a schema a bad row rejects the whole list, or with `onInvalid: "skip"` it is left out (a skipped row counts as not sent, so with `replace` it is removed): [Validation](validation.md).

## Watching and applying changes

The format of a change is plain data. It is what a commit gives out and what `apply` takes, so changes can be saved, sent to another tab or replayed.

```ts
store.onCommit((event) => {                 // after every commit that changed something
  event.origin;                             // "local" | "remote" | "hydrate" | "tab" | your own
  event.trusted;
  event.collections.users;                  // { upserted: rows, removed: ids, ids?: the new order }
  event.states.settings;                    // { theme: "dark" }
});

store.apply(changes, { origin: "tab" });    // the same format, one transaction; the origin is "remote" by default
store.load(snapshot);                       // replace whole collections and states (origin "hydrate", trusted)
const snapshot = store.snapshot();          // the whole contents as plain data
```

The event is calculated only while somebody listens. A failing listener does not break the commit (it is logged). `rawstate-idb` is built on exactly this.
