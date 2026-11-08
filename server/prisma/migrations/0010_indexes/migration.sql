-- CreateIndex
CREATE INDEX "alerts_farmId_createdAt_idx" ON "alerts"("farmId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "alerts_animalId_type_status_idx" ON "alerts"("animalId", "type", "status");

