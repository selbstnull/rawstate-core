/**
 * The Standard Schema interface (https://standardschema.dev). zod, valibot, arktype and others
 * implement it, so any of them can be given to `schema` without an adapter.
 * It is copied here, as the standard recommends, so there is no dependency
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
  interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown
    ) => Result<Output> | Promise<Result<Output>>;
    readonly types?: Types<Input, Output> | undefined;
  }

  type Result<Output> = SuccessResult<Output> | FailureResult;

  interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }

  interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }

  interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }

  interface PathSegment {
    readonly key: PropertyKey;
  }

  interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }
}

/**
 * When data is checked against the schema
 * - `boundary` (default): data that comes from outside: `sync`, `store.apply`, `store.load`
 *   (the server, storage, other tabs) and the initial data. Actions are checked by types only
 * - `always`: results of actions are checked too
 */
export type ValidateMode = "boundary" | "always";

/**
 * Options of validation of a slice or a collection
 */
export interface ValidationOptions<Value> {
  /** Any Standard Schema: zod, valibot, arktype... The type it gives out must be the type of the data */
  schema?: StandardSchemaV1<unknown, Value>;
  validate?: ValidateMode;
}
