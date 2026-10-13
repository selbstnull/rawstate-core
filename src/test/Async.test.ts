import { createSlice, StaleStateError } from "../common/Slice";
import { createStore } from "../common/Store";

const wait = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

const make = () =>
  createSlice({
    state: { count: 0, other: 0, loading: false, data: "" },
    actions: {
      // the patch is calculated from the state that was current when the action was called
      addStale: async (s, n: number) => {
        await wait();
        return { count: s.count + n };
      },
      // the same, written with an updater: it gets the state of the moment it is applied
      add: async (_s, n: number) => {
        await wait();
        return (s) => ({ count: s.count + n });
      },
      readEarly: async (s) => {
        const seen = s.count;
        await wait();
        return { count: seen + 1 };
      },
      load: async (_s, data: string) => {
        await wait();
        return { data };
      },
      guarded: async (s) => {
        if (s.loading) return {};
        await wait();
        return { data: "loaded" };
      },
      setCount: (_s, count: number) => ({ count }),
      setOther: (_s, other: number) => ({ other }),
      setLoading: (_s, loading: boolean) => ({ loading }),
      broken: async () => {
        await wait();
        return () => ({ nope: 1 } as never);
      },
    },
  });

describe("async actions: no silent lost update", () => {
  it("a patch from an old state is not applied, it fails loudly", async () => {
    const slice = make();
    const results = await Promise.allSettled([
      slice.actions.addStale(1),
      slice.actions.addStale(1),
    ]);

    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    const error = (results[1] as PromiseRejectedResult).reason;
    expect(error).toBeInstanceOf(StaleStateError);
    expect(error.key).toBe("count");
    expect(error.action).toBe("addStale");
    expect(error.message).toContain("return (state) =>");
    // the first one is applied, the second one changed nothing
    expect(slice.getState("count").get()).toBe(1);
  });

  it("an updater is always applied to the current state", async () => {
    const slice = make();
    await Promise.all([slice.actions.add(1), slice.actions.add(1)]);
    expect(slice.getState("count").get()).toBe(2);

    await Promise.all(Array.from({ length: 10 }, () => slice.actions.add(1)));
    expect(slice.getState("count").get()).toBe(12);
  });

  it("an updater sees changes made while the action waited", async () => {
    const slice = make();
    const pending = slice.actions.add(5);
    slice.actions.setCount(100);
    await pending;
    expect(slice.getState("count").get()).toBe(105);
  });

  it("an updater and a sync action can run together", async () => {
    const slice = make();
    const pending = Promise.all([slice.actions.add(1), slice.actions.add(2)]);
    slice.actions.setCount(10);
    await pending;
    expect(slice.getState("count").get()).toBe(13);
  });

  it("a value read before the wait and used after is detected too", async () => {
    const slice = make();
    const pending = slice.actions.readEarly();
    slice.actions.setCount(7);
    await expect(pending).rejects.toBeInstanceOf(StaleStateError);
    expect(slice.getState("count").get()).toBe(7);
  });

  it("one after another there is no conflict", async () => {
    const slice = make();
    await slice.actions.addStale(1);
    await slice.actions.addStale(1);
    await slice.actions.readEarly();
    expect(slice.getState("count").get()).toBe(3);
  });
});

describe("async actions: no false alarms", () => {
  it("a patch that does not read the state never conflicts", async () => {
    const slice = make();
    const pending = slice.actions.load("fresh");
    slice.actions.setCount(1);
    slice.actions.setOther(2);
    await pending;
    expect(slice.snapshot()).toMatchObject({ data: "fresh", count: 1, other: 2 });
  });

  it("only what was read matters: other states may change", async () => {
    const slice = make();
    const pending = slice.actions.addStale(1);
    slice.actions.setOther(9);
    await pending;
    expect(slice.snapshot()).toMatchObject({ count: 1, other: 9 });
  });

  it("a read that did not change is fine, a value set to the same one too", async () => {
    const slice = make();
    const pending = slice.actions.addStale(1);
    slice.actions.setCount(0);
    await pending;
    expect(slice.getState("count").get()).toBe(1);
  });

  it("the check is strict: even a guard that was read counts", async () => {
    const slice = make();
    const pending = slice.actions.guarded();
    slice.actions.setLoading(true);
    await expect(pending).rejects.toBeInstanceOf(StaleStateError);
    expect(slice.getState("data").get()).toBe("");
  });
});

describe("async actions: other behaviour", () => {
  it("an updater that gives a wrong key fails and changes nothing", async () => {
    const slice = make();
    await expect(slice.actions.broken()).rejects.toThrow('unknown state key "nope"');
    expect(slice.getState("count").get()).toBe(0);
  });

  it("an async action that rejects changes nothing", async () => {
    const slice = createSlice({
      state: { n: 0 },
      actions: {
        fail: async () => {
          await wait();
          throw new Error("offline");
        },
      },
    });
    await expect(slice.actions.fail()).rejects.toThrow("offline");
    expect(slice.getState("n").get()).toBe(0);
  });

  it("the result is applied in one transaction with one notification", async () => {
    const slice = createSlice({
      state: { a: 0, b: 0 },
      actions: {
        both: async () => {
          await wait();
          return (s) => ({ a: s.a + 1, b: s.b + 1 });
        },
      },
    });
    const store = createStore({ slice });
    const events: unknown[] = [];
    store.onCommit((e) => events.push(e.states));
    await slice.actions.both();
    expect(events).toEqual([{ slice: { a: 1, b: 1 } }]);
  });

  it("the state an action gets can not be changed", () => {
    const slice = createSlice({
      state: { count: 0 },
      actions: {
        hack: (s) => {
          (s as { count: number }).count = 5;
          return {};
        },
      },
    });
    expect(() => slice.actions.hack()).toThrow("read-only");
    expect(slice.getState("count").get()).toBe(0);
  });

  it("snapshot() is frozen", () => {
    const slice = make();
    expect(Object.isFrozen(slice.snapshot())).toBe(true);
  });
});
