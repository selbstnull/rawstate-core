| scenario | 1 000 rows | 10 000 rows | 100 000 rows |
| --- | --- | --- | --- |
| load: addMany N rows | 0.95 ms | 3.3 ms | 63.0 ms |
| add 1 row | 0.02 ms (was 0.54 ms) | 0.02 ms (was 2.9 ms) | 0.91 ms (was 70.3 ms) |
| update 1 row | 0.01 ms | 7 µs (was 2.9 ms) | 0.01 ms (was 70.9 ms) |
| remove 1 row | 0.01 ms (was 0.22 ms) | 0.02 ms (was 2.2 ms) | 1.3 ms (was 45.8 ms) |
| update 1 row, 100 row watchers + rows watcher | 0.10 ms (was 0.27 ms) | 0.42 ms (was 3.6 ms) | 11.1 ms (was 82.1 ms) |
| find 1 user's credits (where) | 1 µs | 0 µs | 2 µs |
| bank: add 1 credit (relation + rollup) | 0.09 ms (was 1.3 ms) | 0.21 ms (was 13.7 ms) | 2.7 ms |
| bank: update 1 credit amount | 0.12 ms (was 0.95 ms) | 0.05 ms (was 13.5 ms) | 0.59 ms |
| bank: remove 1 user (cascade, 2 credits) | 0.18 ms (was 0.94 ms) | 0.54 ms (was 11.1 ms) | 8.7 ms |
| bank: transaction of 3 changes | 0.14 ms (was 2.7 ms) | 0.27 ms (was 25.4 ms) | 2.8 ms |
| bank: update 1 row with an onCommit listener | 0.02 ms (was 1.2 ms) | 0.02 ms (was 9.6 ms) | 0.09 ms |
| sync N rows, nothing changed | 0.65 ms | 2.8 ms (was 5.3 ms) | 69.2 ms (was 114 ms) |
| sync N rows, 1 changed | 0.53 ms (was 0.87 ms) | 2.6 ms (was 4.1 ms) | 60.9 ms |
| store.snapshot() | 0.05 ms (was 0.17 ms) | 0.34 ms | 5.8 ms |