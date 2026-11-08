-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "devices_code_key" ON "devices"("code");

