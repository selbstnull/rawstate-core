// The examples of the documentation. If they stop working, the docs are wrong.
import { z } from "zod";
import {
  createCollection,
  createSlice,
  createStore,
  decrement,
  defineStore,
  increment,
  relation,
  rollup,
  sum,
  view,
} from "../index";

describe("README: a slice", () => {
  it("counter with a sync and an async action", async () => {
    const counter = createSlice({
      state: { count: 0, label: "clicks" },
      actions: {
        increment: (state, by: number) => ({ count: state.count + by }),
        // async: return a function that gets the state at the moment of applying
        incrementLater: async (_state, by: number) => {
          await Promise.resolve();
          return (state) => ({ count: state.count + by });
        },
      },
    });

    counter.actions.increment(2);
    await Promise.all([counter.actions.incrementLater(1), counter.actions.incrementLater(1)]);
    expect(counter.getState("count").get()).toBe(4);

    const double = view([counter.getState("count")], (count) => count * 2);
    expect(double.get()).toBe(8);
  });
});

describe("README: collections, relations and rules", () => {
  interface User { id: string; name: string; debt: number }
  interface Credit { id: number; userId: string; amount: number }

  const make = () => {
    const users = createCollection<User>()({ key: "id" });
    const credits = createCollection<Credit>()({ key: "id" });
    const payments = createCollection<Credit>()({ key: "id" });
    const store = createStore(
      { users, credits, payments },
      {
        relations: [relation(credits, "userId", users, { onDelete: "cascade" })],
        rules: [
          increment(users, "debt").from(credits, { to: (c) => c.userId, by: (c) => c.amount }),
          decrement(users, "debt").from(payments, { to: (p) => p.userId, by: (p) => p.amount }),
        ],
        transactions: {
          openCredit: (s, userId: string, amount: number) => {
            s.credits.actions.add({ id: s.credits.size.get() + 1, userId, amount });
          },
        },
      }
    );
    return { users, credits, payments, store };
  };

  it("the debt follows the credits and payments", () => {
    const { users, credits, payments, store } = make();
    users.actions.add({ id: "ann", name: "Ann", debt: 0 });

    store.transactions.openCredit("ann", 100);
    expect(users.get("ann")?.debt).toBe(100);

    payments.actions.add({ id: 1, userId: "ann", amount: 30 });
    expect(users.get("ann")?.debt).toBe(70);

    expect(credits.where("userId", "ann")).toHaveLength(1);
    users.actions.remove("ann");
    expect(credits.size.get()).toBe(0);
  });

  it("rollup keeps a field equal to a sum", () => {
    const users = createCollection<User>()({ key: "id", rows: [{ id: "a", name: "A", debt: 0 }] });
    const credits = createCollection<Credit>()({ key: "id" });
    createStore({ users, credits }, { rules: [rollup(users, "debt", sum(credits, "userId", "amount"))] });
    credits.actions.add({ id: 1, userId: "a", amount: 5 });
    credits.actions.add({ id: 2, userId: "a", amount: 7 });
    expect(users.get("a")?.debt).toBe(12);
  });
});

describe("README: a server and a client", () => {
  it("the state goes through JSON, with a schema the data is checked", () => {
    const Event = z.object({ id: z.string(), at: z.coerce.date() });
    const appStore = defineStore({
      slices: () => ({ events: createCollection({ key: "id", schema: Event }) }),
    });

    const server = appStore.create({
      snapshot: { collections: { events: [{ id: "e1", at: "2024-05-01T00:00:00.000Z" }] } },
    });
    const wire = JSON.stringify(server.snapshot());
    server.dispose();

    const client = appStore.create({ snapshot: JSON.parse(wire) });
    expect(client.slices.events.get("e1")!.at).toBeInstanceOf(Date);
  });
});
