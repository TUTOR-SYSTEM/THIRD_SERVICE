import { decodeMulterFilename } from '@packages/helpers';

describe('decodeMulterFilename', () => {
  it('recovers a UTF-8 filename that multer decoded as latin1', () => {
    const mojibake = Buffer.from('Bài giảng.pdf', 'utf8').toString('latin1');
    expect(decodeMulterFilename(mojibake)).toBe('Bài giảng.pdf');
  });

  it('leaves pure ASCII names unchanged', () => {
    expect(decodeMulterFilename('report-2026.docx')).toBe('report-2026.docx');
  });
});
