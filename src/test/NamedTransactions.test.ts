import { createCollection } from "../common/Collection";
import { createSlice } from "../common/Slice";
import { createStore } from "../common/Store";

const make = () => {
  const users = createCollection<{ id: string; debt: number }>()({
    key: "id",
    rows: [{ id: "u1", debt: 0 }],
  });
  const credits = createCollection<{ id: number; userId: string; amount: number }>()({
    key: "id",
  });
  const counter = createSlice({
    state: { next: 1 },
    actions: { bump: (s) => ({ next: s.next + 1 }) },
  });

  const store = createStore(
    { users, credits, counter },
    {
      transactions: {
        openCredit: (s, userId: string, amount: number) => {
          const id = s.counter.getState("next").get();
          s.counter.actions.bump();
          s.credits.actions.add({ id, userId, amount });
          s.users.actions.update(userId, (u) => ({ debt: u.debt + amount }));
          return id;
        },
        broken: (s) => {
          s.credits.actions.add({ id: 99, userId: "u1", amount: 1 });
          throw new Error("boom");
        },
      },
    }
  );
  return { users, credits, counter, store };
};

describe("named transactions", () => {
  it("change several slices at once and return a value", () => {
    const { users, credits, store } = make();
    const fn = jest.fn();
    users.rows.subscribe(fn);

    const id: number = store.transactions.openCredit("u1", 100);

    expect(id).toBe(1);
    expect(credits.get(1)?.amount).toBe(100);
    expect(users.get("u1")?.debt).toBe(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("roll back when they throw", () => {
    const { credits, store } = make();
    expect(() => store.transactions.broken()).toThrow("boom");
    expect(credits.size.get()).toBe(0);
  });

  it("can be called inside another transaction", () => {
    const { users, store } = make();
    expect(() =>
      store.transaction(() => {
        store.transactions.openCredit("u1", 5);
        throw new Error("outer");
      })
    ).toThrow("outer");
    expect(users.get("u1")?.debt).toBe(0);
  });

  it("are checked by types", () => {
    const { store } = make();
    const check = (_fn: () => void) => {};
    check(() => {
      // @ts-expect-error amount must be a number
      store.transactions.openCredit("u1", "100");
      // @ts-expect-error missing argument
      store.transactions.openCredit("u1");
      // @ts-expect-error there is no such transaction
      store.transactions.nope();
      const slices = { counter: createSlice({ state: { n: 0 }, actions: {} }) };
      // @ts-expect-error a transaction can not be async
      createStore(slices, {
        transactions: {
          later: async () => {},
        },
      });
      createStore(slices, {
        transactions: {
          // @ts-expect-error there is no such slice in the store
          wrong: (s) => s.nope,
        },
      });
    });
  });
});
