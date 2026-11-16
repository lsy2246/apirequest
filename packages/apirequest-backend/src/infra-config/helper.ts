import { ENV_INVALID_DATA_ENCRYPTION_KEY } from 'src/errors';
import { PrismaService } from 'src/prisma/prisma.service';
import { InfraConfigEnum } from 'src/types/InfraConfig';
import { decrypt, encrypt } from 'src/utils';
import { randomBytes } from 'crypto';

export enum ServiceStatus {
  ENABLE = 'ENABLE',
  DISABLE = 'DISABLE',
}
type DefaultInfraConfig = {
  name: InfraConfigEnum;
  value: string;
  isEncrypted: boolean;
};
// Singleton PrismaService instance for infra config operations
let sharedPrismaInstance: PrismaService | null = null;
/**
 * Get or create a shared PrismaService instance for infra config operations
 */
function getSharedPrismaInstance(): PrismaService {
  if (!sharedPrismaInstance) {
    sharedPrismaInstance = new PrismaService();
  }
  return sharedPrismaInstance;
}
/**
 * Disconnect the shared Prisma instance during application shutdown
 */
export async function disconnectSharedPrismaInstance(): Promise<void> {
  if (sharedPrismaInstance) {
    await sharedPrismaInstance.onModuleDestroy();
    sharedPrismaInstance = null;
  }
}
/**
 * Load environment variables from the database and set them in the process
 *
 * @Description Fetch the 'infra_config' table from the database and return it as an object
 * (ConfigModule will set the environment variables in the process)
 */
export async function loadInfraConfiguration() {
  const prisma = getSharedPrismaInstance();
  try {
    const infraConfigs = await prisma.infraConfig.findMany();
    const environmentObject: Record<string, string> = {};
    infraConfigs.forEach((infraConfig) => {
      if (infraConfig.isEncrypted) {
        environmentObject[infraConfig.name] = decrypt(infraConfig.value);
      } else {
        environmentObject[infraConfig.name] = infraConfig.value;
      }
    });
    return { INFRA: environmentObject };
  } catch (error) {
    if (error.code === 'ERR_OSSL_BAD_DECRYPT')
      throw new Error(ENV_INVALID_DATA_ENCRYPTION_KEY);
    // Prisma throw error if 'Can't reach at database server' OR 'Table does not exist'
    // Reason for not throwing error is, we want successful build during 'postinstall' and generate dist files
    console.error('Error from loadInfraConfiguration', error);
    return { INFRA: {} };
  }
}
/**
 * Read the default values from .env file and return them as an array
 * @returns Array of default infra configs
 */
export async function getDefaultInfraConfigs(): Promise<DefaultInfraConfig[]> {
  const prisma = getSharedPrismaInstance();
  // Prepare rows for 'infra_config' table with default values (from .env) for each 'name'
  const isSecureCookies = determineAllowSecureCookies(
    process.env.VITE_BASE_URL,
  );
  const infraConfigDefaultObjs: DefaultInfraConfig[] = [
    {
      name: InfraConfigEnum.JWT_SECRET,
      value: encrypt(randomBytes(32).toString('hex')),
      isEncrypted: true,
    },
    {
      name: InfraConfigEnum.SESSION_COOKIE_NAME,
      value: null,
      isEncrypted: false,
    },
    {
      name: InfraConfigEnum.TOKEN_SALT_COMPLEXITY,
      value: '10',
      isEncrypted: false,
    },
    {
      name: InfraConfigEnum.MAGIC_LINK_TOKEN_VALIDITY,
      value: '24', // 24 hours
      isEncrypted: false,
    },
    {
      name: InfraConfigEnum.REFRESH_TOKEN_VALIDITY,
      value: '604800000', // 7 days in milliseconds
      isEncrypted: false,
    },
    {
      name: InfraConfigEnum.ACCESS_TOKEN_VALIDITY,
      value: '86400000', // 1 day in milliseconds
      isEncrypted: false,
    },
    {
      name: InfraConfigEnum.ALLOW_SECURE_COOKIES,
      value: isSecureCookies.toString(),
      isEncrypted: false,
    },
    {
      name: InfraConfigEnum.RATE_LIMIT_TTL,
      value: '10000', // in milliseconds (10 seconds)
      isEncrypted: false,
    },
    {
      name: InfraConfigEnum.RATE_LIMIT_MAX,
      value: '100', // 100 requests per IP per RATE_LIMIT_TTL
      isEncrypted: false,
    },
    {
      name: InfraConfigEnum.USER_HISTORY_STORE_ENABLED,
      value: ServiceStatus.ENABLE,
      isEncrypted: false,
    },
    {
      name: InfraConfigEnum.MOCK_SERVER_WILDCARD_DOMAIN,
      value: null,
      isEncrypted: false,
    },
  ];
  return infraConfigDefaultObjs;
}
/**
 * Get the missing entries in the 'infra_config' table
 * @returns Array of InfraConfig
 */
export async function getMissingInfraConfigEntries(
  infraConfigDefaultObjs: DefaultInfraConfig[],
) {
  const prisma = getSharedPrismaInstance();
  const dbInfraConfigs = await prisma.infraConfig.findMany();
  const missingEntries = infraConfigDefaultObjs.filter(
    (config) =>
      !dbInfraConfigs.some((dbConfig) => dbConfig.name === config.name),
  );
  return missingEntries;
}
/**
 * Determine if ALLOW_SECURE_COOKIES should be true or false
 * @returns boolean
 */
export function determineAllowSecureCookies(appBaseUrl: string) {
  return appBaseUrl.startsWith('https');
}
