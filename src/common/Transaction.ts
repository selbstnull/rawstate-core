import type { Origin, TransactionOptions } from "../types/store.types";
import { Observer } from "./Observer";

/**
 * What guards and commit listeners know about the transaction
 */
export interface TxContext {
  readonly origin: Origin;
  readonly trusted: boolean;
}

/**
 * Groups writes into one atomic change: either everything is applied or nothing,
 * and subscribers hear about the final values only once, after all of them are written
 */
export class TxManager {
  /**
   * Observers changed by the running transaction with the values they had before it
   */
  private journal: Map<Observer<unknown>, unknown> | null = null;
  /**
   * Checks that run before commit, they get the values observers had before the transaction.
   * They may write too. If one throws, the transaction is rolled back
   * @internal
   */
  readonly guards: ((
    before: ReadonlyMap<object, unknown>,
    context: TxContext
  ) => void)[] = [];
  /**
   * Called after commit with the values observers had before the transaction
   * @internal
   */
  readonly listeners: ((
    before: ReadonlyMap<object, unknown>,
    context: TxContext
  ) => void)[] = [];

  /**
   * Runs `fn` as a transaction. A call inside a running transaction joins it
   * and the origin of the outer one is kept
   */
  run<T>(fn: () => T, options: TransactionOptions = {}): T {
    if (this.journal) return fn();

    const context: TxContext = {
      origin: options.origin ?? "local",
      trusted: options.trusted ?? false,
    };
    const journal = new Map<Observer<unknown>, unknown>();
    this.journal = journal;
    let result: T;
    try {
      result = fn();
      this.guards.forEach((guard) => guard(journal, context));
    } catch (error) {
      journal.forEach((before, observer) => observer.write(before));
      this.journal = null;
      throw error;
    }
    this.journal = null;

    let failed = false;
    let error: unknown;
    try {
      this.flush(journal);
    } catch (e) {
      failed = true;
      error = e;
    }
    this.announce(journal, context);
    if (failed) throw error;
    return result;
  }

  private announce(journal: Map<Observer<unknown>, unknown>, context: TxContext) {
    for (const listener of this.listeners) {
      try {
        listener(journal, context);
      } catch (e) {
        console.error("rawstate: a commit listener failed", e);
      }
    }
  }

  /**
   * Writes the value inside the running transaction, so it can be rolled back
   */
  write(observer: Observer<unknown>, value: unknown) {
    if (!this.journal) {
      throw new Error("Write outside of a transaction");
    }
    if (!this.journal.has(observer)) {
      this.journal.set(observer, observer.get());
    }
    observer.write(value);
  }

  private flush(journal: Map<Observer<unknown>, unknown>) {
    let failed = false;
    let error: unknown;
    journal.forEach((before, observer) => {
      if (Object.is(before, observer.get())) return;
      try {
        observer.notify();
      } catch (e) {
        if (!failed) {
          failed = true;
          error = e;
        }
      }
    });
    if (failed) throw error;
  }
}
