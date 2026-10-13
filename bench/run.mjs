// Benchmark of the store on big collections.
//   yarn bench                 development mode (rows are frozen, like in dev)
//   NODE_ENV=production yarn bench
// Results are printed and saved to bench/results/latest-<mode>.json
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  createCollection,
  createStore,
  relation,
  rollup,
  sum,
} from "../dist/index.mjs";

const mode = process.env.NODE_ENV === "production" ? "production" : "development";
const SIZES = (process.env.SIZES ?? "1000,10000,100000").split(",").map(Number);
// scenarios with relations and rules are skipped above this size (the old version needs hours there)
const BANK_MAX = Number(process.env.BANK_MAX ?? Infinity);

const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

function measure(fn, { runs = 15, warm = 3 } = {}) {
  for (let i = 0; i < warm; i++) fn(i - warm);
  const times = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn(i);
    times.push(performance.now() - start);
  }
  return median(times);
}

const user = (i) => ({ id: `u${i}`, name: `User ${i}`, debt: 0, age: i % 90 });
const credit = (i, users) => ({ id: i, userId: `u${i % users}`, amount: 10 });

function makeUsers(n) {
  const users = createCollection({ key: "id", rows: [] });
  users.actions.addMany(Array.from({ length: n }, (_, i) => user(i)));
  return users;
}

function makeBank(n) {
  const users = createCollection({ key: "id", rows: [] });
  const credits = createCollection({ key: "id", rows: [] });
  users.actions.addMany(Array.from({ length: n }, (_, i) => user(i)));
  credits.actions.addMany(Array.from({ length: n * 2 }, (_, i) => credit(i, n)));
  const store = createStore(
    { users, credits },
    {
      relations: [relation(credits, "userId", users, { onDelete: "cascade" })],
      rules: [rollup(users, "debt", sum(credits, "userId", "amount"))],
    }
  );
  return { users, credits, store };
}

const results = {};
function record(size, name, ms) {
  (results[size] ??= {})[name] = Number(ms.toFixed(4));
}

for (const n of SIZES) {
  const big = n >= 100000;
  const runs = big ? 7 : 15;
  console.error(`... ${n} rows`);

  // loading
  record(n, "load: addMany N rows", measure(() => makeUsers(n), { runs: big ? 3 : 5, warm: 1 }));

  // one change in a collection of N rows
  const users = makeUsers(n);
  let next = n;
  record(n, "add 1 row", measure(() => users.actions.add(user(next++)), { runs }));
  record(n, "update 1 row", measure((i) => users.actions.update(`u${i + 10}`, { debt: i + 1 }), { runs }));
  record(n, "remove 1 row", measure((i) => users.actions.remove(`u${i + 20}`), { runs }));

  // subscribers
  const watched = makeUsers(n);
  for (let i = 0; i < Math.min(100, n); i++) watched.row(`u${i}`).subscribe(() => {});
  watched.rows.subscribe(() => {});
  record(n, "update 1 row, 100 row watchers + rows watcher", measure((i) => watched.actions.update("u50", { debt: i + 1 }), { runs }));

  // reading a group (plain collection, no store)
  const groupedCredits = createCollection({ key: "id", rows: [] });
  groupedCredits.actions.addMany(Array.from({ length: n * 2 }, (_, i) => credit(i, n)));
  const hasWhere = typeof groupedCredits.where === "function";
  record(
    n,
    hasWhere ? "find 1 user's credits (where)" : "find 1 user's credits (scan)",
    measure((i) => {
      const id = `u${(i + 5) % n}`;
      if (hasWhere) groupedCredits.where("userId", id);
      else groupedCredits.all().filter((c) => c.userId === id);
    }, { runs: big ? 7 : 15 })
  );

  if (n <= BANK_MAX) {
    // a store with a relation and a rollup
    const bank = makeBank(n);
    let nextCredit = n * 2;
    record(n, "bank: add 1 credit (relation + rollup)", measure(() => bank.credits.actions.add({ id: nextCredit++, userId: "u7", amount: 5 }), { runs }));
    record(n, "bank: update 1 credit amount", measure((i) => bank.credits.actions.update(i + 100, { amount: 20 + i }), { runs }));
    record(n, "bank: remove 1 user (cascade, 2 credits)", measure((i) => bank.users.actions.remove(`u${i + 30}`), { runs }));
    record(n, "bank: transaction of 3 changes", measure((i) => bank.store.transaction(() => {
      bank.credits.actions.add({ id: nextCredit++, userId: "u9", amount: 1 });
      bank.users.actions.update("u11", { name: `N${i}` });
      bank.credits.actions.update(i + 400, { amount: 3 + i });
    }), { runs }));

    // a listener that sees every commit (this is what persistence uses)
    const listened = makeBank(n);
    let events = 0;
    listened.store.onCommit(() => events++);
    record(n, "bank: update 1 row with an onCommit listener", measure((i) => listened.users.actions.update("u1", { name: `L${i}` }), { runs }));
  }

  const plainStore = createStore({ users: makeUsers(n) });

  // data from the server
  const synced = makeUsers(n);
  const same = Array.from({ length: n }, (_, i) => user(i));
  record(n, "sync N rows, nothing changed", measure(() => synced.sync(same), { runs: big ? 3 : 7, warm: 1 }));
  const withOne = same.map((u, i) => (i === 5 ? { ...u, name: "changed" } : u));
  let flip = false;
  record(n, "sync N rows, 1 changed", measure(() => synced.sync((flip = !flip) ? withOne : same), { runs: big ? 3 : 7, warm: 1 }));

  record(n, "store.snapshot()", measure(() => plainStore.snapshot(), { runs: big ? 3 : 7, warm: 1 }));
}

const file = `bench/results/latest-${mode}.json`;
writeFileSync(file, JSON.stringify({ mode, node: process.version, results }, null, 2));

const baselineFile = `bench/results/baseline-${mode}.json`;
const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, "utf8")).results : null;

const names = Object.keys(results[SIZES[0]]);
const pad = (s, n) => String(s).padEnd(n);
const fmt = (ms) => (ms >= 100 ? ms.toFixed(0) : ms >= 1 ? ms.toFixed(2) : ms.toFixed(3)) + " ms";
console.log(`\nmode: ${mode}, node ${process.version}  (median of several runs)\n`);
console.log(pad("scenario", 50) + SIZES.map((n) => pad(`${n} rows`, baseline ? 24 : 14)).join(""));
for (const name of names) {
  const cells = SIZES.map((n) => {
    const now = results[n]?.[name];
    const was = baseline?.[n]?.[name];
    if (now === undefined) return pad("-", baseline ? 24 : 14);
    const text = fmt(now) + (was !== undefined ? ` (was ${fmt(was)})` : "");
    return pad(text, baseline ? 24 : 14);
  });
  console.log(pad(name, 50) + cells.join(""));
}
