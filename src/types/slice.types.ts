import type { ATTACH, CELLS, CHECK, DISPOSE } from "../common/internal";
import type { Observer } from "../common/Observer";
import type { TxManager } from "../common/Transaction";
import type { Readable } from "./readable.types";

/**
 * Makes a type deeply readonly: objects and arrays can not be changed through the type
 */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

/**
 * Shape of the states object that is stored in the slice
 */
export type StateShape = object;

/**
 * Part of the state that action returns. Only returned keys are changed
 */
export type Patch<S extends StateShape> = {
  [K in keyof S]?: DeepReadonly<S[K]>;
};

/**
 * What an async action can return instead of a patch: a function that gets the state
 * at the moment the result is applied, so it is never out of date
 */
export type Updater<S extends StateShape> = (state: DeepReadonly<S>) => Patch<S>;

/**
 * Object with named actions of the slice. Action receives current (readonly) state first
 * and returns a patch for it. An async action resolves to a patch or to an `Updater`.
 * The result is checked by `CheckedActions`
 */
export type Actions<S extends StateShape> = Record<
  string,
  (
    state: DeepReadonly<S>,
    ...args: never[]
  ) => Patch<S> | Promise<Patch<S> | Updater<S>>
>;

/**
 * Patch must be a part of the state: wrong value types and keys outside of the state
 * (even next to correct ones) turn the type into the one that can not be satisfied
 */
export type CheckPatch<S extends StateShape, P> = [
  Exclude<keyof P, keyof S>
] extends [never]
  ? P extends Patch<S>
    ? P
    : Patch<S>
  : { [K in Exclude<keyof P, keyof S>]: never };

/**
 * Same actions as given, but their results are checked to be a valid patch of the state
 */
export type CheckedActions<S extends StateShape, A> = {
  [K in keyof A]: A[K] extends (...args: infer P) => infer R
    ? (...args: P) => R extends Promise<infer V>
        ? Promise<CheckResolved<S, V>>
        : CheckPatch<S, R>
    : never;
};

/**
 * What an async action resolves to: a valid patch, or an updater that gives a valid patch
 */
export type CheckResolved<S extends StateShape, V> = V extends (
  state: never
) => infer P
  ? (state: DeepReadonly<S>) => CheckPatch<S, P>
  : CheckPatch<S, V>;

/**
 * Actions as they are called from outside: without state argument,
 * async actions return Promise that resolves when the state is changed
 */
export type BoundActions<S extends StateShape, A extends Actions<S>> = {
  [K in keyof A]: A[K] extends (state: never, ...args: infer P) => infer R
    ? (...args: P) => R extends Promise<unknown> ? Promise<void> : void
    : never;
};

/**
 * Every single state value of the slice as a value that can be read and watched, but not written:
 * states are changed by actions only
 */
export type StateReadables<S extends StateShape> = {
  [K in keyof S]: Readable<DeepReadonly<S[K]>>;
};

/**
 * Resolves to `unknown` (no restriction) when all actions return a valid patch,
 * otherwise to the checked actions, which the given ones do not satisfy
 */
export type ValidateActions<S extends StateShape, A> = A extends CheckedActions<
  S,
  A
>
  ? unknown
  : CheckedActions<S, A>;

/**
 * The only thing the store and context need to know about a slice
 */
export interface SliceLike {
  snapshot(): unknown;
  /**
   * Connects the slice to the transaction manager of the store
   * @internal
   */
  [ATTACH](tx: TxManager): void;
  /**
   * Observers of the states by their keys
   * @internal
   */
  [CELLS](): ReadonlyMap<string, Observer<unknown>>;
  /**
   * Checks values that came from outside against the schema, gives what the schema gives out
   * @internal
   */
  [CHECK](values: Record<string, unknown>): Record<string, unknown>;
  /**
   * Leaves the store and drops everybody who watches it
   * @internal
   */
  [DISPOSE](): void;
}
