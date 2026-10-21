/* SPDX-License-Identifier: GPL-3.0-or-later */

// Keep a margin below Paperback's 131072-byte per-value state limit.
export const MAX_APPLICATION_STATE_BYTES = 120 * 1024;

function utf8ByteLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  let bytes = 0;

  for (let index = 0; index < serialized.length; index++) {
    const code = serialized.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = serialized.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

export function serializedStateBytes(value: unknown): number {
  try {
    return utf8ByteLength(value);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function takeEntriesWithinStateLimit<T>(
  entries: readonly T[],
  createPayload: (entries: T[]) => unknown,
  limit = MAX_APPLICATION_STATE_BYTES,
): T[] {
  const result: T[] = [];
  for (const entry of entries) {
    const candidate = [...result, entry];
    if (serializedStateBytes(createPayload(candidate)) > limit) break;
    result.push(entry);
  }
  return result;
}
