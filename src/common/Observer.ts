import type { Readable } from "../types/readable.types";

export class Observer<T> implements Readable<T> {
  /**
   * Value to serve to
   */
  private value: T;
  /**
   * All subscribers that watch value change
   */
  private subscribers: ((val: T) => void)[] = [];

  /**
   * Creates Observer
   * @param value Initial value
   */
  constructor(value: T) {
    this.value = value;
  }

  /**
   * This method allows to set new value. Subscribers are not called if the value is the same
   * @param value New value to set to
   */
  set(value: T) {
    if (Object.is(this.value, value)) return;
    this.value = value;
    this.notify();
  }

  /**
   * Changes the value without telling subscribers. Used by transactions, they call `notify` on commit
   * @internal
   */
  write(value: T) {
    this.value = value;
  }

  /**
   * Calls every subscriber with the current value. One failing subscriber does not stop the others,
   * the first error is thrown when all of them are called
   * @internal
   */
  notify() {
    let failed = false;
    let error: unknown;
    for (const fn of this.subscribers.slice()) {
      try {
        fn(this.value);
      } catch (e) {
        if (!failed) {
          failed = true;
          error = e;
        }
      }
    }
    if (failed) throw error;
  }

  /**
   * Drops all the subscribers. The value can still be read
   * @internal
   */
  release() {
    this.subscribers = [];
  }

  /**
   * This methods allows to get Observer value
   * @returns Current value
   */
  get = (): T => {
    return this.value;
  };

  /**
   * Add new subscriber to Observer
   * @param fn Callback function that accepts value to set
   * @returns Unsubcribe method that you need to call, if subscriber do not need anymore
   */
  subscribe = (fn: (val: T) => void): (() => void) => {
    this.subscribers.push(fn);
    return () => {
      this.subscribers = this.subscribers.filter((f) => f !== fn);
    };
  };
}
