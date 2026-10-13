# Testing

Because a collection with relations and rules behaves like a small database, you can test business logic without a real one.

```ts
import { defineStore, createCollection, relation, rollup, sum } from "rawstate-core";

const bank = defineStore({
  slices: () => ({
    users: createCollection<User>()({ key: "id" }),
    credits: createCollection<Credit>()({ key: "id" }),
  }),
  relations: (s) => [relation(s.credits, "userId", s.users, { onDelete: "restrict" })],
  rules: (s) => [rollup(s.users, "debt", sum(s.credits, "userId", "amount"))],
});

test("a user with credits can not be removed", () => {
  const store = bank.create();                        // a fresh store for this test
  store.slices.users.actions.add({ id: "a", name: "Ann", debt: 0 });
  store.slices.credits.actions.add({ id: 1, userId: "a", amount: 10 });

  expect(store.slices.users.get("a")?.debt).toBe(10);
  expect(() => store.slices.users.actions.remove("a")).toThrow(IntegrityError);
});
```

- Make a store per test with `create()`: nothing is shared between tests. Call `store.dispose()` in `afterEach`.
- Start from known data with `create({ snapshot })`.
- Assert on what happened with `store.onCommit(event => events.push(event))`.
- A failed transaction leaves no trace, so a test can check that nothing changed after an error.
- Async actions: await the call; `StaleStateError` shows a lost update that would have happened.
