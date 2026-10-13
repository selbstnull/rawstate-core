# rawstate against others

The same scenarios on rawstate, Zustand, Redux Toolkit, Valtio, MobX and TanStack DB. Not published, it is only here so the numbers in the docs can be checked.

```
yarn build && cd bench-compare
npm install
NODE_ENV=production node run.mjs          # results.md and results.json
SIZES=1000,10000 node run.mjs
```

## How to read it

- Each library is used the way its own documentation shows: Zustand with an immutable `set`, Redux Toolkit with `createEntityAdapter`, Valtio and MobX with their mutable state, TanStack DB with a local-only collection. Nothing is tuned against anybody.
- Rows are the same plain objects; every library gets its own copies, because Immer (Redux Toolkit) freezes what it is given.
- **Valtio and TanStack DB tell their listeners a moment later**, so the harness waits one `setTimeout` after each of their changes. That is about 1 ms of every number of theirs and is not their real cost: read them as "about a millisecond or less".
- MobX is the fastest in changing one row because it changes it **in place** (and has no snapshots or atomic rollback). rawstate and Zustand keep every version of the state unchanged, which is what gives cheap "has it changed" checks, time travel and safe sharing.
- Zustand is the fastest to load and, for small collections, to change. It copies the whole object at every change, so one change in 100 000 rows takes about 40 ms. This is the one place where rawstate is built differently on purpose: it copies one small bucket.
- "Find the credits of a user" has no hand-made index in the others. You can build one with any of them, and then you keep it right on every change; rawstate keeps it for you.
- This benchmark does **not** measure what rawstate does that the others leave to your code: relations, rollups, atomic rollback, checked borders. That costs time too: see `../bench` for the price of a relation and a rollup (0.1–3 ms per change on 1 000–100 000 rows).
- It is one machine, one Node version and a median of a few runs. Run it on yours.

## Results

See `results.md` (made by the last run).
