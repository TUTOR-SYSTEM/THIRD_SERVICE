import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { RmqContext } from '@nestjs/microservices';
import { Observable } from 'rxjs';
import { requiresRpcSignature } from '@packages/helpers/redis-keys.policy';
import { stripRpcSignature, verifyRpcSignature } from '@packages/helpers/rpc-signature.helper';

/**
 * Responder side of rpcSig (see rpc-signature.helper.ts). Refuses a message the policy requires to
 * be signed when its signature is missing, stale or wrong, and removes the signature fields before
 * the handler runs. Registered after RpcIdentityInterceptor; the two rules cover disjoint patterns.
 */
@Injectable()
export class RpcSignatureInterceptor implements NestInterceptor {
  constructor(private readonly secret: string) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') return next.handle();
    const rpc = context.switchToRpc();
    const data = rpc.getData<unknown>();
    const pattern = rpc.getContext<RmqContext>().getPattern();
    if (requiresRpcSignature(pattern, data) && !verifyRpcSignature(pattern, data, this.secret)) {
      throw new ForbiddenException('FORBIDDEN_RPC_SIGNATURE');
    }
    stripRpcSignature(data);
    return next.handle();
  }
}
