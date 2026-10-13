import { z } from "zod";
import { createCollection } from "../common/Collection";
import { defineStore } from "../common/defineStore";
import { relation } from "../common/Relation";
import { increment, rollup, sum } from "../common/Rule";
import { createSlice } from "../common/Slice";
import { createStore } from "../common/Store";
import { ValidationError } from "../common/validate";

interface User { id: string; name: string; debt: number }
interface Credit { id: number; userId: string; amount: number }

const blueprint = () =>
  defineStore({
    slices: () => ({
      users: createCollection<User>()({ key: "id" }),
      credits: createCollection<Credit>()({ key: "id" }),
      settings: createSlice({
        state: { theme: "light" },
        actions: { setTheme: (_s, theme: string) => ({ theme }) },
      }),
    }),
    relations: (s) => [relation(s.credits, "userId", s.users, { onDelete: "cascade" })],
    rules: (s) => [rollup(s.users, "debt", sum(s.credits, "userId", "amount"))],
    transactions: {
      openCredit: (s, userId: string, amount: number) => {
        s.credits.actions.add({ id: s.credits.size.get() + 1, userId, amount });
      },
    },
  });

describe("defineStore", () => {
  it("makes stores that do not know about each other", () => {
    const factory = blueprint();
    const a = factory.create();
    const b = factory.create();
    expect(a).not.toBe(b);
    expect(a.slices.users).not.toBe(b.slices.users);

    a.slices.users.actions.add({ id: "u", name: "A", debt: 0 });
    a.slices.settings.actions.setTheme("dark");

    expect(b.slices.users.size.get()).toBe(0);
    expect(b.slices.settings.getState("theme").get()).toBe("light");
  });

  it("relations, rules and named transactions work in every store", () => {
    const factory = blueprint();
    const [a, b] = [factory.create(), factory.create()];
    for (const store of [a, b]) {
      store.slices.users.actions.add({ id: "u", name: "U", debt: 0 });
      store.transactions.openCredit("u", 10);
    }
    a.transactions.openCredit("u", 5);

    expect(a.slices.users.get("u")?.debt).toBe(15);
    expect(b.slices.users.get("u")?.debt).toBe(10);

    a.slices.users.actions.remove("u");
    expect(a.slices.credits.size.get()).toBe(0);
    expect(b.slices.credits.size.get()).toBe(1);
  });

  it("works without transactions, relations and rules", () => {
    const factory = defineStore({
      slices: () => ({ n: createSlice({ state: { v: 0 }, actions: { inc: (s) => ({ v: s.v + 1 }) } }) }),
    });
    const store = factory.create();
    store.slices.n.actions.inc();
    expect(store.slices.n.getState("v").get()).toBe(1);
  });

  it("slices that are shared between stores are explained", () => {
    const shared = createSlice({ state: { v: 0 }, actions: {} });
    const factory = defineStore({ slices: () => ({ shared }) });
    factory.create();
    expect(() => factory.create()).toThrow("defineStore");
  });

  it("types are inferred: the slices of the store in relations, rules and transactions", () => {
    const check = (_fn: () => void) => {};
    check(() => {
      const slices = () => ({
        users: createCollection<User>()({ key: "id" }),
        credits: createCollection<Credit>()({ key: "id" }),
      });
      defineStore({
        slices,
        // @ts-expect-error there is no such collection in the store
        relations: (s) => [relation(s.nope, "userId", s.users)],
      });
      // @ts-expect-error a transaction can not be async
      defineStore({
        slices,
        transactions: { later: async () => {} },
      });
      const store = defineStore({
        slices: () => ({ users: createCollection<User>()({ key: "id" }) }),
        transactions: { rename: (s, id: string, name: string) => s.users.actions.update(id, { name }) },
      }).create();
      store.transactions.rename("u", "N");
      // @ts-expect-error wrong argument type
      store.transactions.rename(1, "N");
    });
  });
});

describe("snapshot and create({ snapshot })", () => {
  const fill = (store: ReturnType<ReturnType<typeof blueprint>["create"]>) => {
    store.slices.users.actions.addMany([
      { id: "b", name: "B", debt: 0 },
      { id: "a", name: "A", debt: 0 },
    ]);
    store.transactions.openCredit("a", 7);
    store.slices.settings.actions.setTheme("dark");
  };

  it("a store can be made from the snapshot of another one, in the same order", () => {
    const factory = blueprint();
    const server = factory.create();
    fill(server);

    const client = factory.create({ snapshot: server.snapshot() });

    expect(client.slices.users.all().map((u) => u.id)).toEqual(["b", "a"]);
    expect(client.slices.users.get("a")?.debt).toBe(7);
    expect(client.slices.credits.size.get()).toBe(1);
    expect(client.slices.settings.getState("theme").get()).toBe("dark");
    expect(client.snapshot()).toEqual(server.snapshot());
  });

  it("the snapshot is plain data: it goes through JSON", () => {
    const factory = blueprint();
    const server = factory.create();
    fill(server);
    const wire = JSON.parse(JSON.stringify(server.snapshot()));
    const client = factory.create({ snapshot: wire });
    expect(client.snapshot()).toEqual(server.snapshot());
  });

  it("loaded data is trusted: rules are not run on it a second time", () => {
    const factory = defineStore({
      slices: () => ({
        users: createCollection<User>()({ key: "id" }),
        credits: createCollection<Credit>()({ key: "id" }),
      }),
      rules: (s) => [increment(s.users, "debt").from(s.credits, { to: (c) => c.userId, by: (c) => c.amount })],
    });
    const store = factory.create({
      snapshot: {
        collections: {
          users: [{ id: "u", name: "U", debt: 10 }],
          credits: [{ id: 1, userId: "u", amount: 10 }],
        },
      },
    });
    expect(store.slices.users.get("u")?.debt).toBe(10);
  });

  it("schemas check the snapshot and convert it", () => {
    const Event = z.object({ id: z.string(), at: z.coerce.date() });
    const factory = defineStore({
      slices: () => ({ events: createCollection({ key: "id", schema: Event }) }),
    });
    const store = factory.create({
      snapshot: { collections: { events: [{ id: "e", at: "2024-01-02T00:00:00.000Z" }] } },
    });
    expect(store.slices.events.get("e")!.at).toBeInstanceOf(Date);

    expect(() =>
      factory.create({ snapshot: { collections: { events: [{ id: "e", at: "nonsense" }] } } })
    ).toThrow(ValidationError);
  });

  it("a snapshot that does not fit leaves nothing behind", () => {
    const shared = createCollection<User>()({ key: "id" });
    const factory = defineStore({ slices: () => ({ users: shared }) });
    expect(() => factory.create({ snapshot: { collections: { nope: [] } } })).toThrow("no collection");
    // the collection is free again, it can be used for another store
    expect(() => createStore({ users: shared })).not.toThrow();
  });
});

describe("dispose", () => {
  const make = () => {
    const users = createCollection<User>()({ key: "id", rows: [{ id: "u", name: "U", debt: 0 }] });
    const credits = createCollection<Credit>()({ key: "id" });
    const settings = createSlice({
      state: { theme: "light" },
      actions: { setTheme: (_s, theme: string) => ({ theme }) },
    });
    const store = createStore({ users, credits, settings }, {
      relations: [relation(credits, "userId", users)],
      rules: [rollup(users, "debt", sum(credits, "userId", "amount"))],
      transactions: { touch: (s) => s.settings.actions.setTheme("x") },
    });
    return { users, credits, settings, store };
  };

  it("calls what was registered, the last one first, and only once", () => {
    const { store } = make();
    const order: string[] = [];
    store.onDispose(() => order.push("first"));
    const off = store.onDispose(() => order.push("removed"));
    store.onDispose(() => order.push("last"));
    off();

    expect(store.disposed).toBe(false);
    store.dispose();
    store.dispose();

    expect(store.disposed).toBe(true);
    expect(order).toEqual(["last", "first"]);
  });

  it("a failing cleanup does not stop the others", () => {
    const { store } = make();
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const fn = jest.fn();
    store.onDispose(fn);
    store.onDispose(() => {
      throw new Error("cleanup");
    });
    store.dispose();
    expect(fn).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("the store can not be used any more", () => {
    const { store } = make();
    store.dispose();
    expect(() => store.transaction(() => {})).toThrow("The store is disposed");
    expect(() => store.transactions.touch()).toThrow("The store is disposed");
    expect(() => store.apply({})).toThrow("The store is disposed");
    expect(() => store.load({})).toThrow("The store is disposed");
    expect(() => store.onCommit(() => {})).toThrow("The store is disposed");
    expect(() => store.onDispose(() => {})).toThrow("The store is disposed");
    // what is there can still be read
    expect(store.snapshot().collections?.users).toHaveLength(1);
  });

  it("everybody who watched is dropped: states, rows, views and commit listeners", () => {
    const { users, settings, store } = make();
    const onTheme = jest.fn();
    const onRow = jest.fn();
    const onRows = jest.fn();
    const onCommit = jest.fn();
    settings.getState("theme").subscribe(onTheme);
    users.row("u").subscribe(onRow);
    users.rows.subscribe(onRows);
    store.onCommit(onCommit);

    store.dispose();
    settings.actions.setTheme("dark");
    users.actions.update("u", { name: "Changed" });

    expect(onTheme).not.toHaveBeenCalled();
    expect(onRow).not.toHaveBeenCalled();
    expect(onRows).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    // the values themselves still change: the slices work on their own
    expect(settings.getState("theme").get()).toBe("dark");
  });

  it("rules and relations stop, the collections work on their own", () => {
    const { users, credits, store } = make();
    credits.actions.add({ id: 1, userId: "u", amount: 5 });
    expect(users.get("u")?.debt).toBe(5);

    store.dispose();
    credits.actions.add({ id: 2, userId: "nobody", amount: 100 });
    expect(users.get("u")?.debt).toBe(5);
  });

  it("slices are free to join another store", () => {
    const { users, credits, settings, store } = make();
    store.dispose();
    const next = createStore({ users, credits, settings }, {
      rules: [rollup(users, "debt", sum(credits, "userId", "amount"))],
    });
    credits.actions.add({ id: 1, userId: "u", amount: 3 });
    expect(users.get("u")?.debt).toBe(3);
    expect(next.disposed).toBe(false);
  });

  it("an answer of the server that arrives after dispose is dropped", async () => {
    const { users, store } = make();
    let release!: (rows: User[]) => void;
    const pending = users.syncFrom(() => new Promise<User[]>((r) => (release = r)));
    store.dispose();
    release([{ id: "late", name: "L", debt: 0 }]);
    expect(await pending).toBe(false);
    expect(users.has("late")).toBe(false);
  });

  it("pending async actions do not break a disposed store", async () => {
    const slice = createSlice({
      state: { n: 0 },
      actions: { later: async () => { await Promise.resolve(); return { n: 1 }; } },
    });
    const store = createStore({ slice });
    const pending = slice.actions.later();
    store.dispose();
    await expect(pending).resolves.toBeUndefined();
  });
});
