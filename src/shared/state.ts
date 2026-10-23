/* SPDX-License-Identifier: GPL-3.0-or-later */

// Keep a margin below Paperback's 131072-byte per-value state limit.
export const MAX_APPLICATION_STATE_BYTES = 120 * 1024;

function utf8ByteLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") return 0;

  // Native regex passes give an exact UTF-8 size without a per-character JS
  // loop. JSON.stringify escapes unpaired surrogates as ASCII \uXXXX, but the
  // count would be exact either way: an unpaired surrogate is 3 bytes in UTF-8
  // (the encoding of U+FFFD). Both caches are dominated by ASCII payloads, so
  // bail out after one scan when there is nothing to count.
  const nonAsciiUnits = serialized.match(NON_ASCII_RE)?.length ?? 0;
  if (nonAsciiUnits === 0) return serialized.length;

  const surrogatePairs = serialized.match(SURROGATE_PAIR_RE)?.length ?? 0;
  const twoByteUnits = serialized.match(TWO_BYTE_RE)?.length ?? 0;
  const threeByteUnits = nonAsciiUnits - twoByteUnits - 2 * surrogatePairs;
  const asciiUnits = serialized.length - nonAsciiUnits;

  return (
    asciiUnits +
    2 * twoByteUnits +
    3 * threeByteUnits +
    4 * surrogatePairs
  );
}

const SURROGATE_PAIR_RE = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
const TWO_BYTE_RE = /[\u0080-\u07FF]/g;
const NON_ASCII_RE = /[^\u0000-\u007F]/g;

export function serializedStateBytes(value: unknown): number {
  try {
    return utf8ByteLength(value);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Longest prefix of `entries` whose payload stays within `limit` bytes.
 *
 * Measures each entry once (linear in total payload size) instead of
 * re-serializing the whole payload per candidate entry. The empty payload is
 * measured too, so the estimate covers the caller's exact wrapper (`{entries:}`
 * vs a bare array) and never undershoots the real serialized size.
 */
export function takeEntriesWithinStateLimit<T>(
  entries: readonly T[],
  createPayload: (entries: T[]) => unknown,
  limit = MAX_APPLICATION_STATE_BYTES,
): T[] {
  if (entries.length === 0) return [];

  // Wrapper bytes: `[]` (2), `{"entries":[]}` (14), `{}` (2), ...
  let used = serializedStateBytes(createPayload([]));
  if (!Number.isFinite(used)) return [];
  const result: T[] = [];
  for (const entry of entries) {
    // +1 covers the comma between entries in the wrapped payload.
    const entryBytes = serializedStateBytes(entry) + 1;
    if (used + entryBytes > limit) break;
    used += entryBytes;
    result.push(entry);
  }
  return result;
}
