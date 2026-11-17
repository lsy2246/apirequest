import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import {
  assertLocalWorkspaceRequest,
  getLocalWorkspaceConfig,
  LOCAL_WORKSPACE_UID,
} from 'src/auth/local-workspace/policy';
import { AuthUser } from 'src/types/AuthUser';
import { ThrottlerBehindProxyGuard } from 'src/guards/throttler-behind-proxy.guard';
import { WorkbenchMcpService } from './mcp.service';
import { entity, object } from './contract';
import { WorkbenchAutomationService } from './automation.service';
import { McpDomainService } from './domain.service';
import { workbenchEvents } from '../workbench-events';
import { WorkbenchDataSyncService } from './data-sync.service';

type OwnerRequest = Request & { user: AuthUser };
@Controller({ path: 'workbench-mcp', version: '1' })
@UseGuards(ThrottlerBehindProxyGuard)
export class WorkbenchMcpController {
  constructor(
    private readonly service: WorkbenchMcpService,
    private readonly domain: McpDomainService,
    private readonly config: ConfigService,
    private readonly automation: WorkbenchAutomationService,
    private readonly dataSync: WorkbenchDataSyncService,
  ) {}
  private local(req: Request) {
    const policy = getLocalWorkspaceConfig(this.config);
    // 浏览器的同源只读请求不一定发送 Origin；写操作仍要求精确来源。
    assertLocalWorkspaceRequest(
      req,
      policy,
      !['GET', 'HEAD'].includes(req.method),
    );
  }
  private owner(req: OwnerRequest) {
    req.res?.setHeader('Cache-Control', 'no-store');
    this.local(req);
    // MCP 令牌可按当前策略提交变更，只有工作台会话可以审批或修改策略。
    if (
      req.user?.uid !== LOCAL_WORKSPACE_UID ||
      req.headers['x-workbench-local'] !== '1'
    )
      throw new ForbiddenException();
  }
  @Get('state')
  @UseGuards(JwtAuthGuard)
  async state(
    @Req() req: OwnerRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.owner(req);
    res.setHeader('Cache-Control', 'no-store');
    return this.service.state(req.user.uid);
  }
  @Post('data/http')
  @UseGuards(JwtAuthGuard)
  syncHttp(@Req() req: OwnerRequest, @Body() body: unknown) {
    this.owner(req);
    return this.dataSync.http(body);
  }
  @Post('data/oauth/start')
  @UseGuards(JwtAuthGuard)
  syncOAuthStart(@Req() req: OwnerRequest) {
    this.owner(req);
    return this.dataSync.oauthStart(req.user.uid);
  }
  @Post('data/oauth/poll')
  @UseGuards(JwtAuthGuard)
  syncOAuthPoll(@Req() req: OwnerRequest, @Body() body: any) {
    this.owner(req);
    return this.dataSync.oauthPoll(
      req.user.uid,
      String(body?.id),
      body?.cancel === true,
    );
  }
  @Get('data/extras')
  @UseGuards(JwtAuthGuard)
  syncExtras(@Req() req: OwnerRequest) {
    this.owner(req);
    return this.dataSync.extras(req.user.uid);
  }
  @Post('data/workspace/import')
  @UseGuards(JwtAuthGuard)
  syncWorkspace(@Req() req: OwnerRequest, @Body() body: unknown) {
    this.owner(req);
    return this.dataSync.importWorkspace(req.user.uid, body);
  }
  @Get('events')
  @UseGuards(JwtAuthGuard)
  events(@Req() req: OwnerRequest, @Res() res: Response) {
    this.owner(req);
    workbenchEvents.stream(req, res, req.user.uid);
  }
  @Post('access')
  @UseGuards(JwtAuthGuard)
  access(
    @Req() req: OwnerRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.owner(req);
    object(body);
    if (typeof body.enabled !== 'boolean') throw new ForbiddenException();
    res.setHeader('Cache-Control', 'no-store');
    return this.service.setAccess(req.user.uid, body.enabled);
  }
  @Post('proposals/:id/decision')
  @UseGuards(JwtAuthGuard)
  decide(
    @Req() req: OwnerRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.owner(req);
    object(body);
    if (typeof body.approve !== 'boolean') throw new ForbiddenException();
    return this.service.decide(id, body.approve, req.user);
  }
  @Post('approval-policy')
  @UseGuards(JwtAuthGuard)
  approvalPolicy(@Req() req: OwnerRequest, @Body() body: unknown) {
    this.owner(req);
    object(body);
    if (typeof body.required !== 'boolean') throw new BadRequestException();
    return this.service.setApprovalPolicy(req.user.uid, body.required);
  }
  @Get('configs/:kind')
  @UseGuards(JwtAuthGuard)
  async configs(@Req() req: OwnerRequest, @Param('kind') kind: string) {
    this.owner(req);
    entity(kind);
    return this.domain.list(kind, req.user.uid, 100, 0);
  }
  @Get('configs/:kind/:id')
  @UseGuards(JwtAuthGuard)
  async configById(
    @Req() req: OwnerRequest,
    @Param('kind') kind: string,
    @Param('id') id: string,
  ) {
    this.owner(req);
    entity(kind);
    return this.domain.get(kind, id, req.user.uid);
  }
  @Get('automation/schedules')
  @UseGuards(JwtAuthGuard)
  schedules(@Req() req: OwnerRequest) {
    this.owner(req);
    return this.automation.schedules(req.user.uid);
  }

  @Get('automation/runs')
  @UseGuards(JwtAuthGuard)
  runs(@Req() req: OwnerRequest) {
    this.owner(req);
    return this.automation.runs(req.user.uid);
  }

  @Post('automation/runs/:id/control')
  @UseGuards(JwtAuthGuard)
  controlRun(
    @Req() req: OwnerRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.owner(req);
    object(body);
    return this.automation.control(req.user.uid, id, body.action, body.choice);
  }

  @Get('automation/reports')
  @UseGuards(JwtAuthGuard)
  reports(@Req() req: OwnerRequest) {
    this.owner(req);
    return this.automation.reports(req.user.uid);
  }

  @Post('automation/reports/:id/delete')
  @UseGuards(JwtAuthGuard)
  deleteReport(@Req() req: OwnerRequest, @Param('id') id: string) {
    this.owner(req);
    return this.automation.deleteReport(req.user.uid, id);
  }

  @Post('automation/schedules')
  @UseGuards(JwtAuthGuard)
  createSchedule(@Req() req: OwnerRequest, @Body() body: unknown) {
    this.owner(req);
    return this.automation.save(req.user.uid, body);
  }

  @Post('automation/schedules/:id')
  @UseGuards(JwtAuthGuard)
  updateSchedule(
    @Req() req: OwnerRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.owner(req);
    return this.automation.save(req.user.uid, body, id);
  }

  @Post('automation/plans/:id/delete')
  @UseGuards(JwtAuthGuard)
  deleteAutomationPlan(@Req() req: OwnerRequest, @Param('id') id: string) {
    this.owner(req);
    return this.domain.deleteAutomationPlan(id, req.user.uid);
  }

  @Post('tool')
  async tool(
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.local(req);
    object(body);
    res.setHeader('Cache-Control', 'no-store');
    const token = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : '';
    const auth = await this.service.authorize(token);
    return this.service.tool(String(body.name), body.arguments ?? {}, auth);
  }
}
