-- AlterTable
ALTER TABLE "alerts" ADD COLUMN     "dedupeKey" TEXT;


-- Existing data: keep only the newest ACTIVE alert per (animal, type); older duplicates are resolved.
UPDATE "alerts" a
SET "status" = 'RESOLVED', "resolvedAt" = NOW()
WHERE a."status" = 'ACTIVE'
  AND a."animalId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "alerts" b
    WHERE b."status" = 'ACTIVE'
      AND b."animalId" = a."animalId"
      AND b."type" = a."type"
      AND (b."createdAt" > a."createdAt" OR (b."createdAt" = a."createdAt" AND b."id" > a."id"))
  );

UPDATE "alerts"
SET "dedupeKey" = "type"::text || ':' || "animalId"
WHERE "status" = 'ACTIVE' AND "animalId" IS NOT NULL;

-- At most one ACTIVE alert per dedupeKey (partial unique index; not expressible in schema.prisma).
CREATE UNIQUE INDEX "alerts_active_dedupe_key" ON "alerts"("dedupeKey")
  WHERE "status" = 'ACTIVE' AND "dedupeKey" IS NOT NULL;
