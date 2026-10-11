import { ROLES_KEY, Roles } from '@packages/decorators/roles.decorator';
import { API_RESPONSE_KEY, ApiResponse } from '@packages/decorators/api-success-response.decorator';

describe('Roles decorator', () => {
  it('stores the given roles under ROLES_KEY', () => {
    const decorator = Roles('ADMIN', 'TUTOR');
    const target = class {};
    decorator(target);
    expect(Reflect.getMetadata(ROLES_KEY, target)).toEqual(['ADMIN', 'TUTOR']);
  });
});

describe('ApiResponse decorator', () => {
  it('stores the response options under API_RESPONSE_KEY', () => {
    const options = { status: 201, message: 'Created' } as never;
    const decorator = ApiResponse(options);
    const target = class {};
    decorator(target);
    expect(Reflect.getMetadata(API_RESPONSE_KEY, target)).toEqual(options);
  });
});
