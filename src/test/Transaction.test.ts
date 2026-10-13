import { createSlice } from "../common/Slice";
import { createStore } from "../common/Store";

const make = () => {
  const users = createSlice({
    state: { debt: 0, name: "a" },
    actions: {
      addDebt: (s, n: number) => ({ debt: s.debt + n }),
      fail: (s) => {
        throw new Error("boom");
        return { debt: s.debt };
      },
    },
  });
  const log = createSlice({
    state: { entries: [] as string[] },
    actions: { add: (s, e: string) => ({ entries: [...s.entries, e] }) },
  });
  const store = createStore({ users, log });
  return { users, log, store };
};

describe("transactions", () => {
  it("applies changes of several slices and notifies once", () => {
    const { users, log, store } = make();
    const onDebt = jest.fn();
    const onLog = jest.fn();
    users.getState("debt").subscribe(onDebt);
    log.getState("entries").subscribe(onLog);

    store.transaction(() => {
      users.actions.addDebt(1);
      users.actions.addDebt(1);
      log.actions.add("x");
    });

    expect(users.getState("debt").get()).toBe(2);
    expect(onDebt).toHaveBeenCalledTimes(1);
    expect(onDebt).toHaveBeenCalledWith(2);
    expect(onLog).toHaveBeenCalledTimes(1);
  });

  it("subscribers see all slices already changed", () => {
    const { users, log, store } = make();
    let seen: string[] | undefined;
    users.getState("debt").subscribe(() => {
      seen = log.getState("entries").get() as string[];
    });

    store.transaction(() => {
      users.actions.addDebt(1);
      log.actions.add("x");
    });

    expect(seen).toEqual(["x"]);
  });

  it("reads see own writes inside the transaction", () => {
    const { users, store } = make();
    store.transaction(() => {
      users.actions.addDebt(5);
      expect(users.getState("debt").get()).toBe(5);
    });
  });

  it("rolls everything back when something throws, nobody is notified", () => {
    const { users, log, store } = make();
    const fn = jest.fn();
    users.getState("debt").subscribe(fn);

    expect(() =>
      store.transaction(() => {
        users.actions.addDebt(3);
        log.actions.add("x");
        users.actions.fail();
      })
    ).toThrow("boom");

    expect(users.getState("debt").get()).toBe(0);
    expect(log.getState("entries").get()).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not notify when the final value equals the old one", () => {
    const { users, store } = make();
    const fn = jest.fn();
    users.getState("debt").subscribe(fn);
    store.transaction(() => {
      users.actions.addDebt(1);
      users.actions.addDebt(-1);
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("a nested transaction joins the outer one", () => {
    const { users, store } = make();
    expect(() =>
      store.transaction(() => {
        users.actions.addDebt(1);
        store.transaction(() => users.actions.addDebt(1));
        throw new Error("outer");
      })
    ).toThrow("outer");
    expect(users.getState("debt").get()).toBe(0);
  });

  it("returns the value of the function", () => {
    const { store } = make();
    const n: number = store.transaction(() => 42);
    expect(n).toBe(42);
  });

  it("rejects an async function and rolls back", () => {
    const { users, store } = make();
    expect(() =>
      store.transaction((() => {
        users.actions.addDebt(1);
        return Promise.resolve();
      }) as never)
    ).toThrow("must be synchronous");
    expect(users.getState("debt").get()).toBe(0);
  });

  it("one action with several keys notifies after all of them are set", () => {
    const slice = createSlice({
      state: { a: 0, b: 0 },
      actions: { both: () => ({ a: 1, b: 1 }) },
    });
    let seen: unknown;
    slice.getState("a").subscribe(() => {
      seen = slice.snapshot();
    });
    slice.actions.both();
    expect(seen).toEqual({ a: 1, b: 1 });
  });

  it("a failing subscriber does not break the commit or other subscribers", () => {
    const { users, store } = make();
    const second = jest.fn();
    users.getState("debt").subscribe(() => {
      throw new Error("subscriber");
    });
    users.getState("debt").subscribe(second);

    expect(() => store.transaction(() => users.actions.addDebt(1))).toThrow(
      "subscriber"
    );
    expect(users.getState("debt").get()).toBe(1);
    expect(second).toHaveBeenCalledWith(1);
  });

  it("async action applies its result as one transaction", async () => {
    const slice = createSlice({
      state: { a: 0, b: 0 },
      actions: { later: async () => ({ a: 1, b: 2 }) },
    });
    const store = createStore({ slice });
    const fn = jest.fn();
    slice.getState("a").subscribe(fn);
    await store.getSlice("slice").actions.later();
    expect(slice.snapshot()).toEqual({ a: 1, b: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("a slice can not be used in two stores", () => {
    const { users } = make();
    expect(() => createStore({ users })).toThrow("another store");
  });

  it("states are not writable from outside", () => {
    const { users } = make();
    // @ts-expect-error states have no set, only actions change them
    users.getState("debt").set(5);
  });
});
