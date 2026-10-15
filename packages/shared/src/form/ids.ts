import type { FieldId, OptionId } from './definition';

/**
 * New field and option ids: a prefix and eight base-36 characters.
 *
 * 36^8 is 2.8e12, against a form that holds at most 100 fields of at most 20
 * options. A collision inside one form is not a practical event, and if one ever
 * happened the analyzer reports `duplicate_id` before publishing.
 *
 * The random source is a parameter so tests get fixed ids; the default is
 * `crypto.getRandomValues`, which exists in both the browser and Node 20, so the
 * builder and the seed share this one function.
 */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export type RandomBytes = (length: number) => Uint8Array;

const cryptoBytes: RandomBytes = (length) =>
  globalThis.crypto.getRandomValues(new Uint8Array(length));

function suffix(random: RandomBytes): string {
  // 252 is the largest multiple of 36 below 256; bytes at or above it are
  // redrawn so every character is equally likely (no modulo bias).
  let out = '';
  while (out.length < 8) {
    for (const byte of random(16)) {
      if (byte < 252) out += ALPHABET[byte % 36];
      if (out.length === 8) break;
    }
  }
  return out;
}

export function newFieldId(random: RandomBytes = cryptoBytes): FieldId {
  return `f_${suffix(random)}`;
}

export function newOptionId(random: RandomBytes = cryptoBytes): OptionId {
  return `o_${suffix(random)}`;
}
