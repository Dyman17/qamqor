import { DeviceTelemetryRequestDto, DeviceTelemetryResponseDto } from '@qamqor/contracts';

interface SimulatedCollar {
  deviceId: string;
  animalName: string;
  species: string;
  lat: number;
  lng: number;
  battery: number;
  direction: { lat: number; lng: number };
  willBreach: boolean;
}

const API_URL = process.env.API_URL || 'http://localhost:4000/api/v1/device/telemetry';
const DEVICE_SECRET = process.env.DEVICE_MASTER_SECRET || 'qamqor_esp32_device_shared_key_2026';

// Pasture Center in Kazakhstan (Almaty / Zhambyl steppe)
const collars: SimulatedCollar[] = [
  {
    deviceId: 'QAM-0001',
    animalName: 'Ақтабан',
    species: 'CAMEL',
    lat: 43.6501,
    lng: 51.1572,
    battery: 89,
    direction: { lat: 0.0001, lng: 0.0001 },
    willBreach: false,
  },
  {
    deviceId: 'QAM-0002',
    animalName: 'Қарагер',
    species: 'HORSE',
    lat: 43.6515,
    lng: 51.1585,
    battery: 94,
    direction: { lat: 0.0005, lng: 0.0004 }, // Walks towards boundary!
    willBreach: true,
  },
  {
    deviceId: 'QAM-0003',
    animalName: 'Мая',
    species: 'CATTLE',
    lat: 43.6495,
    lng: 51.1560,
    battery: 82,
    direction: { lat: -0.0001, lng: 0.0001 },
    willBreach: false,
  },
  {
    deviceId: 'QAM-0004',
    animalName: 'Ақбұйра',
    species: 'SHEEP',
    lat: 43.6488,
    lng: 51.1555,
    battery: 76,
    direction: { lat: 0.0001, lng: -0.0001 },
    willBreach: false,
  },
];

async function sendTelemetry(collar: SimulatedCollar) {
  // Move collar slightly
  collar.lat += collar.direction.lat + (Math.random() - 0.5) * 0.0001;
  collar.lng += collar.direction.lng + (Math.random() - 0.5) * 0.0001;
  collar.battery = Math.max(10, collar.battery - 0.01);

  const payload: DeviceTelemetryRequestDto = {
    deviceId: collar.deviceId,
    timestamp: new Date().toISOString(),
    latitude: parseFloat(collar.lat.toFixed(6)),
    longitude: parseFloat(collar.lng.toFixed(6)),
    accuracy: parseFloat((3 + Math.random() * 2).toFixed(1)),
    battery: Math.round(collar.battery),
    signal: Math.round(-65 - Math.random() * 20),
  };

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEVICE_SECRET}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`❌ [${collar.deviceId}] (${collar.animalName}) HTTP ${response.status}: ${errText}`);
      return;
    }

    const data = (await response.json()) as DeviceTelemetryResponseDto;
    console.log(
      `📡 [${collar.deviceId}] ${collar.animalName} (${collar.species}) -> Lat: ${payload.latitude}, Lng: ${payload.longitude} | Zone: ${data.zone || (data.inFence ? 'GREEN' : 'RED')} (${data.distanceToBorderMeters ?? '?'}m) | Sound: ${data.sound ? `${data.toneFrequencyHz ?? 0}Hz` : 'OFF'}, Vibe: ${data.vibrate}, Shock: ${data.shock}`,
    );
  } catch (error: any) {
    console.error(`⚠️ [${collar.deviceId}] Connection error: ${error.message}`);
  }
}

async function runSimulationLoop() {
  console.log('====================================================');
  console.log('🚀 QAMQOR ESP32 VIRTUAL COLLAR SIMULATOR STARTED');
  console.log(`Target API: ${API_URL}`);
  console.log(`Active Collars: ${collars.length}`);
  console.log('====================================================\n');

  // Initial tick
  for (const collar of collars) {
    await sendTelemetry(collar);
  }

  // Periodic ticks every 5 seconds
  setInterval(async () => {
    for (const collar of collars) {
      await sendTelemetry(collar);
    }
  }, 5000);
}

runSimulationLoop();

