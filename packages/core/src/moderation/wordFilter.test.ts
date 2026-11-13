import { describe, expect, it } from 'vitest';
import { maskProfanity, normaliseChat, stripDiacritics } from './wordFilter';

describe('maskProfanity', () => {
  it.each([
    'Các bạn ơi, ăn trưa chưa?',
    'Phòng họp lớn ở tầng 2',
    'Cái cặp của mình để ở canteen',
    'Hồ cá Koi đẹp quá',
    'classic shitake dickens assholes', // longer words that merely contain a listed one
    'Vãi cả nhà ơi',
  ])('leaves an ordinary sentence alone: %s', (sentence) => {
    expect(maskProfanity(sentence)).toBe(sentence);
  });

  it.each([
    ['đm mệt quá', '** mệt quá'],
    ['ĐM', '**'],
    ['vcl luôn', '*** luôn'],
    ['Fuck!', '****!'],
    ['fuuuck this', '****** this'],
    ['đụ má nó', '***** nó'],
    ['đéo biết', '*** biết'],
    ['what the shiit', 'what the *****'],
  ])('masks %s', (input, expected) => {
    expect(maskProfanity(input)).toBe(expected);
  });

  it('keeps the length and everything around a masked word', () => {
    const text = 'Ê, vcl thật — xem kìa 😂';
    const masked = maskProfanity(text);
    expect(masked).toBe('Ê, *** thật — xem kìa 😂');
    expect(masked.length).toBe(text.length);
  });
});

describe('normaliseChat', () => {
  it('trims, collapses spaces, drops invisible characters and caps the length', () => {
    expect(normaliseChat('  xin​   chào\n\nmọi người  ', 200)).toBe('xin chào mọi người');
    expect(normaliseChat('a'.repeat(300), 200)).toHaveLength(200);
  });

  it('composes decomposed Vietnamese so filters see one form', () => {
    expect(normaliseChat('lớn'.normalize('NFD'), 10)).toBe('lớn');
  });
});

describe('stripDiacritics', () => {
  it('turns đ into d and removes tone marks', () => {
    expect(stripDiacritics('Đường Tân Thuận')).toBe('Duong Tan Thuan');
  });
});
