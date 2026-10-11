import { translateMessage, type TranslationDict } from 'src/data/i18n';

// Entries with no translation for any language, to hit the last-resort fallbacks.
const dict = {
  EMPTY: {} as unknown as { vi: string; en: string },
} as unknown as TranslationDict;

describe('translateMessage — fallback edge cases', () => {
  it('returns an empty string for an undefined or empty message', () => {
    expect(translateMessage(dict, undefined, 'en')).toBe('');
    expect(translateMessage(dict, '', 'en')).toBe('');
  });

  it('returns the raw code when an exact entry has no translation at all', () => {
    expect(translateMessage(dict, 'EMPTY', 'en')).toBe('EMPTY');
  });

  it('keeps the code when a composed message has an entry with no translation', () => {
    expect(translateMessage(dict, 'EMPTY: detail', 'en')).toBe('EMPTY: detail');
  });

  it('ignores a ": " separator at the very start of the message', () => {
    expect(translateMessage(dict, ': orphan', 'en')).toBe(': orphan');
  });
});
