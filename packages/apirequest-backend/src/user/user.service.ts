import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import * as O from 'fp-ts/Option';
import * as E from 'fp-ts/Either';

import { AuthUser } from 'src/types/AuthUser';
import { USER_NOT_FOUND } from 'src/errors';
import { User } from './user.model';
import { PubSubService } from 'src/pubsub/pubsub.service';

import { User as DbUser } from 'src/generated/prisma/client';

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pubsub: PubSubService,
  ) {}
  /**
   * Converts a prisma user object to a user object
   *
   * @param dbUser Prisma User object
   * @returns  User object
   */
  convertDbUserToUser(dbUser: DbUser): User {
    return dbUser;
  }
  /**
   * Find User with given ID
   *
   * @param userUid User ID
   * @returns Option of found User
   */
  async findUserById(userUid: string): Promise<O.None | O.Some<AuthUser>> {
    try {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: {
          uid: userUid,
        },
      });
      return O.some(user);
    } catch {
      return O.none;
    }
  }
  /**
   * Update User with new generated hashed refresh token
   *
   * @param refreshTokenHash Hash of newly generated refresh token
   * @param userUid User uid
   * @returns Either of User with updated refreshToken
   */
  async updateUserRefreshToken(refreshTokenHash: string, userUid: string) {
    try {
      const user = await this.prisma.user.update({
        where: {
          uid: userUid,
        },
        data: {
          refreshToken: refreshTokenHash,
        },
      });
      return E.right(user);
    } catch {
      return E.left(USER_NOT_FOUND);
    }
  }
  /**
   * Update user's lastLoggedOn timestamp
   * @param userUID User UID
   */
  async updateUserLastLoggedOn(userUid: string) {
    try {
      await this.prisma.user.update({
        where: { uid: userUid },
        data: { lastLoggedOn: new Date() },
      });
      return E.right(true);
    } catch {
      return E.left(USER_NOT_FOUND);
    }
  }
  /**
   * Update user's lastActiveOn timestamp
   * @param userUID User UID
   */
  async updateUserLastActiveOn(userUid: string) {
    try {
      await this.prisma.user.update({
        where: { uid: userUid },
        data: { lastActiveOn: new Date() },
      });
      return E.right(true);
    } catch {
      return E.left(USER_NOT_FOUND);
    }
  }
  /**
   * Get user deletion error messages when the data handlers are initialised in respective modules
   * @param user User Object
   * @returns an TaskOption of string array
   */
}
