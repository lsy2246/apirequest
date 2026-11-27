import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
  type ThrottlerRequest,
  type ThrottlerLimitDetail,
} from '@nestjs/throttler';
import {
  HttpException,
  HttpStatus,
  Injectable,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  CAPACITY_RATE,
  CapacityService,
  type CapacityRateGroup,
} from 'src/capacity/capacity.service';

@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly capacity: CapacityService,
  ) {
    super(options, storage, reflector);
  }

  private group(context: ExecutionContext) {
    return this.reflector.getAllAndOverride<CapacityRateGroup>(CAPACITY_RATE, [
      context.getHandler(),
      context.getClass(),
    ]);
  }

  protected async handleRequest(request: ThrottlerRequest): Promise<boolean> {
    const group = this.group(request.context);
    if (!group) return super.handleRequest(request);
    const { limit, ttl } = this.capacity.rate(group);
    if (limit === 0) return true;
    const previous = request.generateKey;
    return super.handleRequest({
      ...request,
      limit,
      ttl,
      blockDuration: ttl,
      generateKey: (context, tracker, name) =>
        previous(context, tracker, `${name}-${limit}-${ttl}`),
    });
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const group = this.group(context);
    if (!group) return super.throwThrottlingException(context, detail);
    throw new HttpException(
      {
        code: 'WORKBENCH_RATE_LIMIT',
        group,
        limit: detail.limit,
        windowSeconds: detail.ttl / 1000,
        retryAfter: detail.timeToBlockExpire,
        message: 'Service request rate exceeded',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.ips.length ? req.ips[0] : req.ip;
  }
}
