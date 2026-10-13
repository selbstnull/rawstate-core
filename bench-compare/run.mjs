// rawstate against Zustand, Redux Toolkit, Valtio, MobX and TanStack DB on the same scenarios.
//   NODE_ENV=production node run.mjs                   (build ../rawstate-core first: `yarn build`)
//   SIZES=1000,10000 node run.mjs
// Each library is used the way its own documentation shows, nothing is tuned against it.
// Results go to results.json and results.md
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { configureStore, createEntityAdapter, createSlice } from "@reduxjs/toolkit";
import { createCollection as tdbCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { runInAction, observable, reaction } from "mobx";
import { proxy, subscribe as valtioSubscribe } from "valtio/vanilla";
import { subscribeKey } from "valtio/vanilla/utils";
import { createStore as zustand } from "zustand/vanilla";
import { createCollection, createStore } from "../dist/index.mjs";

const SIZES = (process.env.SIZES ?? "1000,10000,100000").split(",").map(Number);
const production = process.env.NODE_ENV === "production";
const flush = () => new Promise((r) => setTimeout(r, 0)); // valtio and TanStack DB tell their listeners a moment later

const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
async function measure(fn, { runs = 15, warm = 3 } = {}) {
  for (let i = 0; i < warm; i++) await fn(i - warm);
  const times = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn(i);
    times.push(performance.now() - start);
  }
  return median(times);
}

const user = (i) => ({ id: `u${i}`, name: `User ${i}`, debt: 0, age: i % 90 });
const credit = (i, users) => ({ id: `c${i}`, userId: `u${i % users}`, amount: 10 });
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
// every library gets its own copies: Redux Toolkit (Immer) freezes what it is given
const fresh = (rows) => rows.map((r) => ({ ...r }));

// ---------- adapters: how each library does the same things ----------
const libs = {
  rawstate: {
    load: (rows) => { const c = createCollection({ key: "id", rows: [] }); c.actions.addMany(fresh(rows)); return { c, store: createStore({ c }) }; },
    update: ({ c }, i) => c.actions.update(`u${i % 1000 + 10}`, { debt: i + 1 }),
    watch: ({ c }, ids) => ids.forEach((id) => c.row(id).subscribe(() => {})),
    batch: ({ c, store }, ids, v) => store.transaction(() => ids.forEach((id) => c.actions.update(id, { debt: v }))),
    find: (rows) => { const c = createCollection({ key: "id", rows: [] }); c.actions.addMany(fresh(rows)); return (userId) => c.where("userId", userId); },
  },
  zustand: {
    load: (rows) => zustand(() => ({ users: Object.fromEntries(fresh(rows).map((r) => [r.id, r])) })),
    update: (s, i) => { const id = `u${i % 1000 + 10}`; s.setState((st) => ({ users: { ...st.users, [id]: { ...st.users[id], debt: i + 1 } } })); },
    watch: (s, ids) => ids.forEach((id) => s.subscribe((st, prev) => { if (st.users[id] !== prev.users[id]) void 0; })),
    batch: (s, ids, v) => s.setState((st) => { const users = { ...st.users }; for (const id of ids) users[id] = { ...users[id], debt: v }; return { users }; }),
    find: (rows) => { const list = rows; return (userId) => list.filter((c) => c.userId === userId); },
  },
  "redux toolkit": (() => {
    const adapter = createEntityAdapter();
    const make = () => createSlice({ name: "users", initialState: adapter.getInitialState(), reducers: { setAll: adapter.setAll, updateOne: adapter.updateOne, updateMany: adapter.updateMany } });
    const wrap = (rows) => {
      const slice = make();
      const store = configureStore({ reducer: { users: slice.reducer }, middleware: (d) => d({ serializableCheck: false, immutableCheck: false }) });
      store.dispatch(slice.actions.setAll(fresh(rows)));
      return { store, a: slice.actions };
    };
    return {
      load: wrap,
      update: ({ store, a }, i) => store.dispatch(a.updateOne({ id: `u${i % 1000 + 10}`, changes: { debt: i + 1 } })),
      watch: ({ store }, ids) => ids.forEach((id) => { let last = store.getState().users.entities[id]; store.subscribe(() => { const now = store.getState().users.entities[id]; if (now !== last) last = now; }); }),
      batch: ({ store, a }, ids, v) => store.dispatch(a.updateMany(ids.map((id) => ({ id, changes: { debt: v } })))),
      find: (rows) => (userId) => rows.filter((c) => c.userId === userId),
    };
  })(),
  valtio: {
    load: (rows) => proxy({ users: Object.fromEntries(fresh(rows).map((r) => [r.id, r])) }),
    update: async (s, i) => { s.users[`u${i % 1000 + 10}`].debt = i + 1; await flush(); },
    watch: (s, ids) => ids.forEach((id) => subscribeKey(s.users, id, () => {})),
    batch: async (s, ids, v) => { for (const id of ids) s.users[id].debt = v; await flush(); },
    find: (rows) => (userId) => rows.filter((c) => c.userId === userId),
  },
  mobx: {
    load: (rows) => observable.map(Object.fromEntries(fresh(rows).map((r) => [r.id, r])), { deep: false }),
    update: (m, i) => runInAction(() => { const id = `u${i % 1000 + 10}`; m.set(id, { ...m.get(id), debt: i + 1 }); }),
    watch: (m, ids) => ids.forEach((id) => reaction(() => m.get(id), () => {})),
    batch: (m, ids, v) => runInAction(() => ids.forEach((id) => m.set(id, { ...m.get(id), debt: v }))),
    find: (rows) => (userId) => rows.filter((c) => c.userId === userId),
  },
  "tanstack db": {
    load: (rows) => tdbCollection(localOnlyCollectionOptions({ id: `u${Math.random()}`, getKey: (r) => r.id, initialData: fresh(rows) })),
    update: async (c, i) => { c.update(`u${i % 1000 + 10}`, (d) => { d.debt = i + 1; }); await flush(); },
    watch: (c) => { c.subscribeChanges(() => {}); },
    batch: async (c, ids, v) => { c.update(ids, (drafts) => drafts.forEach((d) => { d.debt = v; })); await flush(); },
    find: null, // a live query is its own subject; not compared here
  },
};

const results = {};
const record = (n, scenario, lib, ms) => (((results[n] ??= {})[scenario] ??= {})[lib] = ms === null ? null : Number(ms.toFixed(4)));

for (const n of SIZES) {
  const big = n >= 100000;
  const runs = big ? 7 : 15;
  const rows = range(n, user);
  const credits = range(n * 2, (i) => credit(i, n));
  console.error(`... ${n} rows`);

  for (const [name, lib] of Object.entries(libs)) {
    try {
      // 1. loading N rows
      record(n, "load N rows", name, await measure(() => lib.load(rows), { runs: big ? 3 : 5, warm: 1 }));

      // 2. one change in N rows
      const state = lib.load(rows);
      record(n, "update 1 row", name, await measure((i) => lib.update(state, i), { runs }));

      // 3. the same with 100 watchers of single rows
      const watched = lib.load(rows);
      lib.watch(watched, range(Math.min(100, n), (i) => `u${i}`));
      record(n, "update 1 row, 100 row watchers", name, await measure((i) => lib.update(watched, i), { runs }));

      // 4. 1000 changes that must reach the watchers as one
      const batchState = lib.load(rows);
      const ids = range(Math.min(1000, n), (i) => `u${i}`);
      record(n, "1000 updates in one batch", name, await measure((i) => lib.batch(batchState, ids, i), { runs: big ? 5 : 9, warm: 1 }));

      // 5. find the 2 credits of a user, with no hand-made index
      if (lib.find) {
        const find = lib.find(credits);
        record(n, "find the credits of a user (2 of 2N)", name, await measure((i) => find(`u${(i + 5) % n}`), { runs: big ? 7 : 15 }));
      } else record(n, "find the credits of a user (2 of 2N)", name, null);
    } catch (e) {
      console.error(`${name} @ ${n}: ${e.message}`);
    }
  }
}

// what rawstate does that the others leave to your code: a relation and a rollup, and what it costs
// (the others get a hand-written incremental update: you write it, you keep it right)
// is in rawstate-core/bench; here only sizes and the table

// ---------- size in a bundle ----------
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
const sizeOf = async (name, code) => {
  const out = await build({ stdin: { contents: code, resolveDir: process.cwd(), loader: "js" }, bundle: true, minify: true, write: false, format: "esm", platform: "browser", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  return { name, gzip: gzipSync(out.outputFiles[0].contents).length, raw: out.outputFiles[0].contents.length };
};
const sizes = await Promise.all([
  sizeOf("rawstate (slice, store, collection)", `export { createSlice, createStore, createCollection } from "../dist/index.mjs";`),
  sizeOf("rawstate (everything)", `export * from "../dist/index.mjs";`),
  sizeOf("zustand", `export { createStore } from "zustand/vanilla";`),
  sizeOf("redux toolkit (store, slice, entity adapter)", `export { configureStore, createSlice, createEntityAdapter } from "@reduxjs/toolkit";`),
  sizeOf("valtio", `export { proxy, subscribe } from "valtio/vanilla";`),
  sizeOf("mobx", `export { observable, runInAction, reaction } from "mobx";`),
  sizeOf("tanstack db", `export { createCollection, localOnlyCollectionOptions } from "@tanstack/db";`),
]);

writeFileSync("results.json", JSON.stringify({ node: process.version, production, results, sizes }, null, 2));

// ---------- the table ----------
const fmt = (ms) => (ms === null || ms === undefined ? "n/a" : ms >= 100 ? `${ms.toFixed(0)} ms` : ms >= 1 ? `${ms.toFixed(2)} ms` : ms >= 0.001 ? `${ms.toFixed(3)} ms` : `${(ms * 1000).toFixed(1)} µs`);
const names = Object.keys(libs);
let md = `# rawstate against others\n\nNode ${process.version}, ${production ? "production" : "development"} mode, median of several runs. Lower is better; the best of each row is in bold.\n`;
for (const n of SIZES) {
  md += `\n## ${n.toLocaleString("en-US")} rows\n\n| scenario | ${names.join(" | ")} |\n|---|${names.map(() => "---:").join("|")}|\n`;
  for (const [scenario, byLib] of Object.entries(results[n])) {
    const best = Math.min(...names.map((l) => byLib[l]).filter((v) => typeof v === "number"));
    md += `| ${scenario} | ${names.map((l) => (typeof byLib[l] === "number" ? (byLib[l] === best ? `**${fmt(byLib[l])}**` : fmt(byLib[l])) : "n/a")).join(" | ")} |\n`;
  }
}
md += `\n## Size in a browser bundle (minified, gzipped)\n\n| what | gzip | minified |\n|---|---:|---:|\n` + sizes.map((s) => `| ${s.name} | ${(s.gzip / 1024).toFixed(1)} KB | ${(s.raw / 1024).toFixed(1)} KB |`).join("\n") + "\n";
writeFileSync("results.md", md);
console.log(md);
