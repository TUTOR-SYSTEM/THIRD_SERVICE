import { z } from 'zod';
import { ZodValidationPipe } from '@packages/pipes';

const catchError = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err as { getResponse: () => { errors: { field: string; message: string }[] } };
  }
  throw new Error('expected a throw');
};

describe('ZodValidationPipe — one error per field', () => {
  it('keeps only the first issue for a field that fails several rules', () => {
    const pipe = new ZodValidationPipe(z.object({ code: z.string().min(3).email() }));
    const err = catchError(() => pipe.transform({ code: 'x' }));

    const fields = err.getResponse().errors.map((e) => e.field);
    expect(fields).toEqual(['code']);
  });
});
