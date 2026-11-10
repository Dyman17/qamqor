-- CreateEnum
CREATE TYPE "CollarControlMode" AS ENUM ('AUTO', 'GPS_MANUAL', 'MANUAL');

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "controlMode" "CollarControlMode" NOT NULL DEFAULT 'AUTO',
ADD COLUMN     "manualLatitude" DOUBLE PRECISION,
ADD COLUMN     "manualLongitude" DOUBLE PRECISION,
ADD COLUMN     "manualPositionAt" TIMESTAMP(3),
ADD COLUMN     "controlModeSince" TIMESTAMP(3),
ADD COLUMN     "controlActivityAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "device_commands" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveryCount" INTEGER NOT NULL DEFAULT 0;
