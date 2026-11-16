import { HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { mockDeep, mockReset } from 'jest-mock-extended';
import * as argon2 from 'argon2';
import * as E from 'fp-ts/Either';
import { INVALID_REFRESH_TOKEN, USER_NOT_FOUND } from 'src/errors';
import { AuthUser } from 'src/types/AuthUser';
import { UserService } from 'src/user/user.service';
import { AuthService } from './auth.service';

jest.mock('argon2', () => ({
  verify: jest.fn(),
  hash: jest.fn(),
}));

const mockUser = mockDeep<UserService>();
const mockJWT = mockDeep<JwtService>();
const mockConfigService = mockDeep<ConfigService>();
const authService = new AuthService(mockUser, mockJWT, mockConfigService);

beforeEach(() => {
  mockReset(mockUser);
  mockReset(mockJWT);
  mockReset(mockConfigService);
  jest.mocked(argon2.verify).mockResolvedValue(true);
  jest.mocked(argon2.hash).mockResolvedValue('refresh-token-hash');
});

const currentTime = new Date();

const user: AuthUser = {
  uid: '123344',
  email: 'dwight@dundermifflin.com',
  displayName: 'Dwight Schrute',
  photoURL: 'https://en.wikipedia.org/wiki/Dwight_Schrute',
  isAdmin: false,
  refreshToken: 'hbfvdkhjbvkdvdfjvbnkhjb',
  lastLoggedOn: currentTime,
  lastActiveOn: currentTime,
  createdOn: currentTime,
  currentGQLSession: {},
  currentRESTSession: {},
};

describe('generateAuthTokens', () => {
  test('Should successfully generate tokens with valid inputs', async () => {
    mockJWT.sign.mockReturnValue(user.refreshToken);
    // UpdateUserRefreshToken
    mockUser.updateUserRefreshToken.mockResolvedValueOnce(E.right(user));

    const result = await authService.generateAuthTokens(user.uid);
    expect(result).toEqualRight({
      access_token: 'hbfvdkhjbvkdvdfjvbnkhjb',
      refresh_token: 'hbfvdkhjbvkdvdfjvbnkhjb',
    });
  });

  test('Should throw USER_NOT_FOUND when updating refresh tokens fails', async () => {
    mockJWT.sign.mockReturnValue(user.refreshToken);
    // UpdateUserRefreshToken
    mockUser.updateUserRefreshToken.mockResolvedValueOnce(
      E.left(USER_NOT_FOUND),
    );

    const result = await authService.generateAuthTokens(user.uid);
    expect(result).toEqualLeft({
      message: USER_NOT_FOUND,
      statusCode: HttpStatus.NOT_FOUND,
    });
  });
});

describe('refreshAuthTokens', () => {
  test('Should throw USER_NOT_FOUND when updating refresh tokens fails', async () => {
    // generateAuthTokens
    mockJWT.sign.mockReturnValue(user.refreshToken);
    // UpdateUserRefreshToken
    mockUser.updateUserRefreshToken.mockResolvedValueOnce(
      E.left(USER_NOT_FOUND),
    );

    const result = await authService.refreshAuthTokens(
      '$argon2id$v=19$m=65536,t=3,p=4$MvVOam2clCOLtJFGEE26ZA$czvA5ez9hz+A/LML8QRgqgaFuWa5JcbwkH6r+imTQbs',
      user,
    );
    expect(result).toEqualLeft({
      message: USER_NOT_FOUND,
      statusCode: HttpStatus.NOT_FOUND,
    });
  });

  test('Should throw USER_NOT_FOUND when user is invalid', async () => {
    const result = await authService.refreshAuthTokens(
      'jshdcbjsdhcbshdbc',
      null,
    );
    expect(result).toEqualLeft({
      message: USER_NOT_FOUND,
      statusCode: HttpStatus.NOT_FOUND,
    });
  });

  test('Should successfully refresh the tokens and generate a new auth token pair', async () => {
    // generateAuthTokens
    mockJWT.sign.mockReturnValue('sdhjcbjsdhcbshjdcb');
    // UpdateUserRefreshToken
    mockUser.updateUserRefreshToken.mockResolvedValueOnce(
      E.right({
        ...user,
        refreshToken: 'sdhjcbjsdhcbshjdcb',
      }),
    );

    const result = await authService.refreshAuthTokens(
      '$argon2id$v=19$m=65536,t=3,p=4$MvVOam2clCOLtJFGEE26ZA$czvA5ez9hz+A/LML8QRgqgaFuWa5JcbwkH6r+imTQbs',
      user,
    );
    expect(result).toEqualRight({
      access_token: 'sdhjcbjsdhcbshjdcb',
      refresh_token: 'sdhjcbjsdhcbshjdcb',
    });
  });

  test('Should throw INVALID_REFRESH_TOKEN when the refresh token is invalid', async () => {
    // generateAuthTokens
    mockJWT.sign.mockReturnValue('sdhjcbjsdhcbshjdcb');
    jest.mocked(argon2.verify).mockResolvedValueOnce(false);

    const result = await authService.refreshAuthTokens('invalid-token', user);
    expect(result).toEqualLeft({
      message: INVALID_REFRESH_TOKEN,
      statusCode: HttpStatus.NOT_FOUND,
    });
  });
});
