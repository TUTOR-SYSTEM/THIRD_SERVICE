import { checkUuidValid, generateCode } from '@packages/helpers';

describe('generateCode', () => {
  it('defaults to 6 characters from the uppercase alphanumeric set', () => {
    expect(generateCode()).toMatch(/^[A-Z0-9]{6}$/);
  });

  it('honours a custom length', () => {
    expect(generateCode(12)).toMatch(/^[A-Z0-9]{12}$/);
  });

  it('returns an empty string for length 0', () => {
    expect(generateCode(0)).toBe('');
  });

  it('picks characters via Math.random (lowest and highest index)', () => {
    const spy = jest.spyOn(Math, 'random');
    spy.mockReturnValueOnce(0).mockReturnValueOnce(0.999999);
    expect(generateCode(2)).toBe('A9');
    spy.mockRestore();
  });
});

describe('checkUuidValid', () => {
  it.each([
    '123e4567-e89b-42d3-a456-426614174000', // v4
    '123e4567-e89b-12d3-8456-426614174000', // v1
    '123E4567-E89B-42D3-A456-426614174000', // upper case
  ])('accepts %s', (uuid) => {
    expect(checkUuidValid({ data: uuid })).toBe(true);
  });

  it.each([
    '',
    'not-a-uuid',
    '123e4567e89b42d3a456426614174000', // no dashes
    '123e4567-e89b-02d3-a456-426614174000', // version 0
    '123e4567-e89b-42d3-c456-426614174000', // invalid variant
    '00000000-0000-0000-0000-000000000000', // nil uuid
  ])('rejects %j', (value) => {
    expect(checkUuidValid({ data: value })).toBe(false);
  });
});
