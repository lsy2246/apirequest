import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LOCAL_WORKSPACE_UID } from '../auth/local-workspace/policy';
import { ThrottlerBehindProxyGuard } from '../guards/throttler-behind-proxy.guard';
import { WorkbenchHistoryResultsService } from './workbench-history-results.service';

type AuthRequest = Request & { user: { uid: string } };

@Controller({ path: 'workbench-history-results', version: '1' })
@UseGuards(ThrottlerBehindProxyGuard, JwtAuthGuard)
export class WorkbenchHistoryResultsController {
  constructor(private readonly results: WorkbenchHistoryResultsService) {}

  private owner(request: AuthRequest) {
    if (request.user.uid !== LOCAL_WORKSPACE_UID)
      throw new ForbiddenException();
    return request.user.uid;
  }

  @Get('policy')
  @Header('Cache-Control', 'no-store')
  policy(@Req() request: AuthRequest) {
    return this.results.policy(this.owner(request));
  }

  @Put('policy')
  setPolicy(
    @Req() request: AuthRequest,
    @Body() body: Parameters<WorkbenchHistoryResultsService['setPolicy']>[1],
  ) {
    return this.results.setPolicy(this.owner(request), body);
  }

  @Post('cleanup/preview')
  preview(
    @Req() request: AuthRequest,
    @Body() body: Parameters<WorkbenchHistoryResultsService['cleanup']>[1],
  ) {
    return this.results.cleanup(this.owner(request), body, true);
  }

  @Post('cleanup')
  cleanup(
    @Req() request: AuthRequest,
    @Body() body: Parameters<WorkbenchHistoryResultsService['cleanup']>[1],
  ) {
    return this.results.cleanup(this.owner(request), body, false);
  }

  @Get(':historyId')
  @Header('Cache-Control', 'no-store')
  detail(@Req() request: AuthRequest, @Param('historyId') historyId: string) {
    return this.results.detail(this.owner(request), historyId);
  }

  @Put(':historyId')
  save(@Req() request: AuthRequest, @Param('historyId') historyId: string) {
    return this.results.save(this.owner(request), historyId, request);
  }

  @Post(':historyId/attachments')
  attach(
    @Req() request: AuthRequest,
    @Param('historyId') historyId: string,
    @Body('url') url: unknown,
  ) {
    return this.results.attach(this.owner(request), historyId, url);
  }

  @Get(':historyId/body')
  body(
    @Req() request: AuthRequest,
    @Param('historyId') historyId: string,
    @Query('download') download: string | undefined,
    @Res() response: Response,
  ) {
    return this.sendFile(request, response, historyId, download);
  }

  @Get(':historyId/attachments/:fileId')
  attachment(
    @Req() request: AuthRequest,
    @Param('historyId') historyId: string,
    @Param('fileId') fileId: string,
    @Query('download') download: string | undefined,
    @Res() response: Response,
  ) {
    return this.sendFile(request, response, historyId, download, fileId);
  }

  private async sendFile(
    request: AuthRequest,
    response: Response,
    historyId: string,
    download?: string,
    fileId?: string,
  ) {
    const file = await this.results.body(
      this.owner(request),
      historyId,
      fileId,
    );
    const media = /^(image|video)\//.test(file.contentType);
    if (download === '1') response.attachment(file.name);
    response.set({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Content-Type':
        download === '1'
          ? 'application/octet-stream'
          : media
            ? file.contentType
            : 'text/plain; charset=utf-8',
    });
    if (file.path) return response.sendFile(file.path);
    return response.send(file.text);
  }
}
