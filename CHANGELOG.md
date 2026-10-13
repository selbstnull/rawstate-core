# Changelog

## 0.1.0

The first release of rawstate.

**Slices**
- `createSlice({ state, actions })`: the types of states and actions are inferred (`Slice<S, A>`). A key that is not in the state, or a value of a wrong type, in the result of an action does not compile. No `any` in the library.
- Actions are `(state, ...args) => patch`: the slice passes the current state, the state is read-only and frozen in development, `getState()` has no `set`.
- Async actions can not lose an update: return `(state) => patch` or get `StaleStateError` instead of a silent overwrite.

**Collections, relations, rules**
- `createCollection`: tables with an id, ready actions, `row(id)`, `rows`, `select`, indexes (`where`, `by`).
- `relation(child, field, parent, { onDelete })`: references that stay valid, `cascade`, `restrict`, `setNull`, checked when a transaction ends, `IntegrityError`.
- Rules: `rule`, `op.*`, `increment`, `decrement`, `rollup`, `count`, `sum`.
- Rows are kept in a table that changes by copying a small bucket: a change does not get slower with the size (100 000 rows: 71 ms to 0.01 ms for an update).

**Transactions and sync**
- `store.transaction`, named transactions, one notification at the end, rollback on error.
- `origin` and `trusted` of data, `store.onCommit`, `store.apply`, `store.load`, `store.snapshot`, `collection.sync` and `syncFrom`.

**Validation, many stores**
- Any Standard Schema (`schema`, `validate`) at the borders: `ValidationError`.
- `defineStore` blueprints, `store.dispose()`, `onDispose`.
