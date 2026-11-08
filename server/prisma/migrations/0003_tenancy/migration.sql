-- DropIndex
DROP INDEX "animals_tagNumber_key";

-- CreateIndex
CREATE INDEX "devices_farmId_idx" ON "devices"("farmId");

-- CreateIndex
CREATE INDEX "animals_farmId_idx" ON "animals"("farmId");

-- CreateIndex
CREATE UNIQUE INDEX "animals_farmId_tagNumber_key" ON "animals"("farmId", "tagNumber");

-- CreateIndex
CREATE INDEX "geofences_farmId_idx" ON "geofences"("farmId");

