type HoppRESTContentType =
  | null
  | "multipart/form-data"
  | "application/json"
  | "application/ld+json"
  | "application/hal+json"
  | "application/vnd.api+json"
  | "application/xml"
  | "text/xml"
  | "application/x-www-form-urlencoded"
  | "binary"
  | "text/html"
  | "text/plain"
  | "application/octet-stream"

interface HoppRESTHeader {
  key: string
  value: string
  active: boolean
  description: string
}

interface HoppRESTResponseHeader {
  key: string
  value: string
}

interface HoppRESTParam {
  key: string
  value: string
  active: boolean
  description: string
}

// Form data key-value pair for multipart/form-data
interface FormDataKeyValue {
  key: string
  active: boolean
  isFile: boolean
  value: string | Blob[] | null
}

interface HoppRESTReqBody {
  contentType: HoppRESTContentType
  body: string | null | File | FormDataKeyValue[]
}

interface Cookie {
  name: string
  value: string
  domain: string
  path: string
  expires?: string
  maxAge?: number
  secure: boolean
  httpOnly: boolean
  sameSite: "None" | "Lax" | "Strict"
  hostOnly?: boolean
}

type AuthLocation = "HEADERS" | "QUERY_PARAMS"
type DigestAlgorithm = "MD5" | "MD5-sess"
type DigestQOP = "auth" | "auth-int"
type JWTAlgorithm =
  | "HS256"
  | "HS384"
  | "HS512"
  | "RS256"
  | "RS384"
  | "RS512"
  | "PS256"
  | "PS384"
  | "PS512"
  | "ES256"
  | "ES384"
  | "ES512"
type HAWKAlgorithm = "sha256" | "sha1"

interface HoppRESTAuthNone {
  authType: "none"
  authActive: boolean
}

interface HoppRESTAuthInherit {
  authType: "inherit"
  authActive: boolean
}

interface HoppRESTAuthBasic {
  authType: "basic"
  authActive: boolean
  username: string
  password: string
}

interface HoppRESTAuthBearer {
  authType: "bearer"
  authActive: boolean
  token: string
}

interface HoppRESTAuthAPIKey {
  authType: "api-key"
  authActive: boolean
  key: string
  value: string
  addTo: AuthLocation
}

interface HoppRESTAuthOAuth2 {
  authType: "oauth-2"
  authActive: boolean
  grantTypeInfo: OAuth2GrantTypeInfo
  addTo: AuthLocation
}

type OAuth2GrantTypeInfo =
  | {
      grantType: "AUTHORIZATION_CODE"
      authEndpoint: string
      tokenEndpoint: string
      clientID: string
      clientSecret?: string
      scopes?: string
      isPKCE?: boolean
      codeVerifierMethod?: "plain" | "S256"
      token?: string
    }
  | {
      grantType: "CLIENT_CREDENTIALS"
      tokenEndpoint: string
      clientID: string
      clientSecret?: string
      scopes?: string
      clientAuthentication?: "AS_BASIC_AUTH_HEADERS" | "IN_BODY"
    }
  | {
      grantType: "PASSWORD"
      tokenEndpoint: string
      clientID: string
      clientSecret?: string
      username: string
      password: string
      scopes?: string
    }
  | {
      grantType: "IMPLICIT"
      authEndpoint: string
      clientID: string
      scopes?: string
    }
interface HoppRESTAuthAWSSignature {
  authType: "aws-signature"
  authActive: boolean
  accessKey: string
  secretKey: string
  region: string
  serviceName: string
  serviceToken?: string
  addTo: AuthLocation
}

interface HoppRESTAuthDigest {
  authType: "digest"
  authActive: boolean
  username: string
  password: string
  realm?: string
  nonce?: string
  algorithm: DigestAlgorithm
  qop: DigestQOP
  nc?: string
  cnonce?: string
  opaque?: string
  disableRetry: boolean
}

interface HoppRESTAuthHAWK {
  authType: "hawk"
  authActive: boolean
  authId: string
  authKey: string
  algorithm: HAWKAlgorithm
  includePayloadHash: boolean
  user?: string
  nonce?: string
  ext?: string
  app?: string
  dlg?: string
  timestamp?: string
}

interface HoppRESTAuthAkamaiEdgeGrid {
  authType: "akamai-eg"
  authActive: boolean
  accessToken: string
  clientToken: string
  clientSecret: string
  nonce?: string
  timestamp?: string
  host?: string
  headersToSign?: string
  maxBodySize?: string
}

interface HoppRESTAuthJWT {
  authType: "jwt"
  authActive: boolean
  secret: string
  privateKey?: string
  algorithm: JWTAlgorithm
  payload: string
  addTo: AuthLocation
  isSecretBase64Encoded: boolean
  headerPrefix: string
  paramName: string
  jwtHeaders: string
}

// Discriminated union for all auth types
type HoppRESTAuth =
  | HoppRESTAuthNone
  | HoppRESTAuthInherit
  | HoppRESTAuthBasic
  | HoppRESTAuthBearer
  | HoppRESTAuthAPIKey
  | HoppRESTAuthOAuth2
  | HoppRESTAuthAWSSignature
  | HoppRESTAuthDigest
  | HoppRESTAuthHAWK
  | HoppRESTAuthAkamaiEdgeGrid
  | HoppRESTAuthJWT

// Length property that can be used both as property and callable with comparison methods
// Matches actual runtime implementation in post-request.js lines 371-414
interface ChaiLengthAssertion {
  // Primary comparison methods (actually implemented in runtime)
  above(n: number): ChaiExpectation
  below(n: number): ChaiExpectation
  within(min: number, max: number): ChaiExpectation
  least(n: number): ChaiExpectation
  most(n: number): ChaiExpectation
  gte(n: number): ChaiExpectation
  lte(n: number): ChaiExpectation

  // Aliases implemented in runtime (for compatibility)
  greaterThan(n: number): ChaiExpectation // Alias for above()
  lessThan(n: number): ChaiExpectation // Alias for below()

  // Postman-style .at.least() and .at.most() support
  at: Readonly<{
    least(n: number): ChaiExpectation
    most(n: number): ChaiExpectation
  }>
}

// Chai-powered assertion interface
interface ChaiExpectation {
  // Negation
  not: ChaiExpectation

  // Language chains (improve readability without affecting assertions)
  to: ChaiExpectation
  be: ChaiExpectation
  been: ChaiExpectation
  is: ChaiExpectation
  that: ChaiExpectation
  which: ChaiExpectation
  and: ChaiExpectation
  has: ChaiExpectation
  have: ChaiExpectation
  with: ChaiExpectation
  at: ChaiExpectation
  of: ChaiExpectation
  same: ChaiExpectation
  but: ChaiExpectation
  does: ChaiExpectation
  still: ChaiExpectation
  also: ChaiExpectation

  // Modifiers (can be used as both properties and methods)
  deep: ChaiExpectation
  nested: ChaiExpectation
  own: ChaiExpectation
  ordered: ChaiExpectation
  any: ChaiExpectation
  all: ChaiExpectation

  // Include/contain can be used as both properties AND methods
  include: ChaiExpectation & ((value: any) => ChaiExpectation)
  contain: ChaiExpectation & ((value: any) => ChaiExpectation)
  includes: ChaiExpectation & ((value: any) => ChaiExpectation)
  contains: ChaiExpectation & ((value: any) => ChaiExpectation)

  // Type assertions - can be used as both property and method
  a: ChaiExpectation & ((type: string) => ChaiExpectation)
  an: ChaiExpectation & ((type: string) => ChaiExpectation)

  // Equality assertions
  equal(value: any): ChaiExpectation
  equals(value: any): ChaiExpectation
  eq(value: any): ChaiExpectation
  eql(value: any): ChaiExpectation

  // Truthiness assertions
  true: ChaiExpectation
  false: ChaiExpectation
  ok: ChaiExpectation
  null: ChaiExpectation
  undefined: ChaiExpectation
  NaN: ChaiExpectation
  exist: ChaiExpectation
  empty: ChaiExpectation
  arguments: ChaiExpectation

  // Numerical comparison assertions
  above(n: number): ChaiExpectation
  gt(n: number): ChaiExpectation
  greaterThan(n: number): ChaiExpectation
  below(n: number): ChaiExpectation
  lt(n: number): ChaiExpectation
  lessThan(n: number): ChaiExpectation
  least(n: number): ChaiExpectation
  gte(n: number): ChaiExpectation
  greaterThanOrEqual(n: number): ChaiExpectation
  most(n: number): ChaiExpectation
  lte(n: number): ChaiExpectation
  lessThanOrEqual(n: number): ChaiExpectation
  within(start: number, finish: number): ChaiExpectation
  closeTo(expected: number, delta: number): ChaiExpectation
  approximately(expected: number, delta: number): ChaiExpectation

  // Property assertions
  property(name: string, value?: any): ChaiExpectation
  ownProperty(name: string, value?: any): ChaiExpectation
  haveOwnProperty(name: string, value?: any): ChaiExpectation
  ownPropertyDescriptor(
    name: string,
    descriptor?: PropertyDescriptor
  ): ChaiExpectation

  // Length assertions - SPECIAL: Can be used as property or called with comparison methods
  // Allow .length to be called as function or used as property with comparison methods
  length: ChaiLengthAssertion & number & ((n: number) => ChaiExpectation)
  lengthOf: ((n: number) => ChaiExpectation) & ChaiLengthAssertion

  // String/Array inclusion assertions
  string(str: string): ChaiExpectation
  match(regex: RegExp): ChaiExpectation
  matches(regex: RegExp): ChaiExpectation
  members(set: any[]): ChaiExpectation
  oneOf(list: any[]): ChaiExpectation

  // Key assertions
  keys(...keys: string[] | [string[]]): ChaiExpectation
  key(key: string | string[]): ChaiExpectation

  // Function/Error assertions
  throw(
    errorLike?: any,
    errMsgMatcher?: string | RegExp,
    message?: string
  ): ChaiExpectation
  throws(
    errorLike?: any,
    errMsgMatcher?: string | RegExp,
    message?: string
  ): ChaiExpectation
  Throw(
    errorLike?: any,
    errMsgMatcher?: string | RegExp,
    message?: string
  ): ChaiExpectation
  respondTo(method: string): ChaiExpectation
  respondsTo(method: string): ChaiExpectation
  itself: ChaiExpectation
  satisfy(matcher: (value: any) => boolean): ChaiExpectation
  satisfies(matcher: (value: any) => boolean): ChaiExpectation

  // Object state assertions
  sealed: ChaiExpectation
  frozen: ChaiExpectation
  extensible: ChaiExpectation
  finite: ChaiExpectation

  // instanceof assertion
  instanceof(constructor: any): ChaiExpectation
  instanceOf(constructor: any): ChaiExpectation

  // Side-effect assertions
  // Side effect assertions - support both getter function and object+property patterns
  change(
    getter: () => any
  ): ChaiExpectation & { by(delta: number): ChaiExpectation }
  change(
    obj: any,
    prop: string
  ): ChaiExpectation & { by(delta: number): ChaiExpectation }
  increase(
    getter: () => any
  ): ChaiExpectation & { by(delta: number): ChaiExpectation }
  increase(
    obj: any,
    prop: string
  ): ChaiExpectation & { by(delta: number): ChaiExpectation }
  decrease(
    getter: () => any
  ): ChaiExpectation & { by(delta: number): ChaiExpectation }
  decrease(
    obj: any,
    prop: string
  ): ChaiExpectation & { by(delta: number): ChaiExpectation }

  // Postman custom Chai assertions (available via pm.expect())
  /**
   * Assert that value matches JSON Schema
   * @param schema - JSON Schema object
   */
  jsonSchema(schema: {
    type?: string
    required?: string[]
    properties?: Record<string, any>
    items?: any
    enum?: any[]
    minimum?: number
    maximum?: number
    minLength?: number
    maxLength?: number
    pattern?: string
    minItems?: number
    maxItems?: number
  }): ChaiExpectation

  /**
   * Assert that string value contains specific charset/encoding
   * @param expectedCharset - Expected charset (e.g., 'utf-8', 'iso-8859-1')
   */
  charset(expectedCharset: string): ChaiExpectation

  /**
   * Assert that cookie exists and optionally has specific value
   * @param cookieName - Name of the cookie
   * @param cookieValue - Optional expected value
   */
  cookie(cookieName: string, cookieValue?: string): ChaiExpectation

  /**
   * Assert that JSON path exists and optionally has specific value
   * @param path - JSONPath expression (e.g., '$.users[0].name')
   * @param expectedValue - Optional expected value at path
   */
  jsonPath(path: string, expectedValue?: any): ChaiExpectation

  // Legacy methods (kept for backward compatibility)
  toBe(value: any): void
  toBeLevel2xx(): void
  toBeLevel3xx(): void
  toBeLevel4xx(): void
  toBeLevel5xx(): void
  toBeType(type: string): void
  toHaveLength(length: number): void
  toInclude(value: any): void
}

// Legacy expectation interface for pw namespace (backward compatibility only)
interface LegacyExpectation extends LegacyExpectationMethods {
  not: LegacyBaseExpectation
}

interface LegacyBaseExpectation extends LegacyExpectationMethods {}

interface LegacyExpectationMethods {
  toBe(value: any): void
  toBeLevel2xx(): void
  toBeLevel3xx(): void
  toBeLevel4xx(): void
  toBeLevel5xx(): void
  toBeType(type: string): void
  toHaveLength(length: number): void
  toInclude(value: any): void
}

// Backward compatibility types for hopp and pm namespaces
interface Expectation extends ChaiExpectation {}
interface BaseExpectation extends ChaiExpectation {}
interface ExpectationMethods extends ChaiExpectation {}

declare namespace hopp {
  const env: Readonly<{
    get(key: string): string | null
    getRaw(key: string): string | null
    getInitialRaw(key: string): string | null
    set(key: string, value: string): void
    delete(key: string): void
    reset(key: string): void
    setInitial(key: string, value: string): void
    active: Readonly<{
      get(key: string): string | null
      getRaw(key: string): string | null
      getInitialRaw(key: string): string | null
      set(key: string, value: string): void
      delete(key: string): void
      reset(key: string): void
      setInitial(key: string, value: string): void
    }>
    global: Readonly<{
      get(key: string): string | null
      getRaw(key: string): string | null
      getInitialRaw(key: string): string | null
      set(key: string, value: string): void
      delete(key: string): void
      reset(key: string): void
      setInitial(key: string, value: string): void
    }>
  }>

  const request: Readonly<{
    readonly url: string
    readonly method: string
    readonly params: HoppRESTParam[]
    readonly headers: HoppRESTHeader[]
    readonly body: HoppRESTReqBody
    readonly auth: HoppRESTAuth
    variables: Readonly<{
      get(key: string): string | null
    }>
  }>

  const response: Readonly<{
    readonly statusCode: number
    readonly statusText: string
    readonly headers: HoppRESTResponseHeader[]
    readonly responseTime: number
    body: Readonly<{
      asText(): string
      asJSON(): any
      bytes(): Uint8Array
    }>
    /**
     * Get response body as text string
     * @returns Response body as string
     */
    text(): string
    /**
     * Get response body as parsed JSON
     * @returns Parsed JSON object
     */
    json(): any
    /**
     * Get HTTP reason phrase (status text)
     * @returns HTTP reason phrase (e.g., "OK", "Not Found")
     */
    reason(): string
    /**
     * Convert response to data URI format
     * @returns Data URI string with base64 encoded content
     */
    dataURI(): string
    /**
     * Parse JSONP response
     * @param callbackName - Optional callback function name (default: "callback")
     * @returns Parsed JSON object from JSONP wrapper
     */
    jsonp(callbackName?: string): any
  }>

  const cookies: Readonly<{
    get(domain: string, name: string): Cookie | null
    set(domain: string, cookie: Cookie): void
    has(domain: string, name: string): boolean
    getAll(domain: string): Cookie[]
    delete(domain: string, name: string): void
    clear(domain: string): void
  }>

  function test(name: string, testFunction: () => void): void

  interface HoppExpectFunction {
    (value: any): ChaiExpectation
    /**
     * Fail the test with a custom message
     * @param message - Optional message to display on failure
     */
    fail(message?: string): never
  }

  const expect: HoppExpectFunction

  const info: Readonly<{
    readonly eventName: "post-request"
    readonly requestName: string
    readonly requestId: string
    readonly iteration: never
    readonly iterationCount: never
  }>

  /**
   * Fetch API - Makes HTTP requests respecting interceptor settings
   * @param input - URL string or Request object
   * @param init - Optional request options
   * @returns Promise that resolves to Response object
   */
  function fetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response>
}

/**
 * Global fetch function - alias to hopp.fetch()
 * Makes HTTP requests respecting interceptor settings
 * @param input - URL string or Request object
 * @param init - Optional request options
 * @returns Promise that resolves to Response object
 */
declare function fetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response>
