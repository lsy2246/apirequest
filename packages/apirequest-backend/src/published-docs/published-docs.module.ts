import { UserCollectionModule } from 'src/user-collection/user-collection.module';
import { Module } from '@nestjs/common';
import { PublishedDocsResolver } from './published-docs.resolver';
import { PublishedDocsService } from './published-docs.service';
import { PublishedDocsController } from './published-docs.controller';

@Module({
  imports: [UserCollectionModule],
  // 供本机 MCP 适配层复用同一业务服务，避免复制权限与发布逻辑。
  exports: [PublishedDocsService],
  controllers: [PublishedDocsController],
  providers: [PublishedDocsResolver, PublishedDocsService],
})
export class PublishedDocsModule {}
