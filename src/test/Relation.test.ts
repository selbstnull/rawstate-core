import { createCollection } from "../common/Collection";
import { IntegrityError, relation } from "../common/Relation";
import { createStore } from "../common/Store";

interface User { id: string; name: string }
interface Credit { id: number; userId: string; note: string | null }
interface Payment { id: number; creditId: number }
interface Note { id: number; userId: string | null }

const make = (onDeleteCredits: "cascade" | "restrict" = "cascade") => {
  const users = createCollection<User>()({
    key: "id",
    rows: [{ id: "u1", name: "Ann" }, { id: "u2", name: "Bob" }],
  });
  const credits = createCollection<Credit>()({ key: "id" });
  const payments = createCollection<Payment>()({ key: "id" });
  const store = createStore(
    { users, credits, payments },
    {
      relations: [
        relation(credits, "userId", users, { onDelete: onDeleteCredits }),
        relation(payments, "creditId", credits, { onDelete: "restrict" }),
      ],
    }
  );
  return { users, credits, payments, store };
};

describe("relations: references must exist", () => {
  it("rejects a row that refers to a missing parent", () => {
    const { credits } = make();
    expect(() =>
      credits.actions.add({ id: 1, userId: "nope", note: null })
    ).toThrow(IntegrityError);
    expect(() =>
      credits.actions.add({ id: 1, userId: "nope", note: null })
    ).toThrow('credits["1"].userId = "nope": there is no such row in users');
    expect(credits.size.get()).toBe(0);
  });

  it("accepts a reference to an existing parent", () => {
    const { credits } = make();
    credits.actions.add({ id: 1, userId: "u1", note: null });
    expect(credits.size.get()).toBe(1);
  });

  it("rejects an update that points to a missing parent", () => {
    const { credits } = make();
    credits.actions.add({ id: 1, userId: "u1", note: null });
    expect(() => credits.actions.update(1, { userId: "ghost" })).toThrow(
      IntegrityError
    );
    expect(credits.get(1)?.userId).toBe("u1");
  });

  it("the order of changes inside a transaction does not matter", () => {
    const { users, credits, store } = make();
    store.transaction(() => {
      credits.actions.add({ id: 1, userId: "u3", note: null });
      users.actions.add({ id: "u3", name: "Cat" });
    });
    expect(credits.get(1)?.userId).toBe("u3");
  });

  it("an empty reference (null) is allowed", () => {
    const users = createCollection<User>()({ key: "id" });
    const notes = createCollection<Note>()({ key: "id" });
    createStore({ users, notes }, {
      relations: [relation(notes, "userId", users, { onDelete: "setNull" })],
    });
    notes.actions.add({ id: 1, userId: null });
    expect(notes.get(1)?.userId).toBeNull();
  });
});

describe("relations: onDelete", () => {
  it("cascade removes the rows that refer to the parent, through several levels", () => {
    const { users, credits, payments, store } = make("cascade");
    store.transaction(() => {
      credits.actions.add({ id: 1, userId: "u1", note: null });
      credits.actions.add({ id: 2, userId: "u2", note: null });
      payments.actions.add({ id: 1, creditId: 1 });
    });
    // payments restrict removing a credit, so remove them first in the same transaction
    store.transaction(() => {
      payments.actions.remove(1);
      users.actions.remove("u1");
    });
    expect(credits.all().map((c) => c.id)).toEqual([2]);
  });

  it("cascade is one transaction: subscribers are notified once", () => {
    const { users, credits, store } = make("cascade");
    credits.actions.addMany([
      { id: 1, userId: "u1", note: null },
      { id: 2, userId: "u1", note: null },
    ]);
    const onCredits = jest.fn();
    credits.rows.subscribe(onCredits);

    users.actions.remove("u1");

    expect(credits.size.get()).toBe(0);
    expect(onCredits).toHaveBeenCalledTimes(1);
    expect(store.getSlice("credits")).toBe(credits);
  });

  it("restrict blocks removing the parent and rolls the transaction back", () => {
    const { users, credits, store } = make("restrict");
    credits.actions.add({ id: 1, userId: "u1", note: null });
    const fn = jest.fn();
    users.rows.subscribe(fn);

    expect(() => users.actions.remove("u1")).toThrow(IntegrityError);
    expect(() => users.actions.remove("u1")).toThrow(
      'Can not remove users["u1"]: 1 row(s) of credits refer to it by userId'
    );
    expect(users.has("u1")).toBe(true);
    expect(fn).not.toHaveBeenCalled();

    // removing the children first, in the same transaction, is fine
    store.transaction(() => {
      users.actions.remove("u1");
      credits.actions.remove(1);
    });
    expect(users.has("u1")).toBe(false);
  });

  it("restrict error has a code", () => {
    const { users, credits } = make("restrict");
    credits.actions.add({ id: 1, userId: "u1", note: null });
    try {
      users.actions.remove("u1");
      throw new Error("must not get here");
    } catch (e) {
      expect(e).toBeInstanceOf(IntegrityError);
      expect((e as IntegrityError).code).toBe("restricted");
    }
  });

  it("a restrict deeper in the chain cancels the whole cascade", () => {
    const { users, credits, payments } = make("cascade");
    credits.actions.add({ id: 1, userId: "u1", note: null });
    payments.actions.add({ id: 1, creditId: 1 });

    expect(() => users.actions.remove("u1")).toThrow(IntegrityError);

    expect(users.has("u1")).toBe(true);
    expect(credits.has(1)).toBe(true);
    expect(payments.has(1)).toBe(true);
  });

  it("setNull clears the reference", () => {
    const users = createCollection<User>()({
      key: "id",
      rows: [{ id: "u1", name: "Ann" }],
    });
    const notes = createCollection<Note>()({ key: "id" });
    createStore({ users, notes }, {
      relations: [relation(notes, "userId", users, { onDelete: "setNull" })],
    });
    notes.actions.addMany([
      { id: 1, userId: "u1" },
      { id: 2, userId: null },
    ]);

    users.actions.remove("u1");

    expect(notes.get(1)?.userId).toBeNull();
    expect(notes.size.get()).toBe(2);
  });

  it("works for a collection that refers to itself (a tree)", () => {
    const nodes = createCollection<{ id: number; parentId: number | null }>()({
      key: "id",
    });
    createStore({ nodes }, {
      relations: [relation(nodes, "parentId", nodes, { onDelete: "cascade" })],
    });
    nodes.actions.add({ id: 1, parentId: null });
    nodes.actions.add({ id: 2, parentId: 1 });
    nodes.actions.add({ id: 3, parentId: 2 });
    nodes.actions.add({ id: 4, parentId: null });

    nodes.actions.remove(1);

    expect(nodes.all().map((n) => n.id)).toEqual([4]);
  });

  it("does not touch rows when the parent is removed and added again in one transaction", () => {
    const { users, credits, store } = make("cascade");
    credits.actions.add({ id: 1, userId: "u1", note: null });
    store.transaction(() => {
      users.actions.remove("u1");
      users.actions.add({ id: "u1", name: "Ann again" });
    });
    expect(credits.has(1)).toBe(true);
  });
});

describe("relations with transactions of the store", () => {
  it("a failed integrity check rolls back everything the transaction did", () => {
    const { users, credits, store } = make("restrict");
    credits.actions.add({ id: 1, userId: "u1", note: null });

    expect(() =>
      store.transaction(() => {
        users.actions.add({ id: "u9", name: "New" });
        users.actions.remove("u1");
      })
    ).toThrow(IntegrityError);
    expect(users.has("u9")).toBe(false);
  });
});

describe("relations: setup errors and sizes", () => {
  it("a relation to a collection that is not in the store is an error", () => {
    const users = createCollection<User>()({ key: "id" });
    const credits = createCollection<Credit>()({ key: "id" });
    const other = createCollection<User>()({ key: "id" });
    expect(() =>
      createStore({ users }, {
        relations: [relation(credits, "userId", other)],
      })
    ).toThrow("not in the store");
  });

  it("handles thousands of rows", () => {
    const users = createCollection<User>()({ key: "id" });
    const credits = createCollection<Credit>()({ key: "id" });
    createStore({ users, credits }, {
      relations: [relation(credits, "userId", users, { onDelete: "cascade" })],
    });
    const start = Date.now();
    users.actions.addMany(
      Array.from({ length: 5000 }, (_, i) => ({ id: `u${i}`, name: "n" }))
    );
    credits.actions.addMany(
      Array.from({ length: 20000 }, (_, i) => ({
        id: i,
        userId: `u${i % 5000}`,
        note: null,
      }))
    );
    users.actions.remove("u0");
    expect(credits.size.get()).toBe(20000 - 4);
    expect(Date.now() - start).toBeLessThan(3000);
  });
});
