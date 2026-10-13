import { createCollection } from "../common/Collection";
import { deepEqual } from "../common/equal";
import { relation } from "../common/Relation";
import { increment, rollup, sum } from "../common/Rule";
import { createSlice } from "../common/Slice";
import { createStore } from "../common/Store";
import type { CommitEvent } from "../types/store.types";

interface User { id: string; name: string; debt: number }
interface Credit { id: number; userId: string; amount: number }

const make = () => {
  const users = createCollection<User>()({
    key: "id",
    rows: [{ id: "u1", name: "Ann", debt: 0 }],
  });
  const credits = createCollection<Credit>()({ key: "id" });
  const settings = createSlice({
    state: { theme: "light", count: 0 },
    actions: {
      setTheme: (_s, theme: string) => ({ theme }),
      bump: (s) => ({ count: s.count + 1 }),
    },
  });
  const store = createStore({ users, credits, settings });
  const events: CommitEvent[] = [];
  store.onCommit((e) => events.push(e));
  return { users, credits, settings, store, events };
};

describe("onCommit", () => {
  it("describes what changed in collections and states", () => {
    const { users, settings, events } = make();
    users.actions.add({ id: "u2", name: "Bob", debt: 0 });
    settings.actions.setTheme("dark");

    expect(events).toHaveLength(2);
    expect(events[0].origin).toBe("local");
    expect(events[0].collections.users.upserted).toEqual([{ id: "u2", name: "Bob", debt: 0 }]);
    expect(events[0].collections.users.removed).toEqual([]);
    expect(events[0].collections.users.ids).toEqual(["u1", "u2"]);
    expect(events[0].states).toEqual({});
    expect(events[1].states).toEqual({ settings: { theme: "dark" } });
    expect(events[1].collections).toEqual({});
  });

  it("gives updated rows whole, removed ids, and only what changed", () => {
    const { users, events } = make();
    users.actions.update("u1", { debt: 5 });
    expect(events[0].collections.users).toEqual({
      upserted: [{ id: "u1", name: "Ann", debt: 5 }],
      removed: [],
    });
    users.actions.remove("u1");
    expect(events[1].collections.users.removed).toEqual(["u1"]);
    expect(events[1].collections.users.ids).toEqual([]);
  });

  it("one transaction is one event, with the net result", () => {
    const { users, credits, store, events } = make();
    store.transaction(() => {
      users.actions.add({ id: "u2", name: "Bob", debt: 0 });
      credits.actions.add({ id: 1, userId: "u2", amount: 5 });
      credits.actions.add({ id: 2, userId: "u2", amount: 7 });
      credits.actions.remove(2);
    });
    expect(events).toHaveLength(1);
    expect(events[0].collections.credits.upserted).toEqual([{ id: 1, userId: "u2", amount: 5 }]);
    expect(events[0].collections.credits.removed).toEqual([]);
  });

  it("is not called when nothing changed or the transaction failed", () => {
    const { users, settings, store, events } = make();
    settings.actions.setTheme("light");
    users.actions.update("u1", { name: "Ann" });
    expect(() =>
      store.transaction(() => {
        users.actions.add({ id: "u9", name: "x", debt: 0 });
        throw new Error("no");
      })
    ).toThrow("no");
    expect(events).toHaveLength(0);
  });

  it("carries origin and trusted, a nested call keeps the origin of the outer", () => {
    const { users, store, events } = make();
    store.transaction(() => users.actions.update("u1", { debt: 1 }), { origin: "remote" });
    store.transaction(
      () => store.transaction(() => users.actions.update("u1", { debt: 2 }), { origin: "tab" }),
      { origin: "remote", trusted: true }
    );
    expect(events.map((e) => [e.origin, e.trusted])).toEqual([
      ["remote", false],
      ["remote", true],
    ]);
  });

  it("can be unsubscribed, and a failing listener does not break the commit", () => {
    const { users, store } = make();
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const fn = jest.fn();
    const off = store.onCommit(fn);
    store.onCommit(() => {
      throw new Error("listener");
    });
    users.actions.update("u1", { debt: 1 });
    expect(users.get("u1")?.debt).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    users.actions.update("u1", { debt: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("is still called when a subscriber of a state throws", () => {
    const { settings, events } = make();
    settings.getState("count").subscribe(() => {
      throw new Error("subscriber");
    });
    expect(() => settings.actions.bump()).toThrow("subscriber");
    expect(events).toHaveLength(1);
  });
});

describe("apply and load", () => {
  it("apply takes changes in the format of onCommit", () => {
    const a = make();
    const b = make();
    a.users.actions.add({ id: "u2", name: "Bob", debt: 0 });
    a.users.actions.remove("u1");
    a.settings.actions.setTheme("dark");

    for (const event of a.events) {
      b.store.apply(event, { origin: "tab" });
    }

    expect(b.users.all()).toEqual(a.users.all());
    expect(b.users.all().map((u) => u.id)).toEqual(["u2"]);
    expect(b.settings.getState("theme").get()).toBe("dark");
    expect(b.events.map((e) => e.origin)).toEqual(["tab", "tab", "tab"]);
  });

  it("apply is remote by default and atomic", () => {
    const { users, store, events } = make();
    store.apply({ collections: { users: { upserted: [{ id: "u2", name: "B", debt: 0 }] } } });
    expect(events[0].origin).toBe("remote");

    expect(() =>
      store.apply({
        collections: { users: { upserted: [{ id: "u3", name: "C", debt: 0 }] } },
        states: { settings: { nope: 1 } },
      })
    ).toThrow('There is no state "settings.nope"');
    expect(users.has("u3")).toBe(false);
  });

  it("unknown names throw", () => {
    const { store } = make();
    expect(() => store.apply({ collections: { nope: {} } })).toThrow('no collection "nope"');
    expect(() => store.apply({ states: { nope: {} } })).toThrow('no slice "nope"');
  });

  it("apply can set the order of ids", () => {
    const { users, store } = make();
    users.actions.addMany([
      { id: "u2", name: "B", debt: 0 },
      { id: "u3", name: "C", debt: 0 },
    ]);
    store.apply({ collections: { users: { ids: ["u3", "u1", "u2"] } } });
    expect(users.all().map((u) => u.id)).toEqual(["u3", "u1", "u2"]);
  });

  it("load replaces collections and sets states as trusted hydrate data", () => {
    const { users, settings, store, events } = make();
    store.load({
      collections: { users: [{ id: "x", name: "X", debt: 1 }, { id: "y", name: "Y", debt: 2 }] },
      states: { settings: { theme: "dark" } },
    });
    expect(users.all().map((u) => u.id)).toEqual(["x", "y"]);
    expect(settings.getState("theme").get()).toBe("dark");
    expect(events[0].origin).toBe("hydrate");
    expect(events[0].trusted).toBe(true);
  });

  it("loaded and applied data is frozen", () => {
    const { users, store } = make();
    store.load({ collections: { users: [{ id: "x", name: "X", debt: 1 }] } });
    expect(() => {
      (users.get("x") as User).name = "hack";
    }).toThrow();
  });
});

describe("trusted data and rules", () => {
  const setup = () => {
    const users = createCollection<User>()({ key: "id", rows: [{ id: "u1", name: "Ann", debt: 0 }] });
    const credits = createCollection<Credit>()({ key: "id" });
    const store = createStore({ users, credits }, {
      relations: [relation(credits, "userId", users)],
      rules: [increment(users, "debt").from(credits, { to: (c) => c.userId, by: (c) => c.amount })],
    });
    return { users, credits, store };
  };

  it("local changes run the rules, trusted ones do not", () => {
    const { users, credits, store } = setup();
    credits.actions.add({ id: 1, userId: "u1", amount: 10 });
    expect(users.get("u1")?.debt).toBe(10);

    store.apply({ collections: { credits: { upserted: [{ id: 2, userId: "u1", amount: 5 }] } } }, { trusted: true });
    expect(users.get("u1")?.debt).toBe(10);
    expect(credits.has(2)).toBe(true);
  });

  it("relations are not checked for trusted data, and are for untrusted", () => {
    const { credits, store } = setup();
    store.apply({ collections: { credits: { upserted: [{ id: 1, userId: "nobody", amount: 1 }] } } }, { trusted: true });
    expect(credits.has(1)).toBe(true);
    expect(() =>
      store.apply({ collections: { credits: { upserted: [{ id: 2, userId: "nobody", amount: 1 }] } } })
    ).toThrow("there is no such row in users");
  });

  it("a rollup is not run twice for data that came with its result", () => {
    const users = createCollection<User>()({ key: "id" });
    const credits = createCollection<Credit>()({ key: "id" });
    const store = createStore({ users, credits }, {
      rules: [rollup(users, "debt", sum(credits, "userId", "amount"))],
    });
    store.load({
      collections: {
        users: [{ id: "u1", name: "A", debt: 15 }],
        credits: [{ id: 1, userId: "u1", amount: 15 }],
      },
    });
    expect(users.get("u1")?.debt).toBe(15);
  });
});

describe("collection.sync", () => {
  const rows = (...ids: string[]): User[] => ids.map((id) => ({ id, name: id, debt: 0 }));

  it("replace makes the list the whole truth, in the order of the list", () => {
    const { users } = make();
    users.sync(rows("b", "a", "c"));
    expect(users.all().map((u) => u.id)).toEqual(["b", "a", "c"]);
    users.sync(rows("c", "b"));
    expect(users.all().map((u) => u.id)).toEqual(["c", "b"]);
  });

  it("merge adds and updates, keeps the others and the order", () => {
    const { users } = make();
    users.sync([{ id: "u1", name: "Anna", debt: 3 }, ...rows("u2")], { mode: "merge" });
    expect(users.all().map((u) => u.id)).toEqual(["u1", "u2"]);
    expect(users.get("u1")?.name).toBe("Anna");
    users.sync(rows("u3"), { mode: "merge" });
    expect(users.all().map((u) => u.id)).toEqual(["u1", "u2", "u3"]);
  });

  it("rows that did not change keep their objects and nobody is notified", () => {
    const { users, events } = make();
    users.sync(rows("a", "b"));
    const a = users.get("a");
    const fnA = jest.fn();
    const fnRows = jest.fn();
    users.row("a").subscribe(fnA);
    users.rows.subscribe(fnRows);
    events.length = 0;

    users.sync(rows("a", "b"));

    expect(users.get("a")).toBe(a);
    expect(fnA).not.toHaveBeenCalled();
    expect(fnRows).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it("only the changed rows are in the event", () => {
    const { users, events } = make();
    users.sync(rows("a", "b"));
    events.length = 0;
    users.sync([{ id: "a", name: "A!", debt: 0 }, ...rows("b")]);
    expect(events[0].origin).toBe("remote");
    expect(events[0].collections.users.upserted).toEqual([{ id: "a", name: "A!", debt: 0 }]);
    expect(events[0].collections.users.removed).toEqual([]);
  });

  it("a row of the list twice is an error and changes nothing", () => {
    const { users } = make();
    expect(() => users.sync(rows("a", "a"))).toThrow("is in the list twice");
    expect(users.all().map((u) => u.id)).toEqual(["u1"]);
  });

  it("is trusted by default, trusted: false runs rules and relations", () => {
    const users = createCollection<User>()({ key: "id" });
    const credits = createCollection<Credit>()({ key: "id" });
    createStore({ users, credits }, {
      relations: [relation(credits, "userId", users)],
    });
    credits.sync([{ id: 1, userId: "nobody", amount: 1 }]);
    expect(credits.has(1)).toBe(true);
    expect(() => credits.sync([{ id: 2, userId: "nobody", amount: 1 }], { trusted: false })).toThrow(
      "there is no such row"
    );
  });
});

describe("collection.syncFrom", () => {
  it("fetches and takes the rows", async () => {
    const { users } = make();
    const taken = await users.syncFrom(async () => [{ id: "z", name: "Z", debt: 0 }]);
    expect(taken).toBe(true);
    expect(users.all().map((u) => u.id)).toEqual(["z"]);
  });

  it("drops the answer of an older request when a newer one started", async () => {
    const { users } = make();
    let release!: (rows: User[]) => void;
    const slow = users.syncFrom(() => new Promise<User[]>((r) => (release = r)));
    const fast = await users.syncFrom(async () => [{ id: "new", name: "N", debt: 0 }]);
    release([{ id: "old", name: "O", debt: 0 }]);

    expect(fast).toBe(true);
    expect(await slow).toBe(false);
    expect(users.all().map((u) => u.id)).toEqual(["new"]);
  });

  it("a failed fetch changes nothing and rejects", async () => {
    const { users } = make();
    await expect(users.syncFrom(async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    expect(users.all().map((u) => u.id)).toEqual(["u1"]);
  });
});

describe("deepEqual", () => {
  it("compares plain data", () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual(new Date(5), new Date(5))).toBe(true);
    expect(deepEqual(new Date(5), new Date(6))).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual(NaN, NaN)).toBe(true);
  });
});
