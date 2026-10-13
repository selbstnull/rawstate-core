import { createCollection } from "../common/Collection";
import { createStore } from "../common/Store";

interface User {
  id: string;
  name: string;
  debt: number;
  tags: string[];
}

const make = () =>
  createCollection<User>()({
    key: "id",
    rows: [{ id: "a", name: "Ann", debt: 0, tags: [] }],
  });

describe("Collection", () => {
  it("starts with the given rows and reads them", () => {
    const users = make();
    expect(users.get("a")?.name).toBe("Ann");
    expect(users.has("a")).toBe(true);
    expect(users.has("zzz")).toBe(false);
    expect(users.get("zzz")).toBeUndefined();
    expect(users.all()).toHaveLength(1);
    expect(users.size.get()).toBe(1);
  });

  it("infers the row type from initial rows", () => {
    const items = createCollection({
      key: "sku",
      rows: [{ sku: 1, title: "x" }],
    });
    items.actions.add({ sku: 2, title: "y" });
    expect(items.get(2)?.title).toBe("y");
  });

  it("add, addMany keep the order and reject duplicates", () => {
    const users = make();
    users.actions.add({ id: "b", name: "Bob", debt: 0, tags: [] });
    users.actions.addMany([
      { id: "c", name: "Cat", debt: 0, tags: [] },
      { id: "d", name: "Dan", debt: 0, tags: [] },
    ]);
    expect(users.all().map((u) => u.id)).toEqual(["a", "b", "c", "d"]);

    expect(() =>
      users.actions.add({ id: "a", name: "Again", debt: 0, tags: [] })
    ).toThrow('Row with id "a" already exists');
  });

  it("addMany is all or nothing", () => {
    const users = make();
    expect(() =>
      users.actions.addMany([
        { id: "x", name: "X", debt: 0, tags: [] },
        { id: "a", name: "dup", debt: 0, tags: [] },
      ])
    ).toThrow("already exists");
    expect(users.has("x")).toBe(false);
    expect(users.size.get()).toBe(1);
  });

  it("upsert adds or replaces without changing the order", () => {
    const users = make();
    users.actions.add({ id: "b", name: "Bob", debt: 0, tags: [] });
    users.actions.upsert({ id: "a", name: "Anna", debt: 5, tags: [] });
    users.actions.upsert({ id: "c", name: "Cat", debt: 0, tags: [] });
    expect(users.all().map((u) => u.id)).toEqual(["a", "b", "c"]);
    expect(users.get("a")?.name).toBe("Anna");
  });

  it("update takes a patch or a function", () => {
    const users = make();
    users.actions.update("a", { name: "Anna" });
    users.actions.update("a", (u) => ({ debt: u.debt + 3, tags: [...u.tags, "x"] }));
    expect(users.get("a")).toEqual({ id: "a", name: "Anna", debt: 3, tags: ["x"] });
  });

  it("update throws for a missing row and for another id", () => {
    const users = make();
    expect(() => users.actions.update("nope", { name: "x" })).toThrow(
      'Row with id "nope" does not exist'
    );
    expect(() =>
      users.actions.update("a", { id: "other" } as never)
    ).toThrow("can not be changed");
  });

  it("update without real changes keeps the row and does not notify", () => {
    const users = make();
    const before = users.get("a");
    const fn = jest.fn();
    users.row("a").subscribe(fn);
    users.rows.subscribe(fn);
    users.actions.update("a", { name: "Ann" });
    expect(users.get("a")).toBe(before);
    expect(fn).not.toHaveBeenCalled();
  });

  it("remove, removeMany, clear, replaceAll", () => {
    const users = make();
    users.actions.addMany([
      { id: "b", name: "B", debt: 0, tags: [] },
      { id: "c", name: "C", debt: 0, tags: [] },
    ]);
    users.actions.remove("b");
    users.actions.remove("nope");
    expect(users.all().map((u) => u.id)).toEqual(["a", "c"]);

    users.actions.removeMany(["a", "nope", "c"]);
    expect(users.size.get()).toBe(0);

    users.actions.replaceAll([{ id: "z", name: "Z", debt: 0, tags: [] }]);
    expect(users.all().map((u) => u.id)).toEqual(["z"]);
    users.actions.clear();
    expect(users.all()).toEqual([]);
  });

  it("rows are frozen and ids are checked", () => {
    const users = make();
    expect(() => {
      (users.get("a") as User).name = "hack";
    }).toThrow();
    expect(() =>
      users.actions.add({ id: "__proto__", name: "x", debt: 0, tags: [] })
    ).toThrow("can not be an id");
    expect(() => users.actions.add({ id: 5 as never, name: "x", debt: 0, tags: [] })).not.toThrow();
    expect(() => users.actions.add({ id: {} as never, name: "x", debt: 0, tags: [] })).toThrow("string or a number");
  });

  it("names like constructor are normal ids", () => {
    const users = make();
    expect(users.has("constructor")).toBe(false);
    expect(users.get("toString")).toBeUndefined();
    users.actions.add({ id: "constructor", name: "C", debt: 0, tags: [] });
    expect(users.get("constructor")?.name).toBe("C");
  });

  it("number and string ids both work", () => {
    const items = createCollection<{ id: number; v: string }>()({ key: "id" });
    items.actions.add({ id: 1, v: "a" });
    expect(items.get(1)?.v).toBe("a");
    expect(items.row(1).get()?.v).toBe("a");
  });
});

describe("Collection subscriptions", () => {
  it("row(id) notifies only when this row changes", () => {
    const users = make();
    users.actions.add({ id: "b", name: "Bob", debt: 0, tags: [] });
    const onA = jest.fn();
    const onB = jest.fn();
    users.row("a").subscribe(onA);
    users.row("b").subscribe(onB);

    users.actions.update("b", { debt: 1 });

    expect(onA).not.toHaveBeenCalled();
    expect(onB).toHaveBeenCalledTimes(1);
  });

  it("row(id) gives the same object and reacts to add and remove", () => {
    const users = make();
    expect(users.row("x")).toBe(users.row("x"));
    const fn = jest.fn();
    users.row("x").subscribe(fn);
    users.actions.add({ id: "x", name: "X", debt: 0, tags: [] });
    expect(fn).toHaveBeenLastCalledWith(expect.objectContaining({ id: "x" }));
    users.actions.remove("x");
    expect(fn).toHaveBeenLastCalledWith(undefined);
  });

  it("rows and select follow the changes", () => {
    const users = make();
    const debtors = users.select((rows) => rows.filter((u) => u.debt > 0));
    const total = users.select((rows) => rows.reduce((s, u) => s + u.debt, 0));
    const fn = jest.fn();
    debtors.subscribe(fn);

    users.actions.update("a", { debt: 4 });

    expect(debtors.get().map((u) => u.id)).toEqual(["a"]);
    expect(total.get()).toBe(4);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("Collection in a store", () => {
  it("actions join transactions and roll back together", () => {
    const users = make();
    const orders = createCollection<{ id: number; userId: string }>()({ key: "id" });
    const store = createStore({ users, orders });
    const fn = jest.fn();
    users.rows.subscribe(fn);

    expect(() =>
      store.transaction(() => {
        users.actions.update("a", { debt: 1 });
        orders.actions.add({ id: 1, userId: "a" });
        orders.actions.add({ id: 1, userId: "a" });
      })
    ).toThrow("already exists");

    expect(users.get("a")?.debt).toBe(0);
    expect(orders.size.get()).toBe(0);
    expect(fn).not.toHaveBeenCalled();
  });
});
