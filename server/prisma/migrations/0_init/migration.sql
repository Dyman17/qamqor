-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'FARM_OWNER', 'FARM_MANAGER', 'VIEWER');

-- CreateEnum
CREATE TYPE "AnimalSpecies" AS ENUM ('HORSE', 'CAMEL', 'CATTLE', 'SHEEP', 'GOAT');

-- CreateEnum
CREATE TYPE "AnimalGender" AS ENUM ('MALE', 'FEMALE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ONLINE', 'OFFLINE', 'LOW_BATTERY', 'NO_GPS', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('GEOFENCE_BREACH', 'GEOFENCE_RETURN', 'LOW_BATTERY', 'DEVICE_OFFLINE', 'GPS_LOST', 'DEVICE_RESTORED');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'FARM_OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_members" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'FARM_MANAGER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "secretKey" TEXT NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'INACTIVE',
    "battery" INTEGER NOT NULL DEFAULT 100,
    "signal" INTEGER,
    "firmwareVersion" TEXT DEFAULT '1.0.0',
    "lastHeartbeatAt" TIMESTAMP(3),
    "farmId" TEXT,
    "animalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animals" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagNumber" TEXT NOT NULL,
    "species" "AnimalSpecies" NOT NULL,
    "gender" "AnimalGender" NOT NULL DEFAULT 'UNKNOWN',
    "breed" TEXT,
    "birthDate" TIMESTAMP(3),
    "photoUrl" TEXT,
    "activeGeofenceId" TEXT,
    "lastLatitude" DOUBLE PRECISION,
    "lastLongitude" DOUBLE PRECISION,
    "lastAccuracy" DOUBLE PRECISION,
    "lastSeenAt" TIMESTAMP(3),
    "isOutsideGeofence" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "animals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geofences" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#10B981',
    "polygonJson" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geofences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemetry" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "animalId" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "battery" INTEGER NOT NULL,
    "signal" INTEGER,
    "isOutsideGeofence" BOOLEAN NOT NULL DEFAULT false,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telemetry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "animalId" TEXT,
    "deviceId" TEXT,
    "type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "status" "AlertStatus" NOT NULL DEFAULT 'ACTIVE',
    "message" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "camera_snapshots" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "animalId" TEXT,
    "farmId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'MANUAL_REQUEST',
    "fileSize" INTEGER,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "camera_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_commands" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "farm_members_userId_farmId_key" ON "farm_members"("userId", "farmId");

-- CreateIndex
CREATE UNIQUE INDEX "devices_deviceId_key" ON "devices"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "devices_animalId_key" ON "devices"("animalId");

-- CreateIndex
CREATE UNIQUE INDEX "animals_tagNumber_key" ON "animals"("tagNumber");

-- CreateIndex
CREATE INDEX "telemetry_deviceId_timestamp_idx" ON "telemetry"("deviceId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "telemetry_animalId_timestamp_idx" ON "telemetry"("animalId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "alerts_farmId_status_idx" ON "alerts"("farmId", "status");

-- CreateIndex
CREATE INDEX "camera_snapshots_farmId_capturedAt_idx" ON "camera_snapshots"("farmId", "capturedAt" DESC);

-- CreateIndex
CREATE INDEX "camera_snapshots_animalId_capturedAt_idx" ON "camera_snapshots"("animalId", "capturedAt" DESC);

-- CreateIndex
CREATE INDEX "device_commands_deviceId_status_idx" ON "device_commands"("deviceId", "status");

-- AddForeignKey
ALTER TABLE "farms" ADD CONSTRAINT "farms_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_members" ADD CONSTRAINT "farm_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_members" ADD CONSTRAINT "farm_members_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_activeGeofenceId_fkey" FOREIGN KEY ("activeGeofenceId") REFERENCES "geofences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry" ADD CONSTRAINT "telemetry_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("deviceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry" ADD CONSTRAINT "telemetry_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("deviceId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camera_snapshots" ADD CONSTRAINT "camera_snapshots_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("deviceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camera_snapshots" ADD CONSTRAINT "camera_snapshots_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "animals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camera_snapshots" ADD CONSTRAINT "camera_snapshots_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("deviceId") ON DELETE CASCADE ON UPDATE CASCADE;

