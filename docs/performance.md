# Performance

Rows of a collection are kept in a table that never changes in place: a change copies one small bucket and the list of buckets, not all the rows, and two versions are compared bucket by bucket. So the cost of a change does not grow with the size of the collection, and what the store has to find out after a change (what changed, which rows refer to a removed one, the sum for a user) costs as much as the change.

## Numbers

Collection of users and twice as many credits, with a relation and a `rollup`. Node 22, production mode, median of several runs (`yarn bench` in the repository). "was" is the same scenario before this storage; where there is none, the old version needed hours.

| scenario | 1 000 rows | 10 000 rows | 100 000 rows |
| --- | --- | --- | --- |
| add 1 row | 0.02 ms | 0.02 ms | 0.9 ms (was 70 ms) |
| update 1 row | 0.01 ms | 7 µs | 0.01 ms (was 71 ms) |
| remove 1 row | 0.01 ms | 0.02 ms | 1.3 ms (was 46 ms) |
| find a user's credits (`where`) | 1 µs | 1 µs | 2 µs |
| relation + rollup: add 1 credit | 0.09 ms | 0.2 ms | 2.7 ms |
| cascade: remove 1 user with 2 credits | 0.18 ms | 0.5 ms | 8.7 ms |
| transaction of 3 changes | 0.14 ms | 0.27 ms | 2.8 ms |
| change with an `onCommit` listener | 0.02 ms | 0.02 ms | 0.09 ms |
| `sync` of 100 000 rows, nothing changed | | | 69 ms |
| load 100 000 rows (`addMany`) | | | 63 ms |

## Against other libraries

The same scenarios on Zustand, Redux Toolkit, Valtio, MobX and TanStack DB (`bench-compare/` in the repository; the full tables are in `bench-compare/results.md`). Production mode, Node 22, median of several runs.

| 100 000 rows | rawstate | Zustand | Redux Toolkit | Valtio | MobX | TanStack DB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| update 1 row | 0.01 ms | 41 ms | 94 ms | ~1 ms¹ | 0.001 ms | ~1 ms¹ |
| update 1 row, 100 watchers | 0.04 ms | 38 ms | 87 ms | ~1 ms¹ | 0.003 ms | ~1 ms¹ |
| 1000 updates in one batch | 9.5 ms | 43 ms | 101 ms | ~1 ms¹ | 0.2 ms | ~4 ms¹ |
| load | 34 ms | 26 ms | 104 ms | 632 ms | 90 ms | 247 ms |
| find a user's 2 credits among 200 000 | 2 µs | 1.0 ms | 1.4 ms | 1.2 ms | 1.3 ms | n/a |

¹ these two tell their listeners a moment later, and the harness waits for it: about 1 ms of the number is that wait.

What it says, plainly:

- Libraries that **copy the state** (Zustand, Redux Toolkit) get slower with the size: a change costs time in proportion to the number of rows. rawstate keeps the same cost at 1 000 and at 100 000 rows. For small states Zustand is as fast or faster, and much smaller.
- Libraries that **change the state in place** (MobX, Valtio) are the fastest at one change. They give up immutable versions: no cheap "did it change", no snapshots, no atomic rollback.
- Indexed lookup (`where`) is orders of magnitude faster than filtering, but in the others you can build an index yourself.
- The price: rawstate is about **9 KB gzipped**, against 0.2 KB (Zustand), 1 KB (Valtio), 11 KB (Redux Toolkit), 16 KB (MobX), 33 KB (TanStack DB). It is the size of the whole thing: collections, relations, rules, transactions, validation.

## What still depends on the size

As it must, or nearly:

- Building or comparing a whole list: `sync` (deep comparison of every row), `snapshot()`, and a watch on `rows` (it makes an array of all the rows after every change). In a UI, rendering such a list is the limit anyway.
- The array of the order of the rows is copied when a row is added or removed (about a millisecond for 100 000 rows).
- In development mode rows are frozen, which costs some time. Production builds skip it.

## Size of the package

The whole library is about **26 KB minified, 9 KB gzipped**, no dependencies. `rawstate-react` adds about 0.5 KB, `rawstate-idb` about 3 KB.

## Tips

- Watch what you need: `useRow(users, id)` rerenders only when that row changes, `useRows` on every change.
- Use `by(field, value)` and `where` instead of `rows.filter` on big collections.
- Send only what changed: `sync` keeps unchanged rows as they are.
