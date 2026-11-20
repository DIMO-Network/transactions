import { AccountsError } from "../errors.js";

/** A JSON object: not null, not an array. */
export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Read an accounts response: a non-2xx becomes AccountsError from its error body; a 2xx
 * whose body is not JSON of the expected shape becomes AccountsError `invalid_response`.
 */
export async function accountsJson<T>(
  res: Response,
  valid: (v: Record<string, unknown>) => boolean,
): Promise<T> {
  if (!res.ok) throw await AccountsError.fromResponse(res);
  let body: unknown;
  try {
    body = JSON.parse(await res.text());
  } catch {
    body = undefined;
  }
  if (!isObject(body) || !valid(body)) {
    throw new AccountsError(
      "invalid_response",
      res.status,
      "accounts returned an unexpected body",
    );
  }
  return body as T;
}
