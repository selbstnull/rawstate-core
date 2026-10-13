/**
 * Key of the method that connects a slice to the transaction manager of a store.
 * It is not exported from the package
 */
export const ATTACH: unique symbol = Symbol("rawstate.attach");

/**
 * Key of the method that gives the store access to the inside of a collection (checks of relations).
 * It is not exported from the package
 */
export const INTERNALS: unique symbol = Symbol("rawstate.internals");

/**
 * Key of the method that gives the store the observers of states of a slice.
 * It is not exported from the package
 */
export const CELLS: unique symbol = Symbol("rawstate.cells");

/**
 * Key of the method that runs a function as a transaction of the slice.
 * It is not exported from the package
 */
export const RUN: unique symbol = Symbol("rawstate.run");

/**
 * Key of the method that switches off remembering what actions read.
 * It is not exported from the package
 */
export const UNTRACKED: unique symbol = Symbol("rawstate.untracked");

/**
 * Key of the method that checks values that come from outside against the schema of a slice.
 * It is not exported from the package
 */
export const CHECK: unique symbol = Symbol("rawstate.check");

/**
 * Key of the method that frees a slice or a collection: it leaves the store and drops its subscribers.
 * It is not exported from the package
 */
export const DISPOSE: unique symbol = Symbol("rawstate.dispose");
