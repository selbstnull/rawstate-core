import { createSlice } from "../common/Slice";
import { createCollection } from "../common/Collection";
import { relation } from "../common/Relation";
import { count, decrement, increment, op, rollup, rule, sum } from "../common/Rule";
import { createStore } from "../common/Store";

// These tests are checked by the compiler: callback bodies are never run
const check = (_fn: () => void) => {};

describe("types", () => {
  const slice = createSlice({
    state: { count: 0, tags: ["a"] as string[], user: { name: "x" } },
    actions: {
      add: (s, n: number) => ({ count: s.count + n }),
      load: async () => ({ tags: ["b"] }),
    },
  });

  it("infers states and actions", () => {
    check(() => {
      const n: number = slice.getState("count").get();
      const tags: readonly string[] = slice.getState("tags").get();
      slice.actions.add(1);
      const p: Promise<void> = slice.actions.load();

      // @ts-expect-error unknown state key
      slice.getState("nope");
      // @ts-expect-error unknown action
      slice.actions.nope();
      // @ts-expect-error wrong argument type
      slice.actions.add("1");
      // @ts-expect-error missing argument
      slice.actions.add();
      // @ts-expect-error add is sync, it does not return Promise
      const bad: Promise<void> = slice.actions.add(1);

      return [n, tags, p, bad];
    });
  });

  it("checks action results against the state", () => {
    check(() => {
      createSlice({
        state: { count: 0 },
        // @ts-expect-error count is a number
        actions: { wrong: () => ({ count: "1" }) },
      });
      createSlice({
        state: { count: 0 },
        // @ts-expect-error unknown key in the patch
        actions: { wrong: () => ({ other: 1 }) },
      });
    });
  });

  it("makes state readonly", () => {
    check(() => {
      createSlice({
        state: { list: [1], user: { name: "x" } },
        actions: {
          mutate: (s) => {
            // @ts-expect-error array is readonly
            s.list.push(2);
            // @ts-expect-error object is readonly
            s.user.name = "y";
            return {};
          },
        },
      });
      const user = slice.getState("user").get();
      // @ts-expect-error object is readonly
      user.name = "y";
    });
  });

  it("keeps slice types in the store", () => {
    check(() => {
      const store = createStore({ counter: slice });
      store.getSlice("counter").actions.add(1);
      // @ts-expect-error unknown slice
      store.getSlice("nope");
    });
  });
});

describe("exact contract", () => {
  it("does not allow keys outside of the state", () => {
    check(() => {
      createSlice({
        state: { count: 0 },
        // @ts-expect-error cuont is not in the state, even next to a valid key
        actions: { wrong: (s) => ({ count: s.count, cuont: 1 }) },
      });
      createSlice({
        state: { count: 0 },
        // @ts-expect-error the same for async actions
        actions: { wrong: async () => ({ count: 1, extra: 1 }) },
      });
    });
  });

  it("works when actions with and without arguments are mixed", () => {
    check(() => {
      const slice = createSlice({
        state: { count: 0 },
        actions: {
          add: (s, n: number) => ({ count: s.count + n }),
          reset: () => ({ count: 0 }),
        },
      });
      slice.actions.add(1);
      slice.actions.reset();
      createSlice({
        state: { count: 0 },
        actions: {
          add: (s, n: number) => ({ count: s.count + n }),
          // @ts-expect-error cuont is a typo, the state has no such key
          reset: () => ({ cuont: 0 }),
        },
      });
    });
  });

  it("allows to describe the states with an interface", () => {
    interface UserState {
      user: { name: string } | null;
      count?: number;
    }
    check(() => {
      const slice = createSlice<UserState>()({
        state: { user: null },
        actions: {
          login: (_s, name: string) => ({ user: { name } }),
          logout: () => ({ user: null }),
        },
      });
      slice.actions.login("a");
      const u: { readonly name: string } | null = slice.getState("user").get();

      // @ts-expect-error state is checked against the interface
      createSlice<UserState>()({ state: { user: 1 }, actions: {} });
      createSlice<UserState>()({
        state: { user: null },
        // @ts-expect-error unknown key
        actions: { bad: () => ({ nope: 1 }) },
      });
      return u;
    });
  });
});

describe("collection types", () => {
  interface User {
    id: string;
    name: string;
    meta: { tags: string[] };
    age?: number;
  }
  it("checks key, rows, patches and ids", () => {
    check(() => {
      const users = createCollection<User>()({ key: "id" });
      users.actions.add({ id: "a", name: "A", meta: { tags: [] } });
      users.actions.update("a", { name: "B" });
      users.actions.update("a", (u) => ({ meta: { tags: [...u.meta.tags, "x"] } }));
      const row: { readonly name: string } | undefined = users.get("a");

      // @ts-expect-error only string or number fields can be an id
      createCollection<User>()({ key: "meta" });
      // @ts-expect-error unknown key
      createCollection<User>()({ key: "nope" });
      // @ts-expect-error row without a required field
      users.actions.add({ id: "a" });
      // @ts-expect-error unknown field in a patch
      users.actions.update("a", { nope: 1 });
      // @ts-expect-error id can not be in a patch
      users.actions.update("a", { id: "b" });
      // @ts-expect-error id must be a string
      users.actions.remove(1);
      // @ts-expect-error rows are readonly
      users.get("a")!.name = "x";
      // @ts-expect-error nested values are readonly too
      users.get("a")!.meta.tags.push("x");
      return row;
    });
  });
});

describe("relation types", () => {
  it("checks the field and the cascade options", () => {
    check(() => {
      const users = createCollection<{ id: string; name: string }>()({ key: "id" });
      const orders = createCollection<{
        id: number;
        userId: string;
        ownerId: string | null;
        total: number;
      }>()({ key: "id" });

      relation(orders, "userId", users);
      relation(orders, "ownerId", users, { onDelete: "setNull" });
      relation(orders, "userId", users, { onDelete: "cascade" });

      // @ts-expect-error total is a number, users have string ids
      relation(orders, "total", users);
      // @ts-expect-error there is no such field
      relation(orders, "nope", users);
      // @ts-expect-error userId can not be null, so it can not be set to null
      relation(orders, "userId", users, { onDelete: "setNull" });
      // @ts-expect-error unknown option
      relation(orders, "userId", users, { onDelete: "explode" });
    });
  });
});

describe("rule types", () => {
  it("checks fields, ids and handlers", () => {
    check(() => {
      const users = createCollection<{ id: string; name: string; debt: number }>()({ key: "id" });
      const credits = createCollection<{ id: number; userId: string; ownerId: number; amount: number }>()({ key: "id" });

      increment(users, "debt").from(credits, { to: (c) => c.userId, by: (c) => c.amount });
      rollup(users, "debt", sum(credits, "userId", "amount"));
      rollup(users, "debt", count(credits, "userId"));
      rule(credits, { inserted: (c) => op.increment(users, c.userId, "debt", c.amount) });

      // @ts-expect-error name is not a number field
      increment(users, "name");
      // @ts-expect-error `to` must give a string id of users
      increment(users, "debt").from(credits, { to: (c) => c.amount });
      // @ts-expect-error ownerId is a number, users have string ids
      rollup(users, "debt", count(credits, "ownerId"));
      // @ts-expect-error amount is not a reference
      rollup(users, "debt", count(credits, "amount"));
      // @ts-expect-error userId is not a number to sum
      rollup(users, "debt", sum(credits, "userId", "userId"));
      // @ts-expect-error id of a user is a string
      op.increment(users, 5, "debt", 1);
      // @ts-expect-error name is not a number field
      op.increment(users, "u", "name", 1);
      rule(credits, {
        // @ts-expect-error a handler returns operations, not numbers
        inserted: () => 5,
      });
      rule(credits, {
        // @ts-expect-error the row has no such field
        inserted: (c) => op.increment(users, c.nope, "debt", 1),
      });
    });
  });
});

describe("async action types", () => {
  it("types the updater and checks its result", () => {
    check(() => {
      createSlice({
        state: { count: 0, name: "x" },
        actions: {
          ok: async (_s, n: number) => {
            await Promise.resolve();
            return (s) => ({ count: s.count + n });
          },
          plain: async () => ({ name: "y" }),
        },
      });
      createSlice({
        state: { count: 0 },
        actions: {
          // @ts-expect-error the updater gives a string for a number
          wrongType: async () => (s) => ({ count: `${s.count}` }),
        },
      });
      createSlice({
        state: { count: 0 },
        actions: {
          // @ts-expect-error cuont is not in the state
          wrongKey: async () => (s) => ({ cuont: s.count }),
        },
      });
      createSlice({
        state: { list: [1] },
        actions: {
          // @ts-expect-error the state in an updater is readonly
          mutate: async () => (s) => (s.list.push(2), {}),
        },
      });
    });
  });
});
