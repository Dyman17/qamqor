-- Device secrets are no longer stored. Old plaintext secrets are invalidated:
-- existing rows get an unguessable hash, so their collars must be re-provisioned
-- (rotate-secret) before they can authenticate again.
ALTER TABLE "devices" ADD COLUMN "isSimulated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "devices" ADD COLUMN "secretHash" TEXT;
UPDATE "devices" SET "secretHash" = encode(sha256(convert_to(gen_random_uuid()::text || "id", 'UTF8')), 'hex');
ALTER TABLE "devices" ALTER COLUMN "secretHash" SET NOT NULL;
ALTER TABLE "devices" DROP COLUMN "secretKey";

CREATE UNIQUE INDEX "devices_secretHash_key" ON "devices"("secretHash");
