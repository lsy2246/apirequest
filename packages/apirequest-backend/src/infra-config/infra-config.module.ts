import { Module } from '@nestjs/common';
import { InfraConfigService } from './infra-config.service';
import { InfraConfigResolver } from './infra-config.resolver';
import { UserModule } from 'src/user/user.module';

@Module({
  imports: [UserModule],
  providers: [InfraConfigResolver, InfraConfigService],
  exports: [InfraConfigService],
})
export class InfraConfigModule {}
