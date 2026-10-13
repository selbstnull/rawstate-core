import { Observer } from "../common/Observer";

describe("Observer", () => {
  it("Init with given value", () => {
    const obs = new Observer(10);
    expect(obs.get()).toBe(10);
  });

  it("Set is change value", () => {
    const obs = new Observer(0);
    obs.set(42);
    expect(obs.get()).toBe(42);
  });

  it("Subscribers calls by a set", () => {
    const obs = new Observer(0);
    const mockFn = jest.fn();

    obs.subscribe(mockFn);
    obs.set(5);

    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(mockFn).toHaveBeenCalledWith(5);
  });

  it("Unsubscribe work test", () => {
    const obs = new Observer(0);
    const mockFn = jest.fn();

    const unsubscribe = obs.subscribe(mockFn);
    obs.set(1);
    unsubscribe();
    obs.set(2);

    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(mockFn).toHaveBeenCalledWith(1);
  });
});

describe("Observer equality and safety", () => {
  it("does not call subscribers when the value is the same", () => {
    const obs = new Observer(1);
    const fn = jest.fn();
    obs.subscribe(fn);
    obs.set(1);
    expect(fn).not.toHaveBeenCalled();
  });

  it("allows unsubscribe while notifying", () => {
    const obs = new Observer(0);
    const second = jest.fn();
    const off = obs.subscribe(() => off());
    obs.subscribe(second);
    obs.set(1);
    expect(second).toHaveBeenCalledWith(1);
  });

  it("get and subscribe can be passed around unbound", () => {
    const obs = new Observer(3);
    const { get, subscribe } = obs;
    expect(get()).toBe(3);
    const fn = jest.fn();
    subscribe(fn);
    obs.set(4);
    expect(fn).toHaveBeenCalledWith(4);
  });
});
