import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import {
  assertLocalWorkspaceRequest,
  getLocalWorkspaceConfig,
  LOCAL_WORKSPACE_UID,
} from 'src/auth/local-workspace/policy';
import { ThrottlerBehindProxyGuard } from 'src/guards/throttler-behind-proxy.guard';
import { CapacityService } from './capacity.service';

type OwnerRequest = Request & { user: { uid: string } };

@Controller({ path: 'workbench-mcp/service-capacity', version: '1' })
@UseGuards(ThrottlerBehindProxyGuard, JwtAuthGuard)
export class CapacityController {
  constructor(
    private readonly capacity: CapacityService,
    private readonly config: ConfigService,
  ) {}

  private owner(req: OwnerRequest, write = false) {
    assertLocalWorkspaceRequest(
      req,
      getLocalWorkspaceConfig(this.config),
      write,
    );
    if (
      req.user?.uid !== LOCAL_WORKSPACE_UID ||
      req.headers['x-workbench-local'] !== '1'
    )
      throw new ForbiddenException();
    req.res?.setHeader('Cache-Control', 'no-store');
  }

  @Get()
  read(@Req() req: OwnerRequest) {
    this.owner(req);
    return this.capacity.view();
  }

  @Post()
  @HttpCode(200)
  async write(@Req() req: OwnerRequest, @Body() body: Record<string, unknown>) {
    this.owner(req, true);
    await this.capacity.save(req.user.uid, body?.overrides, body?.revision);
    return this.capacity.view();
  }
}
