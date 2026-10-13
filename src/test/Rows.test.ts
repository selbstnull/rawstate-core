import { diffRows, emptyRows, rowsFrom, type RowMap } from "../common/Rows";

type Row = { id: string; n: number };
const row = (id: string, n = 0): Row => ({ id, n });

const changes = (a: RowMap<Row>, b: RowMap<Row>) => {
  const found: [string, number | undefined, number | undefined][] = [];
  diffRows(a, b, (key, before, after) => found.push([key, before?.n, after?.n]));
  return found.sort((x, y) => x[0].localeCompare(y[0]));
};

describe("Rows", () => {
  it("reads, sets and deletes without changing the old map", () => {
    const empty = emptyRows<Row>();
    const one = empty.set("a", row("a", 1));
    const two = one.set("b", row("b", 2));
    const without = two.delete("a");

    expect([empty.size, one.size, two.size, without.size]).toEqual([0, 1, 2, 1]);
    expect(one.get("a")?.n).toBe(1);
    expect(one.has("b")).toBe(false);
    expect(without.has("a")).toBe(false);
    expect(two.has("a")).toBe(true);
    expect(two.get("zzz")).toBeUndefined();
  });

  it("gives the same map when nothing changes", () => {
    const a = row("a");
    const map = emptyRows<Row>().set("a", a);
    expect(map.set("a", a)).toBe(map);
    expect(map.delete("nope")).toBe(map);
    expect(map.edit(() => {})).toBe(map);
    expect(map.edit((d) => d.set("a", a))).toBe(map);
  });

  it("replaces a value and keeps the size", () => {
    const map = emptyRows<Row>().set("a", row("a", 1));
    const next = map.set("a", row("a", 2));
    expect(next.size).toBe(1);
    expect(next.get("a")?.n).toBe(2);
    expect(map.get("a")?.n).toBe(1);
  });

  it("keys like constructor, toString and numbers are normal keys", () => {
    const map = rowsFrom([["constructor", row("c")], ["toString", row("t")], ["1", row("1")]]);
    expect(map.get("constructor")?.id).toBe("c");
    expect(map.has("hasOwnProperty")).toBe(false);
    expect(map.size).toBe(3);
  });

  it("edit changes many at once and sees its own changes", () => {
    const map = rowsFrom(Array.from({ length: 50 }, (_, i) => [`k${i}`, row(`k${i}`, i)] as const));
    const next = map.edit((d) => {
      d.set("new", row("new", 1));
      expect(d.get("new")?.n).toBe(1);
      d.delete("k1");
      d.delete("k1");
      d.set("k2", row("k2", 99));
      expect(d.size).toBe(50);
    });
    expect(next.size).toBe(50);
    expect(next.get("k2")?.n).toBe(99);
    expect(map.get("k2")?.n).toBe(2);
    expect(map.has("k1")).toBe(true);
    expect(next.has("k1")).toBe(false);
  });

  it("lists keys and values, and visits all", () => {
    const map = rowsFrom([["a", row("a", 1)], ["b", row("b", 2)]]);
    expect(map.keys().sort()).toEqual(["a", "b"]);
    expect(map.values().map((r) => r.n).sort()).toEqual([1, 2]);
    const seen: string[] = [];
    map.forEach((_, key) => seen.push(key));
    expect(seen.sort()).toEqual(["a", "b"]);
  });

  it("rows and the map are frozen in development", () => {
    const map = emptyRows<Row>().set("a", row("a"));
    expect(Object.isFrozen(map)).toBe(true);
    expect(Object.isFrozen(map.get("a"))).toBe(true);
  });

  it("grows and shrinks the table with the number of rows", () => {
    let map = emptyRows<Row>();
    map = map.edit((d) => {
      for (let i = 0; i < 20000; i++) d.set(`k${i}`, row(`k${i}`, i));
    });
    expect(map.size).toBe(20000);
    for (let i = 0; i < 20000; i += 997) expect(map.get(`k${i}`)?.n).toBe(i);

    const small = map.edit((d) => {
      for (let i = 10; i < 20000; i++) d.delete(`k${i}`);
    });
    expect(small.size).toBe(10);
    expect(small.get("k3")?.n).toBe(3);
    expect(small.get("k10")).toBeUndefined();
    expect(small.keys()).toHaveLength(10);
  });
});

describe("diffRows", () => {
  it("is empty for the same map and for equal content in the same objects", () => {
    const a = row("a");
    const map = emptyRows<Row>().set("a", a);
    expect(changes(map, map)).toEqual([]);
    expect(changes(map, map.set("a", a))).toEqual([]);
  });

  it("finds added, changed and removed rows", () => {
    const before = rowsFrom([["a", row("a", 1)], ["b", row("b", 2)], ["c", row("c", 3)]]);
    const after = before.delete("a").set("b", row("b", 20)).set("d", row("d", 4));
    expect(changes(before, after)).toEqual([
      ["a", 1, undefined],
      ["b", 2, 20],
      ["d", undefined, 4],
    ]);
  });

  it("works across a rebuild of the table (grow and shrink)", () => {
    const small = rowsFrom(Array.from({ length: 5 }, (_, i) => [`k${i}`, row(`k${i}`, i)] as const));
    const big = small.edit((d) => {
      for (let i = 5; i < 2000; i++) d.set(`k${i}`, row(`k${i}`, i));
    });
    expect(changes(small, big)).toHaveLength(1995);
    expect(changes(big, small)).toHaveLength(1995);
  });

  it("agrees with a plain comparison on many random changes", () => {
    let seed = 12345;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

    let map = emptyRows<Row>();
    const plain = new Map<string, Row>();
    for (let round = 0; round < 40; round++) {
      const before = map;
      const was = new Map(plain);
      for (let step = 0; step < 30; step++) {
        const key = `k${Math.floor(random() * 300)}`;
        if (random() < 0.3) {
          map = map.delete(key);
          plain.delete(key);
        } else {
          const value = row(key, Math.floor(random() * 5));
          map = map.set(key, value);
          plain.set(key, value);
        }
      }
      const expected: [string, number | undefined, number | undefined][] = [];
      for (const key of new Set([...was.keys(), ...plain.keys()])) {
        if (was.get(key) !== plain.get(key)) expected.push([key, was.get(key)?.n, plain.get(key)?.n]);
      }
      expect(changes(before, map)).toEqual(expected.sort((x, y) => x[0].localeCompare(y[0])));
      expect(map.size).toBe(plain.size);
    }
    expect(map.keys().sort()).toEqual([...plain.keys()].sort());
  });
});
