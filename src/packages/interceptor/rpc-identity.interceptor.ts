import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { RmqContext } from '@nestjs/microservices';
import { Observable } from 'rxjs';
import {
  carriesIdentity,
  stripRpcIdentitySeal,
  verifyRpcIdentity,
} from '@packages/helpers/rpc-identity.helper';

/**
 * Responder side of the identity seal (see rpc-identity.helper.ts). A message that names a user or a
 * role is honoured only when it was sealed with RPC_ACTOR_SECRET; anything else gets 403. The seal
 * fields are removed before the handler runs.
 */
@Injectable()
export class RpcIdentityInterceptor implements NestInterceptor {
  constructor(private readonly secret: string) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') return next.handle();
    const rpc = context.switchToRpc();
    const data = rpc.getData<unknown>();
    if (!carriesIdentity(data)) return next.handle();
    const pattern = rpc.getContext<RmqContext>().getPattern();
    if (!verifyRpcIdentity(pattern, data, this.secret)) {
      throw new ForbiddenException('FORBIDDEN_RPC_IDENTITY');
    }
    stripRpcIdentitySeal(data);
    return next.handle();
  }
}
