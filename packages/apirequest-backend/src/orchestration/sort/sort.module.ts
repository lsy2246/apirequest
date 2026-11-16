import { Module } from '@nestjs/common';
import { SortService } from './sort.service';
import { SortUserCollectionResolver } from './sort-user-collection.resolver';
import { UserCollectionModule } from 'src/user-collection/user-collection.module';
import { UserRequestModule } from 'src/user-request/user-request.module';

@Module({
  imports: [UserCollectionModule, UserRequestModule],
  providers: [SortUserCollectionResolver, SortService],
})
export class SortModule {}
