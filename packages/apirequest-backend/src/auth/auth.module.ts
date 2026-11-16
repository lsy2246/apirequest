import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UserModule } from 'src/user/user.module';
import { UserCollectionModule } from 'src/user-collection/user-collection.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LocalWorkspaceController } from './local-workspace/local-workspace.controller';
import { LocalWorkspaceService } from './local-workspace/local-workspace.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RTJwtStrategy } from './strategies/rt-jwt.strategy';

@Module({
  imports: [
    UserModule,
    UserCollectionModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('INFRA.JWT_SECRET'),
      }),
    }),
  ],
  controllers: [AuthController, LocalWorkspaceController],
  providers: [AuthService, LocalWorkspaceService, JwtStrategy, RTJwtStrategy],
})
export class AuthModule {}
