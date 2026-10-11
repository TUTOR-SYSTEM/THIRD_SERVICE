import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { compareData, hashData } from '@packages/helpers';

jest.mock('bcrypt', () => {
  const actual = jest.requireActual('bcrypt');
  return { ...actual, hash: jest.fn(actual.hash), compare: jest.fn(actual.compare) };
});

const hashMock = bcrypt.hash as unknown as jest.Mock;
const compareMock = bcrypt.compare as unknown as jest.Mock;

describe('hashData / compareData', () => {
  it('hashes with bcrypt and verifies the original value', async () => {
    const hash = await hashData('secret');
    expect(hash).not.toBe('secret');
    expect(await compareData('secret', hash)).toBe(true);
  });

  it('returns false for a wrong value', async () => {
    const hash = await hashData('secret');
    expect(await compareData('other', hash)).toBe(false);
  });

  it('wraps a hashing failure in BadRequestException', async () => {
    hashMock.mockRejectedValueOnce(new Error('boom'));
    await expect(hashData('x')).rejects.toThrow(BadRequestException);
    hashMock.mockRejectedValueOnce(new Error('boom'));
    await expect(hashData('x')).rejects.toThrow('Failed to hash data');
  });

  it('wraps a verification failure in BadRequestException', async () => {
    compareMock.mockRejectedValueOnce(new Error('bad hash'));
    await expect(compareData('x', 'not-a-hash')).rejects.toThrow('Failed to verify data');
  });
});
