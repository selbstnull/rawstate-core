import { createSlice } from "../common/Slice";
import { createStore } from "../common/Store";
import { Observer } from "../common/Observer";
import { view, viewFamily } from "../common/View";

const make = () => {
  const cart = createSlice({
    state: { price: 10, count: 1 },
    actions: {
      setCount: (_s, count: number) => ({ count }),
      setPrice: (_s, price: number) => ({ price }),
    },
  });
  const total = view(
    [cart.getState("price"), cart.getState("count")],
    (price, count) => price * count
  );
  return { cart, total };
};

describe("view", () => {
  it("calculates from sources and follows them", () => {
    const { cart, total } = make();
    expect(total.get()).toBe(10);
    cart.actions.setCount(3);
    expect(total.get()).toBe(30);
  });

  it("notifies subscribers when the result changes", () => {
    const { cart, total } = make();
    const fn = jest.fn();
    total.subscribe(fn);
    cart.actions.setCount(2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(20);
  });

  it("does not notify when the result is the same", () => {
    const { cart, total } = make();
    const fn = jest.fn();
    total.subscribe(fn);
    cart.actions.setCount(2);
    cart.actions.setPrice(5);
    expect(fn).toHaveBeenCalledTimes(2);
    cart.actions.setCount(1);
    cart.actions.setPrice(10);
    expect(fn).toHaveBeenCalledTimes(4);
    const same = jest.fn();
    total.subscribe(same);
    cart.actions.setPrice(10);
    expect(same).not.toHaveBeenCalled();
  });

  it("notifies once for a transaction that changes several sources", () => {
    const { cart, total } = make();
    const store = createStore({ cart });
    const fn = jest.fn();
    total.subscribe(fn);

    store.transaction(() => {
      cart.actions.setCount(2);
      cart.actions.setPrice(6);
    });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(12);
  });

  it("does not calculate again while sources are the same", () => {
    const compute = jest.fn((a: number) => a * 2);
    const source = new Observer(1);
    const doubled = view([source], compute);
    doubled.get();
    doubled.get();
    expect(compute).toHaveBeenCalledTimes(1);
    source.set(2);
    doubled.get();
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("keeps the same reference when equals says nothing changed", () => {
    const source = new Observer({ id: 1, noise: 0 });
    const byId = view([source], (v) => ({ id: v.id }), {
      equals: (a, b) => a.id === b.id,
    });
    const first = byId.get();
    source.set({ id: 1, noise: 1 });
    expect(byId.get()).toBe(first);
  });

  it("works on top of other views", () => {
    const { cart, total } = make();
    const label = view([total], (t) => `Total: ${t}`);
    const fn = jest.fn();
    label.subscribe(fn);
    cart.actions.setCount(2);
    expect(label.get()).toBe("Total: 20");
    expect(fn).toHaveBeenCalledWith("Total: 20");
  });

  it("stops watching sources after the last unsubscribe", () => {
    const source = new Observer(1);
    const doubled = view([source], (a) => a * 2);
    const fn = jest.fn();
    const off = doubled.subscribe(fn);
    off();
    source.set(2);
    expect(fn).not.toHaveBeenCalled();
    expect(doubled.get()).toBe(4);
  });

  it("infers types of sources", () => {
    const a = new Observer(1);
    const b = new Observer("x");
    const v = view([a, b], (n, s) => {
      const num: number = n;
      const str: string = s;
      return `${num}${str}`;
    });
    const result: string = v.get();
    expect(result).toBe("1x");
    // @ts-expect-error callback has wrong parameter type
    view([a], (n: string) => n);
  });
});

describe("viewFamily", () => {
  it("gives the same view for the same argument", () => {
    const source = new Observer({ a: 1, b: 2 } as Record<string, number>);
    const pick = viewFamily((key: string) =>
      view([source], (m) => m[key])
    );
    expect(pick("a")).toBe(pick("a"));
    expect(pick("a")).not.toBe(pick("b"));
    expect(pick("b").get()).toBe(2);
  });
});
