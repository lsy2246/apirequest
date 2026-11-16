-- 独立保存 MCP 审批和计划配置；value 由应用使用现有数据密钥加密。
CREATE TABLE "WorkbenchConfig" (
  "id" TEXT NOT NULL,
  "ownerUid" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdOn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedOn" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "WorkbenchConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkbenchConfig_ownerUid_fkey" FOREIGN KEY ("ownerUid") REFERENCES "User"("uid") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WorkbenchConfig_ownerUid_kind_idx" ON "WorkbenchConfig"("ownerUid", "kind");
