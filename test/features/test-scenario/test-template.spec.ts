import {
  UNKNOWN_UUID,
  builtinVariable,
  collectVariables,
  extractPath,
  renderString,
  renderValue,
} from 'src/features/test-scenario/test-template';

describe('test-template', () => {
  const vars = new Map([
    ['fixture.classId', 'c1'],
    ['accessToken', 'tok'],
  ]);

  it('collects distinct names from strings, keys and nested values', () => {
    expect(
      collectVariables('/classes/{{ fixture.classId }}', { authorization: 'Bearer {{accessToken}}' }, {
        ids: ['{{fixture.classId}}', 1, null],
        '{{uuid}}': true,
      }),
    ).toEqual(['fixture.classId', 'accessToken', 'uuid']);
  });

  it('renders known names and leaves unknown ones untouched', () => {
    expect(renderString('/classes/{{fixture.classId}}/{{other}}', vars)).toBe('/classes/c1/{{other}}');
  });

  it('renders deeply without changing non-string values', () => {
    expect(renderValue({ id: '{{fixture.classId}}', n: 3, list: ['{{accessToken}}', false] }, vars)).toEqual({
      id: 'c1',
      n: 3,
      list: ['tok', false],
    });
  });

  it('knows the built-ins and nothing else', () => {
    expect(builtinVariable('unknownUuid')).toBe(UNKNOWN_UUID);
    expect(builtinVariable('uuid')).toMatch(/^[0-9a-f-]{36}$/);
    expect(builtinVariable('uuid')).not.toBe(builtinVariable('uuid'));
    expect(builtinVariable('timestamp')).toMatch(/^\d+$/);
    expect(builtinVariable('random.string')).toMatch(/^\w{8}$/);
    expect(builtinVariable('fixture.x')).toBeUndefined();
  });

  it('extracts dot paths with array indexes', () => {
    const body = { data: { classes: [{ id: 'a' }, { id: 'b' }] } };
    expect(extractPath(body, 'data.classes.1.id')).toBe('b');
    expect(extractPath(body, 'data.missing.id')).toBeUndefined();
    expect(extractPath('text', 'data')).toBeUndefined();
  });
});
