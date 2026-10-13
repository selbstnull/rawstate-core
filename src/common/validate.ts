import type { StandardSchemaV1 } from "../types/schema.types";

export interface ValidationIssue {
  readonly message: string;
  /** Where in the data, like `address.city` or `tags.0`. Empty for the whole value */
  readonly path: string;
}

/**
 * Thrown when data from outside does not fit the schema. Nothing of the operation is applied.
 * `source` is the name of the collection or the slice in the store
 */
export class ValidationError extends Error {
  source?: string;

  constructor(
    readonly issues: readonly ValidationIssue[],
    private readonly what: string
  ) {
    super("");
    this.name = "ValidationError";
    this.message = this.describe();
  }

  /**
   * Tells where the data was meant for
   */
  at(source: string): this {
    this.source = source;
    this.message = this.describe();
    return this;
  }

  private describe() {
    const where = this.source ? ` in "${this.source}"` : "";
    const list = this.issues
      .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
      .join("; ");
    return `Invalid ${this.what}${where}: ${list}`;
  }
}

const pathOf = (path: StandardSchemaV1.Issue["path"]) =>
  (path ?? [])
    .map((segment) =>
      String(typeof segment === "object" ? segment.key : segment)
    )
    .join(".");

/**
 * Checks the value with the schema and gives what the schema gives out (it may convert values)
 * @param what What is checked, for the message: `row "u1"`, `state`
 */
export function parseWith<T>(
  schema: StandardSchemaV1<unknown, T>,
  value: unknown,
  what: string
): T {
  const result = schema["~standard"].validate(value);
  if (typeof (result as { then?: unknown }).then === "function") {
    throw new Error(
      "Async schemas are not supported: validation of the store is synchronous"
    );
  }
  const { issues, value: output } = result as StandardSchemaV1.Result<T> & {
    value?: T;
  };
  if (issues) {
    throw new ValidationError(
      issues.map((i) => ({ message: i.message, path: pathOf(i.path) })),
      what
    );
  }
  return output as T;
}
