# Slices

A slice is a group of states and the actions that change them.

```ts
const todos = createSlice({
  state: { filter: "all" as "all" | "done", loading: false },
  actions: {
    setFilter: (_state, filter: "all" | "done") => ({ filter }),
  },
});
```

## States

- `slice.getState("filter")` gives a value with `get()` and `subscribe(fn)`. It has no `set`: states are changed by actions only.
- `slice.snapshot()` gives all the states in one frozen object.
- Every state has its own subscribers. Changing `loading` does not wake those who watch `filter`.
- A change to the same value (`Object.is`) is not a change: nobody is told.

## Actions

An action is `(state, ...args) => patch`.

- `state` is read-only. Writing to it throws (and it is not allowed by types).
- The patch is an object with the states to change. A key that is not in the state, or a value of a wrong type, does not compile, even next to correct keys; at run time a wrong key throws before anything is changed.
- Every action is a transaction: a patch that changes several states is never seen half applied.
- Arrays and objects are frozen when they are in the state (in development), so mutate nothing: return new values. `({ list: [...state.list, item] })`.

## Async actions

An async action gets the state **at the moment it is called**, but its result is applied later. If two calls run together and both calculate from the old value, one would silently erase the other. rawstate does not allow that.

```ts
actions: {
  // WRONG when called twice at once: both read count = 0
  addStale: async (state, n: number) => {
    await sleep(100);
    return { count: state.count + n };
  },

  // RIGHT: return a function. It gets the state at the moment the result is applied
  add: async (_state, n: number) => {
    await sleep(100);
    return (state) => ({ count: state.count + n });
  },
}

await Promise.all([slice.actions.add(1), slice.actions.add(1)]);   // count is 2
```

- An **updater** `(state) => patch` is called inside the transaction with the current state, so it is always right. Use it whenever the result depends on the state.
- A **plain patch** is applied only if every state the action read still has the value it had. Otherwise it is **not applied** and the call rejects with `StaleStateError` (it has `action` and `key`). Nothing is lost silently.
- A patch that does not read the state (`async () => ({ data: await load() })`) never conflicts.
- The check is strict: it looks at what was read, not at what was used. If an action reads a flag only to decide whether to start (`if (state.loading) return {}`) and the flag changes meanwhile, it fails too. Read such flags inside an updater.
- If the promise rejects, the state stays untouched.

## Describing the state with an interface

```ts
interface AuthState { user: { name: string } | null; token?: string }

const auth = createSlice<AuthState>()({
  state: { user: null },
  actions: {
    login: (_s, name: string) => ({ user: { name } }),
    logout: () => ({ user: null }),
  },
});
```

The initial state and every result are checked against the interface.

## Checking data from outside

Give the slice a `schema` to check what comes from the server, storage or other tabs: [Validation](validation.md).

## Views

`view(sources, fn)` is a value calculated from other values: [Getting started](getting-started.md#a-value-calculated-from-states). `viewFamily(arg => view(...))` makes one per argument and remembers it.

## Not for slices

A slice does not know about other slices. To change several at once use a [transaction](transactions-and-sync.md); to link tables use [relations and rules](relations-and-rules.md).
