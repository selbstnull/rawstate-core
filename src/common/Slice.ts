import {
  Actions,
  BoundActions,
  DeepReadonly,
  Patch,
  SliceLike,
  StateReadables,
  StateShape,
  ValidateActions,
} from "../types/slice.types";
import { deepFreeze } from "./freeze";
import type { TransactionOptions } from "../types/store.types";
import type { ValidateMode, ValidationOptions } from "../types/schema.types";
import { ATTACH, CELLS, CHECK, DISPOSE, RUN, UNTRACKED } from "./internal";
import { parseWith } from "./validate";
import { Observer } from "./Observer";
import { TxManager } from "./Transaction";

type AnyAction = (state: unknown, ...args: unknown[]) => unknown;

function isPromise(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Thrown when an async action resolved with a patch that was calculated from a state
 * that is not the current one any more. The patch is not applied, nothing is lost silently
 */
export class StaleStateError extends Error {
  constructor(
    readonly action: string,
    readonly key: string
  ) {
    super(
      `The state "${key}" changed while the async action "${action}" was running, ` +
        `so its result was calculated from an old value and is not applied. ` +
        `Return a function that gets the current state: return (state) => ({ ... })`
    );
    this.name = "StaleStateError";
  }
}

/**
 * The state as an action sees it: read-only, and remembering what was read
 */
function observe(
  snapshot: object,
  reads: Map<string, unknown>
): Record<string, unknown> {
  return new Proxy(snapshot as Record<string, unknown>, {
    get(target, key) {
      if (typeof key === "string" && Object.prototype.hasOwnProperty.call(target, key)) {
        if (!reads.has(key)) reads.set(key, target[key]);
      }
      return target[key as string];
    },
    set() {
      throw new TypeError("The state is read-only, return a patch from the action");
    },
    deleteProperty() {
      throw new TypeError("The state is read-only, return a patch from the action");
    },
    defineProperty() {
      throw new TypeError("The state is read-only, return a patch from the action");
    },
  });
}

export class Slice<S extends StateShape, A extends Actions<S>>
  implements SliceLike
{
  /**
   * Observers by state key. Typed loosely inside, the public types are `StateReadables<S>`
   */
  private readonly observers = new Map<string, Observer<unknown>>();
  /**
   * Transactions of the slice. A slice of a store uses the transactions of the store
   */
  private tx = new TxManager();
  private attached = false;
  private tracking = true;
  private readonly schema: ValidationOptions<S>["schema"];
  private readonly validate: ValidateMode;
  /**
   * Actions of the slice. Call them without state: current state is passed by the slice itself
   */
  readonly actions: BoundActions<S, A>;

  /**
   * @param state is a states that will be stored in slice, every value is watched by its own Observer
   * @param actions is a functions (state, ...args) => patch that change states of the slice
   * @param options is `schema` that data from outside is checked against, and when to check (`validate`)
   */
  constructor(
    state: S,
    actions: A & NoInfer<ValidateActions<S, A>>,
    options: ValidationOptions<S> = {}
  ) {
    this.schema = options.schema;
    this.validate = options.validate ?? "boundary";
    const initial: object = this.schema
      ? parseWith(this.schema, state, "state")
      : state;
    for (const [key, value] of Object.entries(initial)) {
      this.observers.set(key, new Observer<unknown>(deepFreeze(value)));
    }

    const bound: Record<string, (...args: unknown[]) => unknown> = {};
    for (const [name, action] of Object.entries(actions)) {
      bound[name] = (...args) => {
        const reads = new Map<string, unknown>();
        const result = this.tx.run(() => {
          const state = this.tracking
            ? observe(this.snapshot(), reads)
            : this.snapshot();
          const outcome = (action as AnyAction)(state, ...args);
          if (!isPromise(outcome)) this.apply(outcome);
          return outcome;
        });
        if (!isPromise(result)) return undefined;
        return result.then((resolved) => this.settle(name, resolved, reads));
      };
    }
    this.actions = bound as BoundActions<S, A>;
  }

  /**
   * This method allows to read a state and to watch it. The state can be changed by actions only
   * @param key is a key of state to return
   * @returns State that has `get` and `subscribe`
   */
  getState<K extends keyof S & string>(key: K): StateReadables<S>[K] {
    return this.observers.get(key) as StateReadables<S>[K];
  }

  /**
   * @internal
   */
  [CELLS](): ReadonlyMap<string, Observer<unknown>> {
    return this.observers;
  }

  /**
   * Checks values for some states against the schema, together with the other states
   * @internal
   */
  [CHECK](values: Record<string, unknown>): Record<string, unknown> {
    if (!this.schema) return values;
    const output = parseWith(
      this.schema,
      { ...this.snapshot(), ...values },
      "state"
    ) as Record<string, unknown>;
    return Object.fromEntries(Object.keys(values).map((k) => [k, output[k]]));
  }

  /**
   * Switches off remembering what actions read. For slices whose actions are all synchronous
   * @internal
   */
  [UNTRACKED]() {
    this.tracking = false;
  }

  /**
   * @internal
   */
  [RUN]<R>(fn: () => R, options?: TransactionOptions): R {
    return this.tx.run(fn, options);
  }

  /**
   * @internal
   */
  [ATTACH](tx: TxManager) {
    if (this.attached && this.tx !== tx) {
      throw new Error(
        "The slice is already used in another store. To make many stores create the slices " +
          "inside the `slices` function of `defineStore`, or dispose the store that has it"
      );
    }
    this.tx = tx;
    this.attached = true;
  }

  /**
   * Leaves the store (the slice works on its own again and can join another store)
   * and drops everybody who watches its states
   * @internal
   */
  [DISPOSE]() {
    this.tx = new TxManager();
    this.attached = false;
    this.observers.forEach((observer) => observer.release());
  }

  /**
   * Current values of all the states in one readonly object
   */
  snapshot(): DeepReadonly<S> {
    const result: Record<string, unknown> = {};
    this.observers.forEach((observer, key) => {
      result[key] = observer.get();
    });
    return Object.freeze(result) as DeepReadonly<S>;
  }

  /**
   * Applies what an async action resolved to. An updater gets the state of this moment,
   * so it is always right. A patch is applied only if what the action read is still the same
   */
  private settle(name: string, resolved: unknown, reads: Map<string, unknown>) {
    return this.tx.run(() => {
      if (typeof resolved === "function") {
        this.apply((resolved as (state: unknown) => unknown)(this.snapshot()));
        return;
      }
      for (const [key, seen] of reads) {
        if (!Object.is(this.observers.get(key)!.get(), seen)) {
          throw new StaleStateError(name, key);
        }
      }
      this.apply(resolved);
    });
  }

  /**
   * Applies what an action returned. The checks are for the cases that the compiler can not see:
   * JS callers, casts, data from outside
   */
  private apply(patch: unknown) {
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
      throw new Error("Action must return an object with the states to change");
    }
    for (const key of Object.keys(patch)) {
      if (!this.observers.has(key)) {
        throw new Error(`Action returned unknown state key "${key}"`);
      }
    }
    const entries = Object.entries(
      this.validate === "always"
        ? this[CHECK](patch as Record<string, unknown>)
        : patch
    );
    this.tx.run(() => {
      for (const [key, value] of entries) {
        this.tx.write(this.observers.get(key)!, deepFreeze(value));
      }
    });
  }
}

type SliceDefinition<S extends StateShape, A extends Actions<S>> = {
  state: S;
  actions: A;
  /** Any Standard Schema (zod, valibot, arktype...) for the whole state. Data from outside is checked against it */
  schema?: ValidationOptions<NoInfer<S>>["schema"];
  /** `boundary` (default): data from outside; `always`: results of actions too */
  validate?: ValidateMode;
} & NoInfer<{ actions: ValidateActions<S, A> }>;

/**
 * Creates slice, types of states and actions are inferred from the definition.
 * To describe the states with your own interface use `createSlice<State>()({ state, actions })`
 */
export function createSlice<S extends StateShape>(): <A extends Actions<S>>(
  definition: SliceDefinition<S, A>
) => Slice<S, A>;
export function createSlice<S extends StateShape, A extends Actions<S>>(
  definition: SliceDefinition<S, A>
): Slice<S, A>;
export function createSlice(definition?: {
  state: StateShape;
  actions: Actions<StateShape>;
  schema?: ValidationOptions<StateShape>["schema"];
  validate?: ValidateMode;
}): unknown {
  // the definition was already checked by the overloads above
  const create = (def: NonNullable<typeof definition>) =>
    new Slice(def.state, def.actions as never, {
      schema: def.schema,
      validate: def.validate,
    });
  return definition ? create(definition) : create;
}
