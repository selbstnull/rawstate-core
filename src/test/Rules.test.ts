import { createCollection } from "../common/Collection";
import { IntegrityError, relation } from "../common/Relation";
import {
  count,
  decrement,
  increment,
  op,
  rollup,
  rule,
  sum,
} from "../common/Rule";
import { createStore } from "../common/Store";

interface User { id: string; name: string; debt: number; credits: number; blocked: boolean }
interface Credit { id: number; userId: string; amount: number }
interface Payment { id: number; userId: string; amount: number }

const user = (id: string, extra: Partial<User> = {}): User => ({
  id, name: id, debt: 0, credits: 0, blocked: false, ...extra,
});

const collections = () => ({
  users: createCollection<User>()({ key: "id", rows: [user("u1"), user("u2")] }),
  credits: createCollection<Credit>()({ key: "id" }),
  payments: createCollection<Payment>()({ key: "id" }),
});

describe("rule and op", () => {
  it("handlers return operations that run in the same transaction", () => {
    const { users, credits, payments } = collections();
    const store = createStore({ users, credits, payments }, {
      rules: [
        rule(credits, {
          inserted: (c) => op.increment(users, c.userId, "debt", c.amount),
          removed: (c) => op.increment(users, c.userId, "debt", -c.amount),
        }),
      ],
    });
    const onUsers = jest.fn();
    users.rows.subscribe(onUsers);

    credits.actions.add({ id: 1, userId: "u1", amount: 100 });
    expect(users.get("u1")?.debt).toBe(100);
    expect(onUsers).toHaveBeenCalledTimes(1);

    credits.actions.remove(1);
    expect(users.get("u1")?.debt).toBe(0);
    expect(store.getSlice("users")).toBe(users);
  });

  it("the rule result is rolled back together with the change", () => {
    const { users, credits } = collections();
    const store = createStore({ users, credits }, {
      rules: [rule(credits, { inserted: (c) => op.increment(users, c.userId, "debt", c.amount) })],
    });
    expect(() =>
      store.transaction(() => {
        credits.actions.add({ id: 1, userId: "u1", amount: 50 });
        throw new Error("boom");
      })
    ).toThrow("boom");
    expect(users.get("u1")?.debt).toBe(0);
    expect(credits.size.get()).toBe(0);
  });

  it("a handler can return a list, nothing, or several kinds of operations", () => {
    const { users, credits } = collections();
    createStore({ users, credits }, {
      rules: [
        rule(credits, {
          inserted: (c) => [
            op.increment(users, c.userId, "debt", c.amount),
            op.increment(users, c.userId, "credits", 1),
          ],
          removed: () => undefined,
        }),
      ],
    });
    credits.actions.add({ id: 1, userId: "u1", amount: 10 });
    expect(users.get("u1")).toMatchObject({ debt: 10, credits: 1 });
    credits.actions.remove(1);
    expect(users.get("u1")).toMatchObject({ debt: 10, credits: 1 });
  });

  it("sees the net result of a transaction: add and remove inside it is invisible", () => {
    const { users, credits } = collections();
    const inserted = jest.fn();
    const store = createStore({ users, credits }, {
      rules: [rule(credits, { inserted: (c) => (inserted(c), undefined) })],
    });
    store.transaction(() => {
      credits.actions.add({ id: 1, userId: "u1", amount: 1 });
      credits.actions.remove(1);
    });
    expect(inserted).not.toHaveBeenCalled();
  });

  it("updated gives before, after and the changed fields", () => {
    const { users, credits } = collections();
    const seen = jest.fn();
    createStore({ users, credits }, {
      rules: [rule(credits, { updated: ({ before, after, changed }) => (seen(before.amount, after.amount, changed), undefined) })],
    });
    credits.actions.add({ id: 1, userId: "u1", amount: 5 });
    credits.actions.update(1, { amount: 9 });
    expect(seen).toHaveBeenCalledWith(5, 9, ["amount"]);
  });

  it("rules can follow each other", () => {
    const { users, credits } = collections();
    createStore({ users, credits }, {
      rules: [
        rule(credits, {
          inserted: (c) => op.increment(users, c.userId, "debt", c.amount),
          removed: (c) => op.increment(users, c.userId, "debt", -c.amount),
        }),
        rule(users, {
          updated: ({ after }) => op.update(users, after.id, { blocked: after.debt > 100 }),
        }),
      ],
    });
    credits.actions.add({ id: 1, userId: "u1", amount: 150 });
    expect(users.get("u1")?.blocked).toBe(true);
    credits.actions.remove(1);
    credits.actions.add({ id: 2, userId: "u1", amount: 10 });
    expect(users.get("u1")?.blocked).toBe(false);
  });

  it("op.update throws for a missing row, skip is an option, op.increment skips by default", () => {
    const { users, credits } = collections();
    const strict = createStore({ users, credits }, {
      rules: [rule(credits, { inserted: (c) => op.update(users, "ghost", { debt: c.amount }) })],
    });
    expect(() => credits.actions.add({ id: 1, userId: "u1", amount: 1 })).toThrow(
      'Row with id "ghost" does not exist'
    );
    expect(credits.size.get()).toBe(0);
    expect(strict).toBeDefined();
  });

  it("op.increment can be told to throw and op.update to skip", () => {
    const a = collections();
    createStore({ users: a.users, credits: a.credits }, {
      rules: [rule(a.credits, { inserted: () => op.update(a.users, "ghost", { debt: 1 }, { ifMissing: "skip" }) })],
    });
    expect(() => a.credits.actions.add({ id: 1, userId: "u1", amount: 1 })).not.toThrow();

    const b = collections();
    createStore({ users: b.users, credits: b.credits }, {
      rules: [rule(b.credits, { inserted: () => op.increment(b.users, "ghost", "debt", 1, { ifMissing: "throw" }) })],
    });
    expect(() => b.credits.actions.add({ id: 1, userId: "u1", amount: 1 })).toThrow("does not exist");
  });

  it("op.add, op.upsert and op.remove work inside rules", () => {
    const { users, credits, payments } = collections();
    createStore({ users, credits, payments }, {
      rules: [
        rule(credits, {
          inserted: (c) => op.add(payments, { id: c.id, userId: c.userId, amount: c.amount }),
          removed: (c) => op.remove(payments, c.id),
        }),
      ],
    });
    credits.actions.add({ id: 7, userId: "u1", amount: 3 });
    expect(payments.get(7)?.amount).toBe(3);
    credits.actions.remove(7);
    expect(payments.has(7)).toBe(false);
  });

  it("loops are detected and the transaction is rolled back", () => {
    const { users } = collections();
    createStore({ users }, {
      rules: [
        rule(users, { updated: ({ after }) => op.update(users, after.id, { debt: after.debt + 1 }) }),
      ],
    });
    let error: unknown;
    try {
      users.actions.update("u1", { debt: 5 });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(IntegrityError);
    expect((error as IntegrityError).code).toBe("rule-loop");
    expect(users.get("u1")?.debt).toBe(0);
  });

  it("a rule can not change a collection that is not in the store", () => {
    const { users, credits, payments } = collections();
    createStore({ users, credits }, {
      rules: [rule(credits, { inserted: (c) => op.add(payments, { id: c.id, userId: c.userId, amount: 1 }) })],
    });
    expect(() => credits.actions.add({ id: 1, userId: "u1", amount: 1 })).toThrow(
      "not in the store"
    );
  });

  it("a rule on a collection that is not in the store is an error", () => {
    const { users, credits } = collections();
    expect(() =>
      createStore({ users }, { rules: [rule(credits, {})] })
    ).toThrow("not in the store");
  });
});

describe("increment and decrement", () => {
  const setup = () => {
    const c = collections();
    const store = createStore(c, {
      relations: [relation(c.credits, "userId", c.users, { onDelete: "cascade" })],
      rules: [
        increment(c.users, "debt").from(c.credits, { to: (x) => x.userId, by: (x) => x.amount }),
        increment(c.users, "credits").from(c.credits, { to: (x) => x.userId }),
        decrement(c.users, "debt").from(c.payments, { to: (x) => x.userId, by: (x) => x.amount }),
      ],
    });
    return { ...c, store };
  };

  it("adds when a row appears and takes back when it is removed", () => {
    const { users, credits } = setup();
    credits.actions.add({ id: 1, userId: "u1", amount: 100 });
    credits.actions.add({ id: 2, userId: "u1", amount: 50 });
    expect(users.get("u1")).toMatchObject({ debt: 150, credits: 2 });
    credits.actions.remove(1);
    expect(users.get("u1")).toMatchObject({ debt: 50, credits: 1 });
  });

  it("moves the difference when a row changes and the amount when it is given to another", () => {
    const { users, credits } = setup();
    credits.actions.add({ id: 1, userId: "u1", amount: 100 });

    credits.actions.update(1, { amount: 130 });
    expect(users.get("u1")?.debt).toBe(130);

    credits.actions.update(1, { userId: "u2" });
    expect(users.get("u1")).toMatchObject({ debt: 0, credits: 0 });
    expect(users.get("u2")).toMatchObject({ debt: 130, credits: 1 });
  });

  it("a change that does not matter does not touch the target", () => {
    const { users, credits } = setup();
    credits.actions.add({ id: 1, userId: "u1", amount: 100 });
    const fn = jest.fn();
    users.row("u1").subscribe(fn);
    credits.actions.update(1, { amount: 100 });
    expect(fn).not.toHaveBeenCalled();
  });

  it("decrement takes from the field", () => {
    const { users, credits, payments } = setup();
    credits.actions.add({ id: 1, userId: "u1", amount: 100 });
    payments.actions.add({ id: 1, userId: "u1", amount: 30 });
    expect(users.get("u1")?.debt).toBe(70);
    payments.actions.remove(1);
    expect(users.get("u1")?.debt).toBe(100);
  });

  it("removing the owner with a cascade does not fail on the counters", () => {
    const { users, credits } = setup();
    credits.actions.add({ id: 1, userId: "u1", amount: 100 });
    users.actions.remove("u1");
    expect(users.has("u1")).toBe(false);
    expect(credits.size.get()).toBe(0);
  });

  it("everything in one transaction notifies once", () => {
    const { users, credits, payments, store } = setup();
    const fn = jest.fn();
    users.row("u1").subscribe(fn);
    store.transaction(() => {
      credits.actions.add({ id: 1, userId: "u1", amount: 100 });
      credits.actions.add({ id: 2, userId: "u1", amount: 20 });
      payments.actions.add({ id: 1, userId: "u1", amount: 5 });
    });
    expect(users.get("u1")?.debt).toBe(115);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("rollup", () => {
  it("keeps the field equal to the sum or to the count of the children", () => {
    const { users, credits, payments } = collections();
    createStore({ users, credits, payments }, {
      rules: [
        rollup(users, "debt", sum(credits, "userId", "amount")),
        rollup(users, "credits", count(credits, "userId")),
      ],
    });
    credits.actions.addMany([
      { id: 1, userId: "u1", amount: 100 },
      { id: 2, userId: "u1", amount: 20 },
      { id: 3, userId: "u2", amount: 7 },
    ]);
    expect(users.get("u1")).toMatchObject({ debt: 120, credits: 2 });
    expect(users.get("u2")).toMatchObject({ debt: 7, credits: 1 });

    credits.actions.update(2, { userId: "u2", amount: 30 });
    expect(users.get("u1")).toMatchObject({ debt: 100, credits: 1 });
    expect(users.get("u2")).toMatchObject({ debt: 37, credits: 2 });

    credits.actions.remove(1);
    expect(users.get("u1")).toMatchObject({ debt: 0, credits: 0 });
  });

  it("brings existing rows in line when the store is created", () => {
    const users = createCollection<User>()({ key: "id", rows: [user("u1", { debt: 999 })] });
    const credits = createCollection<Credit>()({ key: "id", rows: [{ id: 1, userId: "u1", amount: 40 }] });
    createStore({ users, credits }, {
      rules: [rollup(users, "debt", sum(credits, "userId", "amount"))],
    });
    expect(users.get("u1")?.debt).toBe(40);
  });

  it("a new parent gets the value of its children, and editing it by hand does not hold", () => {
    const { users, credits } = collections();
    createStore({ users, credits }, {
      rules: [rollup(users, "debt", sum(credits, "userId", "amount"))],
    });
    users.actions.add(user("u3", { debt: 5 }));
    expect(users.get("u3")?.debt).toBe(0);

    credits.actions.add({ id: 1, userId: "u3", amount: 10 });
    users.actions.update("u3", { debt: 12345 });
    expect(users.get("u3")?.debt).toBe(10);
  });

  it("works together with cascade relations", () => {
    const { users, credits } = collections();
    createStore({ users, credits }, {
      relations: [relation(credits, "userId", users, { onDelete: "cascade" })],
      rules: [rollup(users, "debt", sum(credits, "userId", "amount"))],
    });
    credits.actions.add({ id: 1, userId: "u1", amount: 10 });
    users.actions.remove("u1");
    expect(users.has("u1")).toBe(false);
    expect(credits.size.get()).toBe(0);
  });

  it("is atomic with the change that caused it", () => {
    const { users, credits } = collections();
    const store = createStore({ users, credits }, {
      rules: [rollup(users, "debt", sum(credits, "userId", "amount"))],
    });
    expect(() =>
      store.transaction(() => {
        credits.actions.add({ id: 1, userId: "u1", amount: 10 });
        throw new Error("no");
      })
    ).toThrow("no");
    expect(users.get("u1")?.debt).toBe(0);
  });
});

describe("rules with named transactions", () => {
  it("the user writes only the transaction, the rest follows from the rules", () => {
    const { users, credits, payments } = collections();
    const store = createStore({ users, credits, payments }, {
      relations: [relation(credits, "userId", users)],
      rules: [rollup(users, "debt", sum(credits, "userId", "amount"))],
      transactions: {
        openCredit: (s, userId: string, amount: number) => {
          s.credits.actions.add({ id: s.credits.size.get() + 1, userId, amount });
        },
      },
    });
    store.transactions.openCredit("u1", 100);
    store.transactions.openCredit("u1", 50);
    expect(users.get("u1")?.debt).toBe(150);
    expect(() => store.transactions.openCredit("nobody", 1)).toThrow(IntegrityError);
  });
});
