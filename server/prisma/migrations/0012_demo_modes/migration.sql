-- CreateEnum
CREATE TYPE "DataMode" AS ENUM ('REAL', 'MANUAL', 'AUTO');

-- AlterTable
ALTER TABLE "farms" ADD COLUMN     "dataMode" "DataMode" NOT NULL DEFAULT 'REAL',
ADD COLUMN     "simHerd" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "simLeaseUntil" TIMESTAMP(3),
ADD COLUMN     "simSpeed" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "simUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "animals" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "geofences" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "alerts" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

