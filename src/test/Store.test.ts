import { createSlice } from "../common/Slice";
import { createStore } from "../common/Store";

const counterSlice = () =>
  createSlice({
    state: { count: 0 },
    actions: { increment: (s, n: number) => ({ count: s.count + n }) },
  });

describe("Store", () => {
  it("serves slices by the key", () => {
    const counter = counterSlice();
    const todos = createSlice({
      state: { list: [] as string[] },
      actions: { add: (s, item: string) => ({ list: [...s.list, item] }) },
    });
    const store = createStore({ counter, todos });

    expect(store.getSlice("counter")).toBe(counter);
    expect(store.slices.todos).toBe(todos);
  });

  it("calls actions of the slice from the store", () => {
    const store = createStore({ counter: counterSlice() });
    const slice = store.getSlice("counter");

    slice.actions.increment(5);

    expect(slice.getState("count").get()).toBe(5);
  });

  it("calls subscribers of observers inside slices", () => {
    const store = createStore({ counter: counterSlice() });
    const slice = store.getSlice("counter");
    const fn = jest.fn();
    slice.getState("count").subscribe(fn);

    slice.actions.increment(10);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(10);
  });
});
