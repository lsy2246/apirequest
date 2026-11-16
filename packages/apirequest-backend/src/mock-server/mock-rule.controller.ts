import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as E from 'fp-ts/Either';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import {
  assertLocalWorkspaceRequest,
  getLocalWorkspaceConfig,
  LOCAL_WORKSPACE_UID,
} from 'src/auth/local-workspace/policy';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthUser } from 'src/types/AuthUser';
import { WorkspaceType } from 'src/types/WorkspaceTypes';
import { parseMockRules } from './mock-engine';
import { MockTransportService } from './mock-transport';
import { MockRuleService, summarizeMockRules } from './mock-rule.service';
import { MockServerService } from './mock-server.service';

type OwnerRequest = Request & { user: AuthUser };

@Controller({ path: 'workbench-mock-rules', version: '1' })
@UseGuards(JwtAuthGuard)
export class MockRuleController {
  constructor(
    private readonly transport: MockTransportService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly rules: MockRuleService,
    private readonly servers: MockServerService,
  ) {}

  private owner(req: OwnerRequest) {
    const policy = getLocalWorkspaceConfig(this.config);
    if (
      req.user.uid !== LOCAL_WORKSPACE_UID ||
      req.get('x-workbench-local') !== '1'
    )
      throw new ForbiddenException();
    // 浏览器的同源只读请求不一定发送 Origin；写操作仍要求精确来源。
    assertLocalWorkspaceRequest(
      req,
      policy,
      !['GET', 'HEAD'].includes(req.method),
    );
    req.res?.setHeader('Cache-Control', 'no-store');
    return req.user.uid;
  }

  @Get()
  async list(@Req() req: OwnerRequest) {
    const uid = this.owner(req);
    const base = this.config
      .getOrThrow<string>('VITE_BACKEND_API_URL')
      .replace(/\/v1\/?$/, '');
    const servers = await this.prisma.mockServer.findMany({
      where: {
        workspaceID: uid,
        workspaceType: 'USER',
        deletedAt: null,
        collectionID: '',
      },
      select: {
        id: true,
        subdomain: true,
        name: true,
        isActive: true,
        ruleSet: true,
      },
      orderBy: { createdOn: 'asc' },
    });
    return servers.map(({ subdomain, ruleSet, ...server }) => ({
      ...server,
      ...summarizeMockRules(ruleSet),
      url: `${base}/mock/${subdomain}`,
    }));
  }

  @Post()
  async create(
    @Req() req: OwnerRequest,
    @Body() body: { name?: unknown; kind?: unknown; rules?: unknown },
  ) {
    this.owner(req);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name))
      throw new BadRequestException(
        'Mock service name must contain 1 to 100 characters',
      );
    const kind = body.kind ?? 'collection';
    if (kind !== 'single' && kind !== 'collection')
      throw new BadRequestException('Invalid Mock type');
    const initialRules =
      body.rules === undefined ? undefined : parseMockRules(body.rules);
    if (kind === 'single' && initialRules && initialRules.length !== 1)
      throw new BadRequestException(
        'A single Mock must contain exactly one rule',
      );
    const result = await this.servers.createMockServer(
      req.user,
      {
        name,
        workspaceType: WorkspaceType.USER,
        isPublic: true,
      },
      kind,
      initialRules,
    );
    if (E.isLeft(result)) throw new BadRequestException(result.left);
    const { id, name: savedName, isActive, serverUrlPathBased } = result.right;
    const state = await this.rules.state(id, req.user.uid);
    return {
      id,
      name: savedName,
      isActive,
      url: serverUrlPathBased,
      ...summarizeMockRules(state),
    };
  }

  @Post('inspect')
  preview(@Req() req: OwnerRequest, @Body() body: unknown) {
    this.owner(req);
    return this.rules.preview(body);
  }

  @Get(':id')
  state(@Req() req: OwnerRequest, @Param('id') id: string) {
    return this.rules.state(id, this.owner(req));
  }

  @Post(':id')
  save(
    @Req() req: OwnerRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.rules.save(id, this.owner(req), body);
  }

  @Post(':id/reset')
  reset(
    @Req() req: OwnerRequest,
    @Param('id') id: string,
    @Body() body: { ruleID?: unknown },
  ) {
    if (
      body?.ruleID !== undefined &&
      (typeof body.ruleID !== 'string' ||
        !/^[a-z0-9-]{8,64}$/i.test(body.ruleID))
    )
      throw new BadRequestException('Invalid Mock rule ID');
    return this.rules.reset(
      id,
      this.owner(req),
      body?.ruleID as string | undefined,
    );
  }

  @Post(':id/move')
  move(
    @Req() req: OwnerRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.rules.move(id, this.owner(req), body);
  }

  @Get(':id/logs')
  logs(
    @Req() req: OwnerRequest,
    @Param('id') id: string,
    @Query('skip') skip?: string,
  ) {
    return this.rules.logs(
      id,
      this.owner(req),
      Math.max(0, Number.parseInt(skip ?? '0', 10) || 0),
    );
  }

  @Post(':id/inspect')
  inspect(
    @Req() req: OwnerRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.rules.inspect(id, this.owner(req), body);
  }

  @Get(':id/logs/:logID')
  log(
    @Req() req: OwnerRequest,
    @Param('id') id: string,
    @Param('logID') logID: string,
  ) {
    return this.rules.log(id, this.owner(req), logID);
  }

  @Post(':id/logs/clear')
  clear(@Req() req: OwnerRequest, @Param('id') id: string) {
    return this.rules.clearLogs(id, this.owner(req));
  }

  @Post(':id/logs/:logID/capture')
  capture(
    @Req() req: OwnerRequest,
    @Param('id') id: string,
    @Param('logID') logID: string,
  ) {
    return this.rules.capture(id, this.owner(req), logID);
  }

  @Post(':id/logs/:logID/replay')
  replay(
    @Req() req: OwnerRequest,
    @Param('id') id: string,
    @Param('logID') logID: string,
  ) {
    return this.transport.replay(id, this.owner(req), logID);
  }

  @Post(':id/test')
  test(
    @Req() req: OwnerRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.transport.test(id, this.owner(req), body);
  }

  @Post(':id/status')
  async status(
    @Req() req: OwnerRequest,
    @Param('id') id: string,
    @Body() body: { isActive?: unknown },
  ) {
    const uid = this.owner(req);
    if (typeof body?.isActive !== 'boolean')
      throw new BadRequestException('Invalid Mock service status');
    await this.rules.state(id, uid);
    const result = await this.servers.updateMockServer(id, uid, {
      isActive: body.isActive,
    });
    if (E.isLeft(result)) throw new NotFoundException(result.left);
    return { isActive: result.right.isActive };
  }

  @Post(':id/delete')
  async delete(@Req() req: OwnerRequest, @Param('id') id: string) {
    const uid = this.owner(req);
    await this.rules.state(id, uid);
    const result = await this.servers.deleteMockServer(id, uid);
    if (E.isLeft(result)) throw new NotFoundException(result.left);
    return { deleted: result.right };
  }
}
