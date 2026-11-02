# Qamqor Database Schema (PostgreSQL + PostGIS)

## Core Entities
1. **users**: System credentials, full name, role (FARM_OWNER, FARM_MANAGER, VIEWER, SUPER_ADMIN).
2. **farms**: Farm organizational unit, name, location, owner.
3. **farm_members**: Links users to farms with tenant isolation.
4. **animals**: Livestock details (species, tag number, name, gender, breed).
5. **devices**: Smart collars (deviceId, secretKey, battery, firmwareVersion, status).
6. **geofences**: Virtual pastures defined as PostGIS polygons (`geometry(Polygon, 4326)`).
7. **telemetry**: Append-only log of GPS pings, battery, signal, timestamp.
8. **alerts**: Incident records (geofence breaches, low battery, offline collars).

