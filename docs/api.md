# API

Everything is imported from `rawstate`. Types are exported too.

## Slices

| | |
| --- | --- |
| `createSlice({ state, actions, schema?, validate? })` | Makes a slice. `createSlice<State>()({ ... })` checks it against your own interface |
| `Slice` | `.actions`, `.getState(key)`, `.snapshot()` |
| `StaleStateError` | An async action's patch was calculated from a state that changed. `.action`, `.key` |
| types | `Actions`, `Patch`, `Updater`, `DeepReadonly`, `StateReadables`, `BoundActions` |

`slice.getState(key)` returns a `Readable`: `get()` and `subscribe(fn)`. `slice.actions.name(...args)`: sync actions return `void`, async ones `Promise<void>`.

## Collections

| | |
| --- | --- |
| `createCollection<Row>()({ key, rows?, schema?, validate?, indexes? })` | Makes a table. Also `createCollection({ key, rows })` and `createCollection({ key, schema })` that infer the row type |
| `collection.actions` | `add`, `addMany`, `upsert`, `update`, `updateMany`, `remove`, `removeMany`, `replaceAll`, `clear` |
| `collection.get(id)`, `has(id)`, `all()` | Reading |
| `collection.size`, `rows` | Values to watch: the count, all rows |
| `collection.row(id)` | One row to watch |
| `collection.select(fn, options?)` | A calculated value over all rows |
| `collection.where(field, value)`, `by(field, value)` | Find by a field through an index; the second is to watch |
| `collection.sync(rows, options?)`, `syncFrom(fetcher, options?)` | Take rows from the server. `SyncOptions`: `mode`, `trusted`, `origin`, `onInvalid`, `onSkip` |
| types | `Collection`, `CollectionActions`, `RowPatch`, `IdKeys` |

## Stores

| | |
| --- | --- |
| `createStore(slices, { relations?, rules?, transactions? })` | Makes a store |
| `defineStore({ slices, relations?, rules?, transactions? })` | A blueprint: `.create({ snapshot? })` makes a new store each time |
| `store.slices`, `store.getSlice(key)` | The slices by name |
| `store.transaction(fn, options?)` | All or nothing. `TransactionOptions`: `origin`, `trusted` |
| `store.transactions.name(...args)` | Named transactions |
| `store.onCommit(listener)` | What changed after every commit (`CommitEvent`) |
| `store.apply(changes, options?)`, `store.load(snapshot, options?)`, `store.snapshot()` | Changes and contents as plain data (`StoreChanges`, `StoreSnapshot`) |
| `store.dispose()`, `onDispose(fn)`, `disposed` | Free the store |

## Relations and rules

| | |
| --- | --- |
| `relation(child, field, parent, { onDelete? })` | `onDelete`: `restrict` (default), `cascade`, `setNull`. `IntegrityError` when broken (`.code`: `missing-reference`, `restricted`, `rule-loop`) |
| `increment(target, field).from(source, { to, by? })`, `decrement(...)` | Follow the changes of another collection |
| `rollup(target, field, count(child, fk) \| sum(child, fk, field))` | A field equal to a count or a sum |
| `rule(collection, { inserted?, removed?, updated? })` | Your own rule: handlers return operations |
| `op.add`, `op.upsert`, `op.update`, `op.increment`, `op.remove` | Operations for rules |

## Values to watch

| | |
| --- | --- |
| `view(sources, fn, { equals? })` | A value calculated from other values |
| `viewFamily(factory)` | A view per argument, remembered. `.clear()` forgets them |
| `View` | The class `view` returns. You need the name only for types |
| `Observer` | One value with `get`, `set`, `subscribe` (for your own use; states of slices are read-only) |
| `Readable<T>` | Anything with `get()` and `subscribe(fn)` |

## Validation

| | |
| --- | --- |
| `ValidationError` | `.issues` (`message`, `path`), `.source` |
| `StandardSchemaV1`, `ValidateMode` (`"boundary"` \| `"always"`) | The schema interface and when to check |

## Types worth knowing

`Origin` (`"local" \| "remote" \| "hydrate" \| "tab"` or your own string), `CommitEvent`, `StoreChanges`, `StoreSnapshot`, `CollectionChanges`, `StoreFactory`, `CreateOptions`.

Names that are not listed here are for the types to work and may change.
