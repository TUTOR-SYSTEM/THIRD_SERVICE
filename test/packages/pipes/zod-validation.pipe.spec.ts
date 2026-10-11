import { UnprocessableEntityException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '@packages/pipes';

const schema = z.object({
  name: z.string().min(1),
  age: z.number().int(),
  nested: z.object({ code: z.string() }).optional(),
});

const catchError = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err as UnprocessableEntityException;
  }
  throw new Error('expected a throw');
};

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(schema);

  it('returns the parsed data for a valid object', () => {
    expect(pipe.transform({ name: 'A', age: 3 })).toEqual({ name: 'A', age: 3 });
  });

  it('parses a JSON string payload (multipart form fields) before validating', () => {
    expect(pipe.transform(JSON.stringify({ name: 'A', age: 3 }))).toEqual({ name: 'A', age: 3 });
  });

  it('keeps a non-JSON string as-is, so validation rejects it', () => {
    const err = catchError(() => pipe.transform('not json'));
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(err.getResponse()).toMatchObject({ statusCode: 422, errors: [{ field: '' }] });
  });

  it('reports only the first issue per field, with dotted paths for nested fields', () => {
    const err = catchError(() => pipe.transform({ name: '', nested: { code: 1 } }));
    const { errors } = err.getResponse() as { errors: { field: string; code: string }[] };
    expect(errors.map((e) => e.field)).toEqual(['name', 'age', 'nested.code']);
    expect(errors.find((e) => e.field === 'name')?.code).toBe('too_small');
  });

  // BUG (expected to fail): any JSON-looking body string is parsed, so a body that is
  // legitimately a plain string such as "123" is coerced to a number before validation.
  it.failing('does not coerce a plain-string body that looks like JSON', () => {
    expect(new ZodValidationPipe(z.string()).transform('123')).toBe('123');
  });
});
