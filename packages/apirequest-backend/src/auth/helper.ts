import { HttpException, HttpStatus } from '@nestjs/common';
import { AuthTokens } from 'src/types/AuthTokens';
import { Response } from 'express';
import * as cookie from 'cookie';
import { COOKIES_NOT_FOUND } from 'src/errors';

import { ConfigService } from '@nestjs/config';
import { IncomingHttpHeaders } from 'http';

enum AuthTokenType {
  ACCESS_TOKEN = 'access_token',
  REFRESH_TOKEN = 'refresh_token',
}

/**
 * Sets and returns the cookies in the response object on successful authentication
 * @param res Express Response Object
 * @param authTokens Object containing the access and refresh tokens
 * @param redirect if true will redirect to provided URL else just send a 200 status code
 */
export const authCookieHandler = (
  res: Response,
  authTokens: AuthTokens,
  configService: ConfigService,
) => {
  // Calculate token validity periods in milliseconds
  let accessTokenValidityInMs = parseInt(
    configService.get('INFRA.ACCESS_TOKEN_VALIDITY'),
  );
  let refreshTokenValidityInMs = parseInt(
    configService.get('INFRA.REFRESH_TOKEN_VALIDITY'),
  );

  // Set default values if parsing results in NaN
  if (isNaN(accessTokenValidityInMs)) accessTokenValidityInMs = 86400000; // Default: 1 day
  if (isNaN(refreshTokenValidityInMs)) refreshTokenValidityInMs = 604800000; // Default: 7 days

  res.cookie(AuthTokenType.ACCESS_TOKEN, authTokens.access_token, {
    httpOnly: true,
    secure: configService.get('INFRA.ALLOW_SECURE_COOKIES') === 'true',
    sameSite: 'lax',
    maxAge: accessTokenValidityInMs,
  });
  res.cookie(AuthTokenType.REFRESH_TOKEN, authTokens.refresh_token, {
    httpOnly: true,
    secure: configService.get('INFRA.ALLOW_SECURE_COOKIES') === 'true',
    sameSite: 'lax',
    maxAge: refreshTokenValidityInMs,
  });

  return res.status(HttpStatus.OK).send();
};

/**
 * Decode the cookie header from incoming websocket connects and returns a auth token pair
 * @param rawCookies cookies from the websocket connection
 * @returns AuthTokens for JWT strategy to use
 */
export const subscriptionContextCookieParser = (rawCookies: string) => {
  const cookies = cookie.parse(rawCookies);

  if (
    !cookies[AuthTokenType.ACCESS_TOKEN] &&
    !cookies[AuthTokenType.REFRESH_TOKEN]
  ) {
    throw new HttpException(COOKIES_NOT_FOUND, 400, {
      cause: new Error(COOKIES_NOT_FOUND),
    });
  }

  return <AuthTokens>{
    access_token: cookies[AuthTokenType.ACCESS_TOKEN],
    refresh_token: cookies[AuthTokenType.REFRESH_TOKEN],
  };
};

/**
 * Check to see if given auth provider is present in the VITE_ALLOWED_AUTH_PROVIDERS env variable
 *
 * @param provider Provider we want to check the presence of
 * @returns Boolean if provider specified is present or not
 */

/**
 * Extract cookie as key-value pairs from headers of a request
 * @param headers HTTP request headers containing auth tokens
 * @returns Cookie's key-value pairs
 */
export const extractCookieAsKeyValuesFromHeaders = (
  headers: IncomingHttpHeaders,
) => {
  const cookieHeader =
    headers['cookie'] || headers['Cookie'] || headers['COOKIE'];

  if (!cookieHeader) {
    throw new HttpException(COOKIES_NOT_FOUND, 400, {
      cause: new Error(COOKIES_NOT_FOUND),
    });
  }

  const cookieStr = Array.isArray(cookieHeader)
    ? cookieHeader[0]
    : cookieHeader;

  const kv = cookieStr
    .split(';')
    .map((cookie) => cookie.trim())
    .reduce(
      (acc, curr) => {
        const [key, value] = curr.split('=');
        acc[key] = value;
        return acc;
      },
      {} as Record<string, string>,
    );

  return kv;
};

/**
 * Extract auth tokens from cookie headers of a request
 * @param headers HTTP request headers containing auth tokens
 * @returns AuthTokens for JWT strategy to use
 */
export const extractAuthTokensFromCookieHeaders = (
  headers: IncomingHttpHeaders,
) => {
  const cookieKV = extractCookieAsKeyValuesFromHeaders(headers);

  if (
    !cookieKV[AuthTokenType.ACCESS_TOKEN] ||
    !cookieKV[AuthTokenType.REFRESH_TOKEN]
  ) {
    throw new HttpException(COOKIES_NOT_FOUND, 400, {
      cause: new Error(COOKIES_NOT_FOUND),
    });
  }

  return <AuthTokens>{
    access_token: cookieKV[AuthTokenType.ACCESS_TOKEN],
    refresh_token: cookieKV[AuthTokenType.REFRESH_TOKEN],
  };
};

/**
 * Extract access tokens from cookie headers of a request
 * @param headers HTTP request headers containing access tokens
 * @returns AccessTokens for JWT strategy to use
 */
export const extractAccessTokensFromCookieHeaders = (
  headers: IncomingHttpHeaders,
) => {
  const cookieKV = extractCookieAsKeyValuesFromHeaders(headers);

  if (!cookieKV[AuthTokenType.ACCESS_TOKEN]) {
    throw new HttpException(COOKIES_NOT_FOUND, 400, {
      cause: new Error(COOKIES_NOT_FOUND),
    });
  }

  return {
    access_token: cookieKV[AuthTokenType.ACCESS_TOKEN],
  };
};

/**
 * Extract access token from authorization header
 * @param headers HTTP request headers containing bearer token
 * @returns AccessTokens for JWT strategy
 */
