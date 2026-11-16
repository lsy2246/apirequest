import { Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { GqlAuthGuard } from 'src/guards/gql-auth.guard';
import { GqlUser } from 'src/decorators/gql-user.decorator';
import { AuthUser } from 'src/types/AuthUser';
import { User } from './user.model';
import { UserService } from './user.service';

@Resolver(() => User)
export class UserResolver {
  constructor(private readonly users: UserService) {}
  @Query(() => User)
  @UseGuards(GqlAuthGuard)
  me(@GqlUser() user: AuthUser) {
    return this.users.convertDbUserToUser(user);
  }
}
