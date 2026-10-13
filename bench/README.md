# Benchmark

```
yarn bench                          # development mode (rows are frozen)
NODE_ENV=production yarn bench      # production mode
SIZES=1000,10000 yarn bench         # chosen sizes
```

It builds collections of users (and twice as many credits with a relation and a `rollup`), does one change at a time and prints the median time next to the saved baseline.

- `results/latest-<mode>.json`: the last run.
- `results/baseline-<mode>.json`: the run before the rows were moved to the bucketed table, for comparison. Scenarios with relations were not run on 100 000 rows there: that version needed hours (every change copied all the rows).
