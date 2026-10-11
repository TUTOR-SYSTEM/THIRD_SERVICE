import { translateMessage, toCodeMap, type TranslationDict } from 'src/data/i18n';

const dict: TranslationDict = {
  EMAIL_EXISTS: { vi: 'Email đã tồn tại', en: 'Email already exists' },
  VI_ONLY: { vi: 'Chỉ tiếng Việt', en: undefined as unknown as string },
};

describe('translateMessage', () => {
  it('returns the localized string for an exact code', () => {
    expect(translateMessage(dict, 'EMAIL_EXISTS', 'en')).toBe('Email already exists');
    expect(translateMessage(dict, 'EMAIL_EXISTS', 'vi')).toBe('Email đã tồn tại');
  });

  it('localizes the code part of a composed "CODE: extra" message and keeps the suffix', () => {
    expect(translateMessage(dict, 'EMAIL_EXISTS: a@b.c', 'en')).toBe('Email already exists: a@b.c');
  });

  it('falls back to the default language when the requested one is missing', () => {
    expect(translateMessage(dict, 'VI_ONLY', 'en')).toBe('Chỉ tiếng Việt');
  });

  it('returns plain strings untouched', () => {
    expect(translateMessage(dict, 'Some raw validation text', 'en')).toBe(
      'Some raw validation text',
    );
  });

  it('does not split a composed message whose code is unknown', () => {
    expect(translateMessage(dict, 'UNKNOWN: x', 'en')).toBe('UNKNOWN: x');
  });

  it('returns an empty string for an empty or missing message', () => {
    expect(translateMessage(dict, undefined, 'en')).toBe('');
    expect(translateMessage(dict, '', 'en')).toBe('');
  });

  it('ignores a ": " at position 0 (no empty code)', () => {
    expect(translateMessage(dict, ': x', 'en')).toBe(': x');
  });
});

describe('toCodeMap', () => {
  it('maps every key to itself', () => {
    expect(toCodeMap(dict)).toEqual({ EMAIL_EXISTS: 'EMAIL_EXISTS', VI_ONLY: 'VI_ONLY' });
  });
});
