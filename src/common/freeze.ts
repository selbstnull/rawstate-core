declare const process: { env: { NODE_ENV?: string } };

/**
 * Freezing is a development check, it is turned off in production builds.
 * The plain `process.env.NODE_ENV` is what every bundler replaces; where there is no `process`
 * (a browser without a bundler) the check stays on
 */
export const isDev = (() => {
  try {
    return process.env.NODE_ENV !== "production";
  } catch {
    return true;
  }
})();

function isPlain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Freeze plain objects and arrays recursively, so any mutation throws in strict mode
 * @param value Value to freeze
 * @returns Same value
 */
export function deepFreeze<T>(value: T): T {
  if (!isDev || !isPlain(value) || Object.isFrozen(value)) return value;
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (typeof item === "object" && item !== null) deepFreeze(item);
    }
  } else {
    for (const item of Object.values(value)) {
      if (typeof item === "object" && item !== null) deepFreeze(item);
    }
  }
  return value;
}
