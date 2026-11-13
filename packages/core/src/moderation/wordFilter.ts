/**
 * Masks offensive words in chat (docs/05-multiplayer.md §8).
 *
 * Vietnamese is the hard part: stripped of diacritics, many swear words collide with everyday
 * words ("lồn" and "lớn", "cặc" and "các"). So Vietnamese words are matched with their diacritics,
 * and only unambiguous ASCII abbreviations ("dm", "vcl") and English words are matched without.
 * This favours never masking a normal sentence over catching every spelling; reports and
 * moderation (P5.4) cover the rest.
 */

/** Matched exactly as written (after lower-casing and Unicode normalisation). */
const WITH_DIACRITICS = [
  'địt',
  'đụ',
  'đéo',
  'lồn',
  'cặc',
  'buồi',
  'đĩ',
  'đm',
  'đmm',
  'đcm',
  'đkm',
  'vãi lồn',
  'đụ má',
  'đù má',
  'mẹ mày',
];

/** Matched as whole words on text with diacritics removed and repeated letters squeezed. */
const ASCII_WORDS = [
  'dm',
  'dmm',
  'dcm',
  'dkm',
  'dmvl',
  'vcl',
  'vkl',
  'vl',
  'clgt',
  'cmm',
  'fuck',
  'fucking',
  'fucker',
  'motherfucker',
  'shit',
  'bitch',
  'cunt',
  'dick',
  'pussy',
  'asshole',
];

const LETTER = /[\p{L}\p{N}]/u;
/** Control characters, zero-width and direction marks: invisible, and used to dodge filters. */
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x1f],
  [0x7f, 0x7f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0xfeff, 0xfeff],
];

function stripInvisible(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (!INVISIBLE_RANGES.some(([from, to]) => code >= from && code <= to)) out += ch;
  }
  return out;
}

/** Lower-case, NFC, without diacritics; "đ" becomes "d". */
export function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

/** "fuuuck" → "fuck": squeeze letters repeated three or more times. */
const squeeze = (word: string) => word.replace(/(.)\1{2,}/g, '$1');
/** And the fully squeezed variant, for "shiit" or "vcll". */
const squeezeAll = (word: string) => word.replace(/(.)\1+/g, '$1');

interface Token {
  start: number;
  end: number;
  text: string;
}

function tokens(text: string): Token[] {
  const result: Token[] = [];
  let start = -1;
  for (let i = 0; i <= text.length; i++) {
    const isLetter = i < text.length && LETTER.test(text[i] as string);
    if (isLetter && start < 0) start = i;
    if (!isLetter && start >= 0) {
      result.push({ start, end: i, text: text.slice(start, i) });
      start = -1;
    }
  }
  return result;
}

const ascii = new Set(ASCII_WORDS);
const phrases = WITH_DIACRITICS.map((phrase) => phrase.normalize('NFC'));

/** Cleans a chat line: removes invisible characters, collapses spaces, trims. */
export function normaliseChat(text: string, maxLength: number): string {
  // Line breaks become spaces before invisible characters are dropped.
  return stripInvisible(text.normalize('NFC').replace(/\s+/g, ' ')).trim().slice(0, maxLength);
}

/** Returns the text with offensive words replaced by asterisks of the same length. */
export function maskProfanity(text: string): string {
  const chars = [...text];
  // Work on UTF-16 indices of `text`; build a mask over them.
  const masked = new Array<boolean>(text.length).fill(false);
  const lower = text.toLowerCase();

  // Whole-word phrases with diacritics.
  const words = tokens(lower);
  for (const phrase of phrases) {
    const parts = phrase.split(' ');
    for (let i = 0; i + parts.length <= words.length; i++) {
      if (parts.every((part, k) => words[i + k]?.text === part)) {
        for (let c = (words[i] as Token).start; c < (words[i + parts.length - 1] as Token).end; c++)
          masked[c] = true;
      }
    }
  }

  // ASCII words, on the same tokens with diacritics stripped. Stripping keeps the length of
  // composed Vietnamese letters, so indices still line up with the original text.
  for (const word of words) {
    const plain = stripDiacritics(word.text);
    if (plain.length !== word.text.length) continue;
    // A word typed with Vietnamese diacritics is a Vietnamese word: only the list above applies.
    if (plain !== word.text && !/^đ/.test(word.text)) continue;
    if (ascii.has(plain) || ascii.has(squeeze(plain)) || ascii.has(squeezeAll(plain))) {
      for (let c = word.start; c < word.end; c++) masked[c] = true;
    }
  }

  let out = '';
  let index = 0;
  for (const ch of chars) {
    out += masked[index] ? '*'.repeat(1) : ch;
    index += ch.length;
  }
  return out;
}
