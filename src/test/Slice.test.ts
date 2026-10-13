import { createSlice, Slice } from "../common/Slice";
import { Observer } from "../common/Observer";

const counter = () =>
  createSlice({
    state: { count: 0, label: "x" },
    actions: {
      increment: (s, n: number) => ({ count: s.count + n }),
      decrement: (s, n: number) => ({ count: s.count - n }),
      rename: (_s, label: string) => ({ label }),
      later: async (s, n: number) => ({ count: s.count + n }),
    },
  });

describe("Slice", () => {
  it("wraps every state in Observer", () => {
    const slice = counter();
    expect(slice).toBeInstanceOf(Slice);
    expect(slice.getState("count")).toBeInstanceOf(Observer);
    expect(slice.getState("count").get()).toBe(0);
  });

  it("passes current state to the action by itself", () => {
    const slice = counter();
    slice.actions.increment(10);
    slice.actions.decrement(3);
    expect(slice.getState("count").get()).toBe(7);
  });

  it("changes only returned keys", () => {
    const slice = counter();
    const onCount = jest.fn();
    const onLabel = jest.fn();
    slice.getState("count").subscribe(onCount);
    slice.getState("label").subscribe(onLabel);

    slice.actions.increment(1);

    expect(onCount).toHaveBeenCalledWith(1);
    expect(onLabel).not.toHaveBeenCalled();
  });

  it("does not notify when value is the same", () => {
    const slice = counter();
    const fn = jest.fn();
    slice.getState("count").subscribe(fn);
    slice.actions.increment(0);
    expect(fn).not.toHaveBeenCalled();
  });

  it("supports async actions", async () => {
    const slice = counter();
    const done = slice.actions.later(5);
    expect(slice.getState("count").get()).toBe(0);
    await done;
    expect(slice.getState("count").get()).toBe(5);
  });

  it("rejects the promise when async action fails", async () => {
    const slice = createSlice({
      state: { n: 0 },
      actions: {
        fail: async () => {
          throw new Error("boom");
        },
      },
    });
    await expect(slice.actions.fail()).rejects.toThrow("boom");
    expect(slice.getState("n").get()).toBe(0);
  });

  it("returns readonly snapshot of all states", () => {
    const slice = counter();
    slice.actions.increment(2);
    expect(slice.snapshot()).toEqual({ count: 2, label: "x" });
  });

  it("throws when action returns unknown key", () => {
    const slice = createSlice({
      state: { a: 1 },
      actions: { bad: () => ({ b: 2 } as any) },
    });
    expect(() => slice.actions.bad()).toThrow('unknown state key "b"');
  });

  it("throws when action returns not an object", () => {
    const slice = createSlice({
      state: { a: 1 },
      actions: { bad: () => 5 as never, none: () => undefined as never },
    });
    expect(() => slice.actions.bad()).toThrow("must return an object");
    expect(() => slice.actions.none()).toThrow("must return an object");
  });

  it("does not change anything when a patch has an unknown key", () => {
    const slice = createSlice({
      state: { a: 1 },
      actions: { bad: () => ({ a: 2, b: 3 } as never) },
    });
    expect(() => slice.actions.bad()).toThrow('unknown state key "b"');
    expect(slice.getState("a").get()).toBe(1);
  });

  it("freezes state values outside production", () => {
    const slice = createSlice({
      state: { list: [1] as number[], user: { name: "a" } },
      actions: {
        add: (s, n: number) => ({ list: [...s.list, n] }),
      },
    });
    slice.actions.add(2);

    const list = slice.getState("list").get() as number[];
    expect(list).toEqual([1, 2]);
    expect(() => list.push(3)).toThrow();
    expect(() => {
      (slice.getState("user").get() as { name: string }).name = "b";
    }).toThrow();
  });
});
