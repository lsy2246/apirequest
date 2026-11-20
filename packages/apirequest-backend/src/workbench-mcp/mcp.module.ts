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
@Module({
  imports: [
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
  ],
  controllers: [WorkbenchMcpController],
})
export class WorkbenchMcpModule {}
