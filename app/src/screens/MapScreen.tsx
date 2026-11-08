import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, LayoutChangeEvent } from 'react-native';
import Svg, { Polygon, Text as SvgText } from 'react-native-svg';
import { Settings as SettingsIcon } from 'lucide-react-native';
import { useTheme, Theme } from '../theme/scale';
import { api } from '../services/api';
import { useLoad } from '../state/useLoad';
import { useSession } from '../state/session';
import { StateBox } from '../components';

const PAD = 36;

// NOTE: no tile/satellite map SDK is installed. Pens (GeoJSON polygons) and animals are drawn on a
// plain canvas with an equirectangular projection fitted to their combined lat/lng bounds.
export const MapScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const t = useTheme();
  const { colors, typography, hit, fs } = t;
  const styles = useMemo(() => createStyles(t), [t]);
  const { farm, memberships, changeFarm } = useSession();
  const animals = useLoad(() => api.getAnimals(), navigation);
  const pens = useLoad(() => api.getGeofences(), navigation);
  const [box, setBox] = useState({ w: 0, h: 0 });

  const list = animals.data ?? [];
  const counts = {
    danger: list.filter((a) => a.status === 'danger').length,
    noPen: list.filter((a) => !a.penId).length,
    offline: list.filter((a) => a.status === 'offline').length,
  };
  const online = list.length - counts.offline;

  const scene = useMemo(() => {
    const pts: { lat: number; lng: number }[] = [];
    const penRings = (pens.data ?? []).map((p) => {
      const ring = (p.polygon?.coordinates?.[0] ?? []).map(([lng, lat]) => ({ lat, lng }));
      pts.push(...ring);
      return { id: p.id, name: p.name, isDemo: p.isDemo, ring };
    });
    const located = list.filter((a) => a.lat != null && a.lng != null);
    located.forEach((a) => pts.push({ lat: a.lat as number, lng: a.lng as number }));
    if (pts.length === 0 || box.w === 0) return { pens: [], animals: [] as any[], empty: pts.length === 0 };

    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const spanX = Math.max((maxLng - minLng) * kx, 1e-5);
    const spanY = Math.max(maxLat - minLat, 1e-5);
    const k = Math.min((box.w - 2 * PAD) / spanX, (box.h - 2 * PAD) / spanY);
    const offX = (box.w - spanX * k) / 2;
    const offY = (box.h - spanY * k) / 2;
    const proj = (p: { lat: number; lng: number }) => ({
      x: offX + (p.lng - minLng) * kx * k,
      y: offY + (maxLat - p.lat) * k,
    });
    return {
      empty: false,
      pens: penRings.map((r) => ({ ...r, xy: r.ring.map(proj) })),
      animals: located.map((a) => ({ a, ...proj({ lat: a.lat as number, lng: a.lng as number }) })),
    };
  }, [pens.data, list, box.w, box.h]);

  const onLayout = (e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <TouchableOpacity
          style={styles.farmButton}
          hitSlop={hit(36)}
          disabled={memberships.length < 2}
          onPress={changeFarm}
          accessibilityLabel="Сменить ферму"
        >
          <Text style={styles.farmName} numberOfLines={1}>{farm?.farmName ?? 'Ферма'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.connPill} hitSlop={hit(36)} onPress={() => navigation.navigate('Herd')}>
          <View style={styles.sdot} />
          <Text style={styles.connText}>{online}/{list.length}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.gearButton} hitSlop={hit(48)} accessibilityLabel="Настройки" onPress={() => navigation.navigate('Settings')}>
          <SettingsIcon color={colors.ink} size={fs(18)} />
        </TouchableOpacity>
      </View>

      <View style={styles.mapCanvas} onLayout={onLayout}>
        <Svg width={box.w} height={box.h} style={StyleSheet.absoluteFill}>
          {scene.pens.map((p) => (
            <React.Fragment key={p.id}>
              <Polygon
                points={p.xy.map((q) => `${q.x},${q.y}`).join(' ')}
                fill={colors.mapFillActive}
                stroke={colors.mapLine}
                strokeWidth={1.5}
              />
              {p.xy.length > 0 && (
                <SvgText x={p.xy[0].x + 4} y={p.xy[0].y - 6} fill={colors.mapLine} fontSize={fs(11)}>
                  {p.isDemo ? `${p.name} (демо)` : p.name}
                </SvgText>
              )}
            </React.Fragment>
          ))}
        </Svg>

        {scene.animals.map(({ a, x, y }: any) => (
          <TouchableOpacity
            key={a.id}
            style={[styles.marker, { left: x - 22, top: y - 22 }]}
            hitSlop={hit(44)}
            accessibilityLabel={`${a.name}`}
            onPress={() => navigation.navigate('Profile', { animalId: a.id })}
          >
            <View
              style={[
                styles.markerInnerOut,
                a.status === 'ok' && { backgroundColor: colors.okDot },
                a.status === 'offline' && { backgroundColor: colors.offline },
              ]}
            />
            <Text style={styles.markerText} numberOfLines={1}>{a.isDemo ? `${a.name} (демо)` : a.name}</Text>
          </TouchableOpacity>
        ))}

        <StateBox loading={(animals.loading && !animals.data) || (pens.loading && !pens.data)} error={animals.error || pens.error} onRetry={() => { animals.reload(); pens.reload(); }} />
        {!animals.loading && !animals.error && scene.empty && (
          <Text style={[typography.caption, { color: colors.mapLine }]}>Нет загонов и животных с координатами</Text>
        )}
      </View>

      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.summaryRow}>
          <TouchableOpacity style={[styles.sumTile, styles.sumTileDanger]} onPress={() => navigation.navigate('Herd')}>
            <Text style={styles.tileNumber}>{counts.danger}</Text>
            <Text style={styles.tileLabel}>Вне зоны</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.sumTile} onPress={() => navigation.navigate('Herd')}>
            <Text style={styles.tileNumber}>{counts.noPen}</Text>
            <Text style={styles.tileLabel}>Без границы</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.sumTile} onPress={() => navigation.navigate('Herd')}>
            <Text style={styles.tileNumber}>{counts.offline}</Text>
            <Text style={styles.tileLabel}>Нет связи</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const createStyles = ({ colors, spacing, radius, typography, sizes, sz, fs, lh, hairline }: Theme) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  topbar: {
    position: 'absolute',
    top: 50,
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  farmButton: {
    backgroundColor: colors.surfaceGlass,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  farmName: {
    ...typography.bodyL,
    fontSize: fs(14),
  },
  connPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    gap: spacing.xs,
  },
  sdot: {
    width: sz(8),
    height: sz(8),
    borderRadius: sz(4),
    backgroundColor: colors.okDot,
  },
  connText: {
    ...typography.caption,
    color: colors.ink,
    fontWeight: '600',
  },
  gearButton: {
    width: sizes.fab,
    height: sizes.fab,
    borderRadius: sizes.fab / 2,
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapCanvas: {
    flex: 1,
    backgroundColor: colors.markerCasing,
    justifyContent: 'center',
    alignItems: 'center',
  },
  penNorthern: {
    position: 'absolute',
    top: '25%',
    left: '20%',
    width: sz(220),
    height: sz(140),
    borderWidth: 1.5,
    borderColor: colors.mapLine,
    backgroundColor: colors.mapFill,
    borderRadius: radius.md,
    padding: spacing.xs,
  },
  penSouthern: {
    position: 'absolute',
    bottom: '25%',
    left: '30%',
    width: sz(200),
    height: sz(120),
    borderWidth: 1.5,
    borderColor: colors.mapLine,
    backgroundColor: colors.mapFillActive,
    borderRadius: radius.md,
    padding: spacing.xs,
  },
  penLabel: {
    ...typography.caption,
    color: colors.mapLine,
  },
  penLegend: { position: 'absolute', top: 100, left: spacing.lg, right: spacing.lg, color: colors.mapLine },
  marker: {
    position: 'absolute',
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerInnerOut: {
    width: sz(16),
    height: sz(16),
    borderRadius: sz(8),
    backgroundColor: colors.signalMap,
    borderWidth: 2.5,
    borderColor: colors.mapLine,
  },
  markerText: {
    ...typography.caption,
    fontSize: fs(11),
    color: colors.mapLine,
    marginTop: sz(2),
  },
  sheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderColor: colors.borderSubtle,
    gap: spacing.md,
  },
  sheetHandle: {
    width: sz(36),
    height: sz(4),
    borderRadius: sz(2),
    backgroundColor: colors.ink3,
    alignSelf: 'center',
    marginBottom: spacing.xs,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sumTile: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  sumTileDanger: {
    backgroundColor: colors.surface2White,
  },
  tileNumber: {
    ...typography.display,
    color: colors.primary,
  },
  tileLabel: {
    ...typography.caption,
    color: colors.ink2,
    marginTop: spacing.xs,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  btn: {
    flex: 1,
    minHeight: sizes.btn,
    borderRadius: radius.btn,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: {
    backgroundColor: colors.primary,
  },
  btnPrimaryText: {
    ...typography.bodyL,
    color: colors.onPrimary,
  },
  btnSecondary: {
    backgroundColor: colors.surface2,
  },
  btnSecondaryText: {
    ...typography.bodyL,
    color: colors.ink,
  },
});

