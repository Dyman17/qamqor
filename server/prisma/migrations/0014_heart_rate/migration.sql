-- AlterTable
ALTER TABLE "animals" ADD COLUMN     "lastHeartRate" INTEGER,
ADD COLUMN     "lastHeartRateAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "telemetry" ADD COLUMN     "heartRate" INTEGER,
ADD COLUMN     "satellites" INTEGER,
ALTER COLUMN "latitude" DROP NOT NULL,
ALTER COLUMN "longitude" DROP NOT NULL,
ALTER COLUMN "accuracy" DROP NOT NULL;

