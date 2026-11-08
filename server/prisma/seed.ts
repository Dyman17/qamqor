import { PrismaClient, AnimalSpecies, AnimalGender, UserRole, DeviceStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run seed with NODE_ENV=production');
  }
  console.log('Seeding Qamqor initial data...');

  // 1. Create Default Farm Owner
  const ownerPassword = process.env.SEED_OWNER_PASSWORD || randomBytes(12).toString('base64url');
  if (!process.env.SEED_OWNER_PASSWORD) {
    console.log(`Generated owner password for farmer@qamqor.kz (shown once): ${ownerPassword}`);
  }
  const passwordHash = await bcrypt.hash(ownerPassword, 12);
  const user = await prisma.user.upsert({
    where: { email: 'farmer@qamqor.kz' },
    update: {},
    create: {
      email: 'farmer@qamqor.kz',
      passwordHash,
      fullName: 'Берік Қасымұлы',
      phone: '+7 777 123 4567',
      role: UserRole.FARM_OWNER,
    },
  });

  // 2. Create Farm
  let farm = await prisma.farm.findFirst({
    where: { ownerId: user.id },
  });

  if (!farm) {
    farm = await prisma.farm.create({
      data: {
        name: '«Ақбұлақ» шаруа қожалығы',
        description: 'Жылқы және түйе өсіретін отбасылық шаруашылық',
        ownerId: user.id,
      },
    });

    await prisma.farmMember.create({
      data: {
        userId: user.id,
        farmId: farm.id,
        role: UserRole.FARM_OWNER,
      },
    });
  }

  // 3. Create Pasture Geofence (Манғыстау даласы)
  // Polygon: 51.1500 to 51.1650 E, 43.6450 to 43.6550 N
  const pastureCoordinates = [
    [
      [51.1500, 43.6450],
      [51.1650, 43.6450],
      [51.1650, 43.6550],
      [51.1500, 43.6550],
      [51.1500, 43.6450],
    ],
  ];

  let geofence = await prisma.geofence.findFirst({
    where: { farmId: farm.id, name: '«Қарақия» негізгі жайлауы' },
  });

  if (!geofence) {
    geofence = await prisma.geofence.create({
      data: {
        farmId: farm.id,
        name: '«Қарақия» негізгі жайлауы',
        description: 'Негізгі жайылым аймағы, су көзі бар',
        color: '#10B981',
        polygonJson: {
          type: 'Polygon',
          coordinates: pastureCoordinates,
        },
      },
    });
  }

  // 4. Create Devices & Animals
  const initialAnimals = [
    {
      deviceId: 'QAM-0001',
      name: 'Ақтабан',
      tagNumber: 'KZ-CAMEL-001',
      species: AnimalSpecies.CAMEL,
      breed: 'Қосөркешті қазақ түйесі',
      gender: AnimalGender.MALE,
    },
    {
      deviceId: 'QAM-0002',
      name: 'Қарагер',
      tagNumber: 'KZ-HORSE-002',
      species: AnimalSpecies.HORSE,
      breed: 'Қазақы жабы',
      gender: AnimalGender.MALE,
    },
    {
      deviceId: 'QAM-0003',
      name: 'Мая',
      tagNumber: 'KZ-COW-003',
      species: AnimalSpecies.CATTLE,
      breed: 'Алатау сиыры',
      gender: AnimalGender.FEMALE,
    },
    {
      deviceId: 'QAM-0004',
      name: 'Ақбұйра',
      tagNumber: 'KZ-SHEEP-004',
      species: AnimalSpecies.SHEEP,
      breed: 'Еділбай қойы',
      gender: AnimalGender.FEMALE,
    },
  ];

  

  for (const item of initialAnimals) {
    // Upsert animal
    const animal = await prisma.animal.upsert({
      where: { tagNumber: item.tagNumber },
      update: {
        activeGeofenceId: geofence.id,
      },
      create: {
        farmId: farm.id,
        name: item.name,
        tagNumber: item.tagNumber,
        species: item.species,
        breed: item.breed,
        gender: item.gender,
        activeGeofenceId: geofence.id,
      },
    });

    // Upsert device
    await prisma.device.upsert({
      where: { deviceId: item.deviceId },
      update: {
        farmId: farm.id,
        animalId: animal.id,
        secretKey: randomBytes(32).toString('hex'),
        status: DeviceStatus.ONLINE,
      },
      create: {
        deviceId: item.deviceId,
        secretKey: randomBytes(32).toString('hex'),
        farmId: farm.id,
        animalId: animal.id,
        status: DeviceStatus.ONLINE,
        battery: 95,
      },
    });
  }

  console.log('✅ Seeding completed successfully!');
  console.log(`👤 Farmer: ${user.fullName} (${user.email})`);
  console.log(`🌾 Farm: ${farm.name}`);
  console.log(`📍 Geofence: ${geofence.name}`);
  console.log(`🐎 Animals & Collars: ${initialAnimals.length} initialized.`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

