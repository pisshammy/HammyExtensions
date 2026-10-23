import { type TestSuite } from './suite.js'
import {
  MAX_APPLICATION_STATE_BYTES,
  serializedStateBytes,
  takeEntriesWithinStateLimit,
} from '../shared/state.js'

export type PagesExpression = { min?: number; max?: number; exact?: number }
export type PagesExpressionParser = (value: string) => PagesExpression
export type PagesCanonicalizer = (value: string) => string

export function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

// Straightforward per-code-unit UTF-8 counter. The fast implementation in
// `shared/state.ts` must agree with this exactly, including lone surrogates
// (3 bytes, matching the UTF-8 encoding of U+FFFD).
export function utf8LengthReference(value: unknown): number {
  const serialized = JSON.stringify(value)
  if (typeof serialized !== 'string') return 0
  let bytes = 0
  for (let index = 0; index < serialized.length; index++) {
    const code = serialized.charCodeAt(index)
    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = serialized.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }
  return bytes
}

/**
 * Offline checks for logic that must never depend on a live source. They run in
 * the same suite as the live tests but make no network calls and use no timers,
 * so they are safe to run on every test invocation.
 */
export function registerSharedStateTests(suite: TestSuite): void {
  suite.test('serializedStateBytes matches the reference UTF-8 counter', async () => {
    const cases: [string, unknown][] = [
      ['empty string', ''],
      ['empty array', []],
      ['ascii', 'plain ascii id 12345'],
      ['one/two-byte boundary', '\u007f\u0080\u07ff'],
      ['three-byte boundary', '\u0800\u4e2d\uffff'],
      ['astral pairs', '\ud83d\ude00\ud83c\udfb4'],
      ['lone high surrogate', '\ud800'],
      ['lone low surrogate', '\udc00'],
      ['reversed surrogates', '\udc00\ud800'],
      ['surrogate in object key', { '\ud800': 1 }],
      ['control characters', '\u0000\u0001\u001f"\\\n\r\t'],
      ['mixed nested payload', { a: ['é', { b: '\ud83d\ude00', c: [1, 2, 3] }] }],
    ]
    for (const [label, value] of cases) {
      const expected = utf8LengthReference(value)
      const actual = serializedStateBytes(value)
      assert(
        actual === expected,
        `${label}: expected ${expected} bytes, got ${actual}`,
      )
    }
  })

  suite.test('takeEntriesWithinStateLimit keeps a fitting prefix', async () => {
    const entries = Array.from({ length: 400 }, (_, index) => [
      String(index),
      { title: `Gallery ${index} 日本語`, tag: 'test', ts: 1 },
    ])
    const kept = takeEntriesWithinStateLimit(entries, (candidate) => ({
      entries: candidate,
    }))
    assert(kept.length > 0, 'expected at least one entry to fit')
    assert(kept.length <= entries.length, 'returned more entries than provided')
    for (let index = 0; index < kept.length; index++) {
      assert(
        kept[index] === entries[index],
        `entry ${index} is not the expected prefix element`,
      )
    }
    const payloadBytes = serializedStateBytes({ entries: kept })
    assert(
      payloadBytes <= MAX_APPLICATION_STATE_BYTES,
      `payload of ${payloadBytes} bytes exceeds ${MAX_APPLICATION_STATE_BYTES}`,
    )
  })

  suite.test('takeEntriesWithinStateLimit drops a single oversized entry', async () => {
    const huge = { data: 'x'.repeat(MAX_APPLICATION_STATE_BYTES) }
    const kept = takeEntriesWithinStateLimit([huge], (candidate) => ({
      entries: candidate,
    }))
    assert(kept.length === 0, 'an entry larger than the limit must be dropped')
  })
}

/**
 * The pages-expression parser backs the "Length" search filter in both sources.
 * It is pure, so it can be verified without touching the network.
 */
export function registerPagesExpressionTests(
  suite: TestSuite,
  label: string,
  parse: PagesExpressionParser,
): void {
  suite.test(`${label} pages expression parser`, async () => {
    const cases: [string, PagesExpression][] = [
      ['', {}],
      ['   ', {}],
      ['50', { min: 50, max: 50, exact: 50 }],
      ['20+', { min: 20 }],
      ['20-', { max: 20 }],
      ['-5', { max: 5 }],
      ['>=20', { min: 20 }],
      ['<=200', { max: 200 }],
      ['>100', { min: 100 }],
      ['<10', { max: 10 }],
      ['5000>', { min: 5000 }],
      ['10-20', { min: 10, max: 20 }],
      ['20-10', { min: 10, max: 20 }],
      ['99>x>69', { min: 69, max: 99 }],
      ['57<x<67', { min: 57, max: 67 }],
    ]
    for (const [input, expected] of cases) {
      const actual = parse(input)
      const context = JSON.stringify({ input, actual, expected })
      assert(actual.min === expected.min, `min mismatch: ${context}`)
      assert(actual.max === expected.max, `max mismatch: ${context}`)
      assert(actual.exact === expected.exact, `exact mismatch: ${context}`)
    }
  })
}

/**
 * The pages setting is stored in a canonical short form ("20+", "20-",
 * "10-20") regardless of which equivalent syntax the user typed. Both sources
 * share the same implementation, so the cases live here.
 */
export function registerPagesCanonicalizationTests(
  suite: TestSuite,
  label: string,
  canonicalize: PagesCanonicalizer,
): void {
  suite.test(`${label} pages expression canonicalisation`, async () => {
    const cases: [string, string][] = [
      ['', ''],
      ['   ', ''],
      ['50', '50'],
      ['=50', '50'],
      ['  15  ', '15'],
      ['20+', '20+'],
      ['>=20', '20+'],
      ['>20', '20+'],
      ['20>=', '20+'],
      ['20-', '20-'],
      ['<=20', '20-'],
      ['<20', '20-'],
      ['-5', '5-'],
      ['10-20', '10-20'],
      ['20-10', '10-20'],
      ['>= 30', '30+'],
    ]
    for (const [input, expected] of cases) {
      const actual = canonicalize(input)
      assert(
        actual === expected,
        `canonicalise(${JSON.stringify(input)}) = ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
      )
      if (expected.length > 0) {
        assert(
          canonicalize(expected) === expected,
          `canonicalising ${JSON.stringify(expected)} again changed it to ${JSON.stringify(canonicalize(expected))}`,
        )
      }
    }
  })
}
