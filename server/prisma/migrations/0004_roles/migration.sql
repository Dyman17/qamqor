-- CreateEnum
CREATE TYPE "FarmRole" AS ENUM ('OWNER', 'WORKER');

-- CreateEnum
CREATE TYPE "SignalLevel" AS ENUM ('SOUND', 'VIBRATION', 'IMPULSE');

-- AlterTable
ALTER TABLE "users" DROP COLUMN "role";

-- AlterTable
ALTER TABLE "farms" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Aqtau',
ADD COLUMN     "workerCanEditBoundaries" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: keep existing memberships. Owners (FARM_OWNER, or the farm's ownerId) become OWNER,
-- every other member becomes WORKER.
ALTER TABLE "farm_members" ADD COLUMN "role_new" "FarmRole" NOT NULL DEFAULT 'WORKER';
UPDATE "farm_members" SET "role_new" = 'OWNER' WHERE "role"::text = 'FARM_OWNER';
UPDATE "farm_members" fm SET "role_new" = 'OWNER'
  FROM "farms" f WHERE f."id" = fm."farmId" AND f."ownerId" = fm."userId";
ALTER TABLE "farm_members" DROP COLUMN "role";
ALTER TABLE "farm_members" RENAME COLUMN "role_new" TO "role";

-- DropEnum
DROP TYPE "UserRole";

-- CreateTable
CREATE TABLE "signal_limits" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "level" "SignalLevel" NOT NULL,
    "dailyLimit" INTEGER,
    "unlimited" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signal_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "signal_limits_farmId_level_key" ON "signal_limits"("farmId", "level");

-- AddForeignKey
ALTER TABLE "signal_limits" ADD CONSTRAINT "signal_limits_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

