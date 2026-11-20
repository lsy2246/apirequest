import { SiteSettingsModule } from 'src/site-settings/site-settings.module';
import { Module } from '@nestjs/common';
import { UserCollectionModule } from 'src/user-collection/user-collection.module';
import { UserRequestModule } from 'src/user-request/user-request.module';
import { UserEnvironmentsModule } from 'src/user-environment/user-environments.module';
import { MockServerModule } from 'src/mock-server/mock-server.module';
import { PublishedDocsModule } from 'src/published-docs/published-docs.module';
import { McpDomainService } from './domain.service';
import { WorkbenchMcpService } from './mcp.service';
import { WorkbenchAutomationService } from './automation.service';
import { WorkbenchMcpController } from './mcp.controller';
import { WorkbenchDataSyncService } from './data-sync.service';
import { WorkspaceIndexService } from './workspace-index.service';
import { AutomationWebhookService } from './automation-webhook.service';
@Module({
  imports: [
    SiteSettingsModule,
    UserCollectionModule,
    UserRequestModule,
    UserEnvironmentsModule,
    MockServerModule,
    PublishedDocsModule,
  ],
  providers: [
    WorkspaceIndexService,
    WorkbenchDataSyncService,
    McpDomainService,
    WorkbenchMcpService,
    WorkbenchAutomationService,
    AutomationWebhookService,
  ],
  controllers: [WorkbenchMcpController],
})
export class WorkbenchMcpModule {}
