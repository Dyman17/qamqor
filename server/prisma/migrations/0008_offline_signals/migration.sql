-- AlterEnum
ALTER TYPE "AlertType" ADD VALUE 'SIGNAL_LIMIT_REACHED';

-- CreateTable
CREATE TABLE "signal_events" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "deviceId" TEXT,
    "level" "SignalLevel" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signal_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signal_events_farmId_animalId_at_idx" ON "signal_events"("farmId", "animalId", "at");

-- CreateIndex
CREATE INDEX "signal_events_animalId_level_at_idx" ON "signal_events"("animalId", "level", "at");

-- AddForeignKey
ALTER TABLE "signal_events" ADD CONSTRAINT "signal_events_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signal_events" ADD CONSTRAINT "signal_events_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

