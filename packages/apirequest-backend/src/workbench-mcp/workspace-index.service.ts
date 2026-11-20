import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from 'src/prisma/prisma.service';

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

  async index(userUid: string) {
    const [collections, requests] = await Promise.all([
      this.prisma.userCollection.findMany({
        where: { userUid },
        orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
        select: {
          id: true, parentID: true, title: true, type: true, data: true,
          orderIndex: true, updatedOn: true,
        },
      }),
      // Project summaries in PostgreSQL: loading the complete JSON first would
      // retain the cost of reading and serializing every request body/example.
      this.prisma.$queryRaw<RequestSummary[]>`
        SELECT r.id, r."collectionID", r.title, r."orderIndex", r."updatedOn",
          d."_ref_id" AS "refID", d.method,
          COALESCE(d.endpoint, d.url) AS endpoint,
          (d.query IS NOT NULL AND d.url IS NOT NULL AND d.endpoint IS NULL) AS gql,
          COALESCE(d.responses <> '{}'::jsonb, false) AS "hasResponses"
        FROM "UserRequest" r
        CROSS JOIN LATERAL jsonb_to_record(r.request)
          AS d("_ref_id" text, method text, endpoint text, url text, query text, responses jsonb)
        WHERE r."userUid" = ${userUid}
        ORDER BY r."orderIndex", r.id
      `,
    ]);
    const data = { schemaVersion: 1, collections, requests };
    const revision = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    return { ...data, revision };
  }

  async request(userUid: string, id: string) {
    const rows = await this.requests(userUid, [id]);
    return rows[0];
  }

  async requests(userUid: string, ids: unknown) {
    if (!Array.isArray(ids) || ids.length > 10000 ||
        ids.some((id) => typeof id !== 'string' || !id || id.length > 200))
      throw new BadRequestException('Invalid request IDs');
    const unique = [...new Set(ids as string[])];
    if (!unique.length) return [];
    const rows = await this.prisma.userRequest.findMany({
      where: { userUid, id: { in: unique } },
      select: { id: true, title: true, collectionID: true, request: true, updatedOn: true },
    });
    if (rows.length !== unique.length) throw new NotFoundException('Request not found');
    return rows;
  }
}
