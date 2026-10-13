/**
 * Something that has a current value and tells when it changes: Observer, View, state of a slice
 */
export interface Readable<T> {
  /**
   * @returns Current value
   */
  get(): T;
  /**
   * @param fn Called with the new value after every change
   * @returns Unsubscribe function
   */
  subscribe(fn: (value: T) => void): () => void;
}
