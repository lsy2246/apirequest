import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from 'src/generated/prisma/client';

type RequestSummary = {
  id: string;
  collectionID: string;
  title: string;
  orderIndex: number;
  updatedOn: Date;
  refID: string | null;
  method: string | null;
  endpoint: string | null;
  gql: boolean;
  hasResponses: boolean;
};

@Injectable()
export class WorkspaceIndexService {
  constructor(private readonly prisma: PrismaService) {}

  private async readRevision(
    db: Prisma.TransactionClient | PrismaService,
    userUid: string,
  ) {
    const rows = await db.$queryRaw<{ revision: string }[]>`
      SELECT "revision"::text AS revision
      FROM "WorkspaceIndexRevision"
      WHERE "userUid" = ${userUid}
    `;
    // Scope empty workspaces by owner; database UUIDs are shared by all server instances.
    const scope = createHash('sha256')
      .update(userUid)
      .digest('hex')
      .slice(0, 24);
    return `db3-${scope}-${rows[0]?.revision ?? '0'}`;
  }

  async revision(userUid: string) {
    return this.readRevision(this.prisma, userUid);
  }

  async index(userUid: string, lazy = false) {
    return this.prisma.$transaction(
      async (tx) => {
        // One snapshot keeps the revision and the rows it describes consistent.
        const revision = await this.readRevision(tx, userUid);
        const [collections, requests] = await Promise.all([
          tx.userCollection.findMany({
            where: { userUid },
            orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              parentID: true,
              title: true,
              type: true,
              data: true,
              orderIndex: true,
              updatedOn: true,
            },
          }),
          lazy
            ? Promise.resolve([] as RequestSummary[])
            : tx.$queryRaw<RequestSummary[]>`
          SELECT "id", "collectionID", "title", "orderIndex", "updatedOn",
                 "refID", "method", "endpoint", "gql", "hasResponses"
          FROM "UserRequestSummary"
          WHERE "userUid" = ${userUid}
          ORDER BY "orderIndex", "id"
        `,
        ]);
        return {
          schemaVersion: 1,
          collections,
          requests,
          revision: lazy ? `lazy-${revision}` : revision,
          ...(lazy ? { lazyRequests: true } : {}),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async folderRequests(
    userUid: string,
    collectionID: string,
    expectedRevision: string,
    cursorOrder?: number,
    cursorID?: string,
  ) {
    if (
      !collectionID ||
      collectionID.length > 200 ||
      !expectedRevision ||
      expectedRevision.length > 200 ||
      (cursorOrder === undefined) !== (cursorID === undefined) ||
      (cursorOrder !== undefined &&
        (!Number.isSafeInteger(cursorOrder) ||
          !cursorID ||
          cursorID.length > 200))
    )
      throw new BadRequestException('Invalid collection page');
    return this.prisma.$transaction(
      async (tx) => {
        const revision = `lazy-${await this.readRevision(tx, userUid)}`;
        if (revision !== expectedRevision)
          throw new ConflictException('Workspace index changed');
        const cursor =
          cursorOrder === undefined
            ? Prisma.empty
            : Prisma.sql`AND ("orderIndex", "id") > (${cursorOrder}, ${cursorID})`;
        const rows = await tx.$queryRaw<RequestSummary[]>`
        SELECT "id", "collectionID", "title", "orderIndex", "updatedOn",
               "refID", "method", "endpoint", "gql", "hasResponses"
        FROM "UserRequestSummary"
        WHERE "userUid" = ${userUid} AND "collectionID" = ${collectionID} ${cursor}
        ORDER BY "orderIndex", "id" LIMIT 201
      `;
        const page = rows.slice(0, 200);
        const last = page[page.length - 1];
        return {
          revision,
          requests: page,
          nextCursor:
            rows.length > 200
              ? { orderIndex: last.orderIndex, id: last.id }
              : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async searchRequests(userUid: string, value: unknown) {
    if (typeof value !== 'string' || value.length > 100)
      throw new BadRequestException('Invalid search text');
    const text = value.trim();
    if (!text) return [];
    const pattern = `%${text.replace(/[\\%_]/g, '\\$&')}%`;
    return this.prisma.$queryRaw<RequestSummary[]>`
      SELECT "id", "collectionID", "title", "orderIndex", "updatedOn",
             "refID", "method", "endpoint", "gql", "hasResponses"
      FROM "UserRequestSummary"
      WHERE "userUid" = ${userUid} AND
        ("title" ILIKE ${pattern} OR "endpoint" ILIKE ${pattern})
      ORDER BY ("title" ILIKE ${pattern}) DESC, "title", "id" LIMIT 20
    `;
  }

  async request(userUid: string, id: string) {
    const rows = await this.requests(userUid, [id]);
    return rows[0];
  }

  async requests(userUid: string, ids: unknown) {
    if (
      !Array.isArray(ids) ||
      ids.some((id) => typeof id !== 'string' || !id || id.length > 200)
    )
      throw new BadRequestException('Invalid request IDs');
    const unique = [...new Set(ids as string[])];
    const select = {
      id: true,
      title: true,
      collectionID: true,
      request: true,
      updatedOn: true,
    } as const;
    const rows: Prisma.UserRequestGetPayload<{ select: typeof select }>[] = [];
    // Split SQL queries to stay below the database's bind parameter limit.
    const querySize = 10000;
    for (let start = 0; start < unique.length; start += querySize) {
      const batch = unique.slice(start, start + querySize);
      const found = await this.prisma.userRequest.findMany({
        where: { userUid, id: { in: batch } },
        select,
      });
      if (found.length !== batch.length)
        throw new NotFoundException('Request not found');
      rows.push(...found);
    }
    return rows;
  }
}
