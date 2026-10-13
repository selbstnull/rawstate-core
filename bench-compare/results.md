# rawstate against others

Node v22.18.0, production mode, median of several runs. Lower is better; the best of each row is in bold.

## 1,000 rows

| scenario | rawstate | zustand | redux toolkit | valtio | mobx | tanstack db |
|---|---:|---:|---:|---:|---:|---:|
| load N rows | 0.554 ms | **0.281 ms** | 1.47 ms | 3.92 ms | 0.782 ms | 2.32 ms |
| update 1 row | 0.008 ms | 0.010 ms | 0.480 ms | 1.09 ms | **0.005 ms** | 1.18 ms |
| update 1 row, 100 row watchers | 0.031 ms | 0.012 ms | 0.504 ms | 1.09 ms | **0.004 ms** | 1.14 ms |
| 1000 updates in one batch | 3.39 ms | **0.210 ms** | 7.81 ms | 1.41 ms | 0.408 ms | 3.63 ms |
| find the credits of a user (2 of 2N) | **0.9 µs** | 0.026 ms | 0.027 ms | 0.023 ms | 0.012 ms | n/a |

## 10,000 rows

| scenario | rawstate | zustand | redux toolkit | valtio | mobx | tanstack db |
|---|---:|---:|---:|---:|---:|---:|
| load N rows | 2.23 ms | **1.46 ms** | 7.52 ms | 43.71 ms | 5.51 ms | 14.51 ms |
| update 1 row | 0.007 ms | 2.35 ms | 5.28 ms | 1.07 ms | **0.001 ms** | 1.15 ms |
| update 1 row, 100 row watchers | 0.031 ms | 2.13 ms | 4.99 ms | 1.09 ms | **0.003 ms** | 1.15 ms |
| 1000 updates in one batch | 5.21 ms | 2.32 ms | 9.61 ms | 1.37 ms | **0.125 ms** | 3.48 ms |
| find the credits of a user (2 of 2N) | **0.8 µs** | 0.092 ms | 0.083 ms | 0.092 ms | 0.092 ms | n/a |

## 100,000 rows

| scenario | rawstate | zustand | redux toolkit | valtio | mobx | tanstack db |
|---|---:|---:|---:|---:|---:|---:|
| load N rows | 34.35 ms | **26.19 ms** | 104 ms | 632 ms | 90.05 ms | 247 ms |
| update 1 row | 0.010 ms | 40.84 ms | 93.71 ms | 1.08 ms | **0.001 ms** | 1.14 ms |
| update 1 row, 100 row watchers | 0.043 ms | 37.83 ms | 87.19 ms | 1.14 ms | **0.003 ms** | 1.14 ms |
| 1000 updates in one batch | 9.52 ms | 42.70 ms | 101 ms | 1.40 ms | **0.165 ms** | 3.81 ms |
| find the credits of a user (2 of 2N) | **0.002 ms** | 1.01 ms | 1.36 ms | 1.20 ms | 1.29 ms | n/a |

## Size in a browser bundle (minified, gzipped)

| what | gzip | minified |
|---|---:|---:|
| rawstate (slice, store, collection) | 7.8 KB | 22.4 KB |
| rawstate (everything) | 8.8 KB | 25.1 KB |
| zustand | 0.2 KB | 0.3 KB |
| redux toolkit (store, slice, entity adapter) | 11.0 KB | 28.6 KB |
| valtio | 1.1 KB | 2.3 KB |
| mobx | 16.4 KB | 58.0 KB |
| tanstack db | 32.6 KB | 112.1 KB |
