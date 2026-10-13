import { createCollection } from "../common/Collection";
import { relation } from "../common/Relation";
import { rollup, sum } from "../common/Rule";
import { createStore } from "../common/Store";

interface Credit { id: number; userId: string | null; amount: number; tag?: string }

const make = () =>
  createCollection<Credit>()({
    key: "id",
    rows: [
      { id: 1, userId: "a", amount: 10 },
      { id: 2, userId: "b", amount: 20 },
      { id: 3, userId: "a", amount: 30 },
      { id: 4, userId: null, amount: 40 },
    ],
  });

const ids = (rows: readonly { id: number }[]) => rows.map((r) => r.id);

describe("where", () => {
  it("finds the rows with a value, first in the order of the collection", () => {
    const credits = make();
    expect(ids(credits.where("userId", "a"))).toEqual([1, 3]);
    expect(ids(credits.where("userId", "b"))).toEqual([2]);
    expect(ids(credits.where("userId", "nobody"))).toEqual([]);
    expect(ids(credits.where("userId", null))).toEqual([4]);
    expect(ids(credits.where("amount", 20))).toEqual([2]);
  });

  it("follows adding, changing and removing rows", () => {
    const credits = make();
    credits.where("userId", "a");

    credits.actions.add({ id: 5, userId: "a", amount: 1 });
    expect(ids(credits.where("userId", "a"))).toEqual([1, 3, 5]);

    credits.actions.update(1, { userId: "b" });
    expect(ids(credits.where("userId", "a"))).toEqual([3, 5]);
    expect(ids(credits.where("userId", "b"))).toEqual([2, 1]);

    credits.actions.remove(3);
    expect(ids(credits.where("userId", "a"))).toEqual([5]);

    credits.actions.clear();
    expect(credits.where("userId", "a")).toEqual([]);
  });

  it("changing another field does not move a row inside its group", () => {
    const credits = make();
    credits.where("userId", "a");
    credits.actions.update(1, { amount: 99 });
    expect(ids(credits.where("userId", "a"))).toEqual([1, 3]);
    expect(credits.where("userId", "a")[0].amount).toBe(99);
  });

  it("number and text are different values, only simple values can be found", () => {
    const rows = createCollection<{ id: number; v: string | number | object }>()({
      key: "id",
      rows: [{ id: 1, v: 1 }, { id: 2, v: "1" }, { id: 3, v: { a: 1 } }],
    });
    expect(ids(rows.where("v", 1))).toEqual([1]);
    expect(ids(rows.where("v", "1"))).toEqual([2]);
    expect(rows.where("v", { a: 1 })).toEqual([]);
  });

  it("is right after a transaction that was rolled back", () => {
    const credits = make();
    const store = createStore({ credits });
    credits.where("userId", "a");
    expect(() =>
      store.transaction(() => {
        credits.actions.add({ id: 9, userId: "a", amount: 1 });
        credits.actions.remove(1);
        expect(ids(credits.where("userId", "a"))).toEqual([3, 9]);
        throw new Error("no");
      })
    ).toThrow("no");
    // the same rows; a row that came back may stand in another place of its group
    expect(ids(credits.where("userId", "a")).sort()).toEqual([1, 3]);
  });

  it("is right after data from outside: sync, apply, load", () => {
    const credits = make();
    const store = createStore({ credits });
    credits.where("userId", "a");

    credits.sync([{ id: 7, userId: "a", amount: 1 }, { id: 8, userId: "z", amount: 1 }]);
    expect(ids(credits.where("userId", "a"))).toEqual([7]);

    store.apply({ collections: { credits: { upserted: [{ id: 10, userId: "a", amount: 1 }], removed: [7] } } });
    expect(ids(credits.where("userId", "a"))).toEqual([10]);

    store.load({ collections: { credits: [{ id: 20, userId: "q", amount: 1 }] } });
    expect(credits.where("userId", "a")).toEqual([]);
    expect(ids(credits.where("userId", "q"))).toEqual([20]);
  });

  it("an index declared in the definition is ready at once", () => {
    const credits = createCollection<Credit>()({
      key: "id",
      indexes: ["userId"],
      rows: [{ id: 1, userId: "a", amount: 1 }],
    });
    expect(ids(credits.where("userId", "a"))).toEqual([1]);
  });

  it("agrees with a plain filter after many random changes", () => {
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const users = ["a", "b", "c", null];
    const credits = createCollection<Credit>()({ key: "id" });
    const store = createStore({ credits });
    credits.where("userId", "a");

    for (let round = 0; round < 60; round++) {
      for (let step = 0; step < 25; step++) {
        const id = Math.floor(random() * 80);
        const pick = random();
        if (pick < 0.35) {
          credits.actions.upsert({ id, userId: users[Math.floor(random() * 4)], amount: id });
        } else if (pick < 0.55) {
          credits.actions.remove(id);
        } else if (pick < 0.8 && credits.has(id)) {
          credits.actions.update(id, { userId: users[Math.floor(random() * 4)] });
        } else if (pick < 0.9) {
          try {
            store.transaction(() => {
              credits.actions.upsert({ id, userId: "a", amount: 1 });
              if (random() < 0.5) throw new Error("rollback");
            });
          } catch {
            /* rolled back */
          }
        } else {
          credits.sync(credits.all().filter((c) => c.id % 2 === 0 || random() < 0.5), { mode: random() < 0.5 ? "replace" : "merge" });
        }
      }
      for (const value of users) {
        expect(ids(credits.where("userId", value)).sort((x, y) => x - y)).toEqual(
          ids(credits.all().filter((c) => c.userId === value)).sort((x, y) => x - y)
        );
      }
    }
  });
});

describe("by", () => {
  it("is a value to watch that changes only with its group", () => {
    const credits = make();
    const group = credits.by("userId", "a");
    const fn = jest.fn();
    group.subscribe(fn);
    expect(ids(group.get())).toEqual([1, 3]);

    credits.actions.update(2, { amount: 1 });          // another group
    credits.actions.add({ id: 6, userId: "b", amount: 1 });
    expect(fn).not.toHaveBeenCalled();

    credits.actions.add({ id: 7, userId: "a", amount: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(ids(fn.mock.calls[0][0])).toEqual([1, 3, 7]);

    credits.actions.update(1, { amount: 5 });          // a row of the group
    expect(fn).toHaveBeenCalledTimes(2);

    credits.actions.update(3, { userId: "b" });        // leaves the group
    expect(ids(group.get())).toEqual([1, 7]);
  });

  it("gives the same object for the same arguments", () => {
    const credits = make();
    expect(credits.by("userId", "a")).toBe(credits.by("userId", "a"));
    expect(credits.by("userId", "a")).not.toBe(credits.by("userId", "b"));
  });
});

describe("indexes in relations and rules", () => {
  it("cascade, restrict and rollup give the same results as before", () => {
    const users = createCollection<{ id: string; debt: number }>()({
      key: "id",
      rows: [{ id: "a", debt: 0 }, { id: "b", debt: 0 }],
    });
    const credits = createCollection<Credit>()({ key: "id" });
    createStore({ users, credits }, {
      relations: [relation(credits, "userId", users, { onDelete: "cascade" })],
      rules: [rollup(users, "debt", sum(credits, "userId", "amount"))],
    });
    credits.actions.addMany([
      { id: 1, userId: "a", amount: 10 },
      { id: 2, userId: "a", amount: 5 },
      { id: 3, userId: "b", amount: 7 },
    ]);
    expect(users.get("a")?.debt).toBe(15);

    credits.actions.update(2, { userId: "b" });
    expect(users.get("a")?.debt).toBe(10);
    expect(users.get("b")?.debt).toBe(12);

    users.actions.remove("b");
    expect(credits.all().map((c) => c.id)).toEqual([1]);
  });

  it("a big collection does not get slower with its size", () => {
    const users = createCollection<{ id: string; debt: number }>()({ key: "id" });
    const credits = createCollection<Credit>()({ key: "id" });
    createStore({ users, credits }, {
      relations: [relation(credits, "userId", users, { onDelete: "cascade" })],
      rules: [rollup(users, "debt", sum(credits, "userId", "amount"))],
    });
    users.actions.addMany(Array.from({ length: 20000 }, (_, i) => ({ id: `u${i}`, debt: 0 })));
    credits.actions.addMany(Array.from({ length: 40000 }, (_, i) => ({ id: i, userId: `u${i % 20000}`, amount: 1 })));

    const start = Date.now();
    for (let i = 0; i < 200; i++) credits.actions.add({ id: 100000 + i, userId: `u${i}`, amount: 2 });
    for (let i = 0; i < 50; i++) users.actions.remove(`u${i + 5000}`);
    // with copying all the rows every time (as it was) this takes about six seconds
    expect(Date.now() - start).toBeLessThan(2500);
    expect(users.get("u3")?.debt).toBe(4); // two credits of 1 and the added one of 2
  });
});

describe("index types", () => {
  it("checks the field and the value", () => {
    const check = (_fn: () => void) => {};
    check(() => {
      const credits = make();
      credits.where("userId", "a");
      credits.by("amount", 10);
      // @ts-expect-error there is no such field
      credits.where("nope", 1);
      // @ts-expect-error the value must have the type of the field
      credits.where("amount", "10");
      // @ts-expect-error unknown field in indexes
      createCollection<Credit>()({ key: "id", indexes: ["nope"] });
    });
  });
});
