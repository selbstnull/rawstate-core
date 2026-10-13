import { z } from "zod";
import { createCollection } from "../common/Collection";
import { relation } from "../common/Relation";
import { increment } from "../common/Rule";
import { createSlice } from "../common/Slice";
import { createStore } from "../common/Store";
import { ValidationError } from "../common/validate";
import type { StandardSchemaV1 } from "../types/schema.types";

// a tiny schema written by hand: it shows that nothing but the Standard Schema interface is needed
type Check<T> = (value: unknown, path: string) => { value: T } | { issues: { message: string; path: string }[] };

const primitive = <T>(type: string): Check<T> => (value, path) =>
  typeof value === type
    ? { value: value as T }
    : { issues: [{ message: `expected ${type}`, path }] };

function object<T extends object>(shape: { [K in keyof T]: Check<T[K]> }): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate(value) {
        if (typeof value !== "object" || value === null) {
          return { issues: [{ message: "expected object" }] };
        }
        const out: Record<string, unknown> = {};
        const issues: { message: string; path: string[] }[] = [];
        for (const key of Object.keys(shape) as (keyof T & string)[]) {
          const result = shape[key]((value as Record<string, unknown>)[key], key);
          if ("issues" in result) {
            result.issues.forEach((i) => issues.push({ message: i.message, path: [i.path] }));
          } else out[key] = result.value;
        }
        return issues.length > 0 ? { issues } : { value: out as T };
      },
    },
  };
}

interface User { id: string; name: string; age: number }
const userSchema = object<User>({
  id: primitive<string>("string"),
  name: primitive<string>("string"),
  age: primitive<number>("number"),
});
const good = (id: string): User => ({ id, name: id, age: 30 });

describe("collection with a schema", () => {
  it("checks the initial rows", () => {
    expect(() =>
      createCollection<User>()({ key: "id", schema: userSchema, rows: [{ id: "a", name: "A", age: "x" } as never] })
    ).toThrow(ValidationError);
  });

  it("checks rows that come from outside: sync, apply, load", () => {
    const users = createCollection<User>()({ key: "id", schema: userSchema, rows: [good("a")] });
    const store = createStore({ users });
    const bad = { id: "b", name: "B", age: "old" } as never;

    expect(() => users.sync([good("a"), bad])).toThrow(ValidationError);
    expect(() => store.apply({ collections: { users: { upserted: [bad] } } })).toThrow(ValidationError);
    expect(() => store.load({ collections: { users: [bad] } })).toThrow(ValidationError);

    // nothing was changed by the failed calls
    expect(users.all()).toEqual([good("a")]);
  });

  it("says what is wrong and where", () => {
    const users = createCollection<User>()({ key: "id", schema: userSchema });
    const store = createStore({ users });
    let error: ValidationError | undefined;
    try {
      store.apply({ collections: { users: { upserted: [{ id: "u7", name: 5, age: "x" }] } } });
    } catch (e) {
      error = e as ValidationError;
    }
    expect(error).toBeInstanceOf(ValidationError);
    expect(error!.source).toBe("users");
    expect(error!.issues).toEqual([
      { message: "expected string", path: "name" },
      { message: "expected number", path: "age" },
    ]);
    expect(error!.message).toBe(
      'Invalid row "u7" in "users": name: expected string; age: expected number'
    );
  });

  it("one bad row rejects the whole list, or is left out with onInvalid: skip", () => {
    const users = createCollection<User>()({ key: "id", schema: userSchema });
    const bad = { id: "b", name: "B", age: "old" } as never;
    expect(() => users.sync([good("a"), bad])).toThrow(ValidationError);
    expect(users.size.get()).toBe(0);

    const skipped: unknown[] = [];
    users.sync([good("a"), bad, good("c")], {
      onInvalid: "skip",
      onSkip: (row, error) => skipped.push([row, error.issues[0].path]),
    });
    expect(users.all().map((u) => u.id)).toEqual(["a", "c"]);
    expect(skipped).toEqual([[bad, "age"]]);
  });

  it("syncFrom checks the answer of the server", async () => {
    const users = createCollection<User>()({ key: "id", schema: userSchema });
    await expect(users.syncFrom(async () => [{ id: "a" } as never])).rejects.toBeInstanceOf(ValidationError);
    expect(users.size.get()).toBe(0);
  });

  it("actions are not checked by default (types do it), with validate: always they are", () => {
    const loose = createCollection<User>()({ key: "id", schema: userSchema });
    loose.actions.add({ id: "a", name: "A", age: "x" } as never);
    expect(loose.has("a")).toBe(true);

    const strict = createCollection<User>()({ key: "id", schema: userSchema, validate: "always" });
    expect(() => strict.actions.add({ id: "a", name: "A", age: "x" } as never)).toThrow(ValidationError);
    strict.actions.add(good("a"));
    expect(() => strict.actions.update("a", { age: "x" } as never)).toThrow(ValidationError);
    expect(() => strict.actions.upsert({ id: "a" } as never)).toThrow(ValidationError);
    expect(strict.get("a")).toEqual(good("a"));
  });

  it("an invalid transaction is rolled back with everything else", () => {
    const users = createCollection<User>()({ key: "id", schema: userSchema });
    const store = createStore({ users });
    expect(() =>
      store.transaction(() => {
        users.actions.add(good("a"));
        users.sync([{ id: "x" } as never]);
      })
    ).toThrow(ValidationError);
    expect(users.has("a")).toBe(false);
  });

  it("trusted data is checked too: it is about the shape, not about rules", () => {
    const users = createCollection<User>()({ key: "id", schema: userSchema });
    const store = createStore({ users });
    expect(() =>
      store.apply({ collections: { users: { upserted: [{ id: "x" } as never] } } }, { trusted: true })
    ).toThrow(ValidationError);
  });

  it("works with relations and rules", () => {
    const users = createCollection<User>()({ key: "id", schema: userSchema, rows: [good("a")] });
    const orders = createCollection<{ id: number; userId: string; total: number }>()({
      key: "id",
      schema: object<{ id: number; userId: string; total: number }>({
        id: primitive<number>("number"),
        userId: primitive<string>("string"),
        total: primitive<number>("number"),
      }),
    });
    createStore({ users, orders }, {
      relations: [relation(orders, "userId", users)],
      rules: [increment(users, "age").from(orders, { to: (o) => o.userId, by: (o) => o.total })],
    });
    orders.actions.add({ id: 1, userId: "a", total: 5 });
    expect(users.get("a")?.age).toBe(35);
    expect(() => orders.sync([{ id: 2, userId: "a", total: "no" } as never])).toThrow(ValidationError);
  });
});

describe("a schema can change the data", () => {
  const schema: StandardSchemaV1<unknown, { id: string; at: Date }> = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) => {
        const v = value as { id: string; at: string | Date };
        return { value: { id: v.id, at: new Date(v.at) } };
      },
    },
  };

  it("the rows that are stored are what the schema gives out", () => {
    const events = createCollection<{ id: string; at: Date }>()({ key: "id", schema });
    events.sync([{ id: "a", at: "2024-01-02T00:00:00.000Z" } as never]);
    expect(events.get("a")!.at).toBeInstanceOf(Date);
  });
});

describe("slice with a schema", () => {
  const stateSchema = object<{ theme: string; count: number }>({
    theme: primitive<string>("string"),
    count: primitive<number>("number"),
  });
  const make = (extra = {}) =>
    createSlice({
      state: { theme: "light", count: 0 },
      actions: { bump: (s) => ({ count: s.count + 1 }), set: (_s, theme: string) => ({ theme }) },
      schema: stateSchema,
      ...extra,
    });

  it("checks the initial state", () => {
    expect(() =>
      createSlice({
        state: { theme: 5 as never, count: 0 },
        actions: {},
        schema: stateSchema as never,
      })
    ).toThrow(ValidationError);
  });

  it("checks states that come from outside", () => {
    const slice = make();
    const store = createStore({ settings: slice });
    expect(() => store.apply({ states: { settings: { count: "many" } } })).toThrow(ValidationError);
    expect(() => store.load({ states: { settings: { theme: 1 } } })).toThrow('Invalid state in "settings"');
    expect(slice.snapshot()).toEqual({ theme: "light", count: 0 });

    store.apply({ states: { settings: { theme: "dark" } } });
    expect(slice.getState("theme").get()).toBe("dark");
  });

  it("a failed check rolls back the rest of the same apply", () => {
    const users = createCollection<User>()({ key: "id" });
    const slice = make();
    const store = createStore({ users, settings: slice });
    expect(() =>
      store.apply({
        collections: { users: { upserted: [good("a")] } },
        states: { settings: { count: "x" } },
      })
    ).toThrow(ValidationError);
    expect(users.has("a")).toBe(false);
  });

  it("actions are checked only with validate: always", async () => {
    const loose = make();
    loose.actions.set("dark");
    const strict = createSlice({
      state: { theme: "light", count: 0 },
      actions: { bad: () => ({ theme: 5 as never }), good: () => ({ theme: "dark" }) },
      schema: stateSchema,
      validate: "always",
    });
    expect(() => strict.actions.bad()).toThrow(ValidationError);
    expect(strict.getState("theme").get()).toBe("light");
    strict.actions.good();
    expect(strict.getState("theme").get()).toBe("dark");
  });
});

describe("with zod", () => {
  const User = z.object({ id: z.string(), name: z.string().min(1), age: z.number().int().nonnegative() });

  it("infers the row type from the schema and checks the data", () => {
    const users = createCollection({ key: "id", schema: User });
    users.actions.add({ id: "a", name: "A", age: 3 });
    const age: number = users.get("a")!.age;
    expect(age).toBe(3);

    expect(() => users.sync([{ id: "b", name: "", age: -1 } as never])).toThrow(ValidationError);
    try {
      users.sync([{ id: "b", name: "", age: -1 } as never]);
    } catch (e) {
      expect((e as ValidationError).issues.map((i) => i.path).sort()).toEqual(["age", "name"]);
    }
  });

  it("works for a slice and for conversions", () => {
    const slice = createSlice({
      state: { limit: 10, label: "x" },
      actions: {},
      schema: z.object({ limit: z.coerce.number(), label: z.string() }),
    });
    const store = createStore({ slice });
    store.apply({ states: { slice: { limit: "25" } } });
    expect(slice.getState("limit").get()).toBe(25);
    expect(() => store.apply({ states: { slice: { limit: "many" } } })).toThrow(ValidationError);
  });

  it("an async schema is refused with a clear message", () => {
    const users = createCollection<User>()({
      key: "id",
      schema: {
        "~standard": { version: 1, vendor: "test", validate: async (v) => ({ value: v as User }) },
      },
    });
    expect(() => users.sync([good("a")])).toThrow("Async schemas are not supported");
  });
});

describe("validation types", () => {
  it("the schema must give out the type of the data", () => {
    const check = (_fn: () => void) => {};
    check(() => {
      const wrong = object<{ id: string; other: number }>({
        id: primitive<string>("string"),
        other: primitive<number>("number"),
      });
      // @ts-expect-error the schema gives out another type than the rows
      createCollection<User>()({ key: "id", schema: wrong });
      // @ts-expect-error the schema of a slice must give out the state
      createSlice({ state: { a: 1 }, actions: {}, schema: wrong });
      // @ts-expect-error unknown mode
      createCollection<User>()({ key: "id", validate: "sometimes" });
    });
  });
});
