import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { UserHistoryUserResolver } from './user.resolver';
import { UserHistoryResolver } from './user-history.resolver';
import { UserHistoryService } from './user-history.service';
import { WorkbenchHistoryResultsController } from './workbench-history-results.controller';
import { WorkbenchHistoryResultsService } from './workbench-history-results.service';
import { InfraConfigModule } from 'src/infra-config/infra-config.module';

@Module({
  imports: [UserModule, InfraConfigModule],
  controllers: [WorkbenchHistoryResultsController],
  providers: [
    UserHistoryResolver,
    UserHistoryService,
    UserHistoryUserResolver,
    WorkbenchHistoryResultsService,
  ],
  exports: [UserHistoryService],
})
export class UserHistoryModule {}
