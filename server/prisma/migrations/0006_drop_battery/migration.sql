-- Data first (safe on a database with rows): the removed enum values must not be in use.
-- Battery alerts are meaningless without a charge sensor and are deleted; collars that were
-- LOW_BATTERY are simply ONLINE (connectivity is derived from the last ping from now on).
DELETE FROM "alerts" WHERE "type"::text = 'LOW_BATTERY';
UPDATE "devices" SET "status" = 'ONLINE' WHERE "status"::text = 'LOW_BATTERY';

-- AlterEnum
BEGIN;
CREATE TYPE "DeviceStatus_new" AS ENUM ('ONLINE', 'OFFLINE', 'NO_GPS', 'INACTIVE');
ALTER TABLE "devices" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "devices" ALTER COLUMN "status" TYPE "DeviceStatus_new" USING ("status"::text::"DeviceStatus_new");
ALTER TYPE "DeviceStatus" RENAME TO "DeviceStatus_old";
ALTER TYPE "DeviceStatus_new" RENAME TO "DeviceStatus";
DROP TYPE "DeviceStatus_old";
ALTER TABLE "devices" ALTER COLUMN "status" SET DEFAULT 'INACTIVE';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "AlertType_new" AS ENUM ('GEOFENCE_BREACH', 'GEOFENCE_RETURN', 'DEVICE_OFFLINE', 'GPS_LOST', 'DEVICE_RESTORED');
ALTER TABLE "alerts" ALTER COLUMN "type" TYPE "AlertType_new" USING ("type"::text::"AlertType_new");
ALTER TYPE "AlertType" RENAME TO "AlertType_old";
ALTER TYPE "AlertType_new" RENAME TO "AlertType";
DROP TYPE "AlertType_old";
COMMIT;

-- AlterTable
ALTER TABLE "devices" DROP COLUMN "battery";

-- AlterTable
ALTER TABLE "telemetry" DROP COLUMN "battery";

