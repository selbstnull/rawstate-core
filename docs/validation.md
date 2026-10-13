# Validation

Types check your code, but not the data that comes from the server, from storage or from another tab. Give a collection or a slice a **schema** and everything that comes from outside is checked at run time.

Any [Standard Schema](https://standardschema.dev) works: zod, valibot, arktype and others. rawstate has no dependency on them.

```ts
import { z } from "zod";

const User = z.object({ id: z.string(), name: z.string().min(1), age: z.number().int() });

// the type of the row comes from the schema
const users = createCollection({ key: "id", schema: User });

// or write the type yourself: the schema must give out the same type
const users2 = createCollection<User>()({ key: "id", schema: UserSchema });

const settings = createSlice({
  state: { theme: "light" },
  actions: {},
  schema: z.object({ theme: z.enum(["light", "dark"]) }),
});
```

## What is checked

By default (`validate: "boundary"`):

- rows of `sync` / `syncFrom` (the answer of the server);
- everything that comes through `store.apply` and `store.load` (storage, other tabs, snapshots), for collections and for states of slices;
- the initial rows and the initial state.

Actions are your code and are checked by types only. Use `validate: "always"` to check their results too.

## When data does not fit

Nothing of the operation is applied and `ValidationError` is thrown, inside the transaction, so the rest of it is rolled back too. It has `issues` (`message` and `path` like `address.city`) and `source` (the name in the store):

```
Invalid row "u7" in "users": name: Too small; age: Invalid input
```

For a list from the server you can leave the bad rows out instead:

```ts
await users.syncFrom(() => api.users(), {
  onInvalid: "skip",
  onSkip: (row, error) => report(row, error.issues),
});
```

A skipped row counts as if the server did not send it, so with `replace` it is removed.

## Converting values

If the schema converts values (`z.coerce.number()`, dates from strings), the stored data is what the schema gives out. That is how a snapshot that went through JSON gets its dates back.

## Notes

- Schemas must be synchronous; an async one is refused with a clear error.
- Trusted data is checked too: trust is about rules, not about shape.
- With `rawstate-idb`, saved data that no longer fits the schema is thrown away like any broken cache (or fixed first by `migrate`), and a bad change from another tab is refused.
