import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, LayoutChangeEvent, PanResponder, Pressable, ScrollView } from 'react-native';
import Svg, { Polygon, Text as SvgText } from 'react-native-svg';
import { Settings as SettingsIcon } from 'lucide-react-native';
import { useTheme, Theme } from '../theme/scale';
import { api, errorText } from '../services/api';
import { useLoad } from '../state/useLoad';
import { useSession } from '../state/session';
import { StateBox } from '../components';
import { Animal } from '../types';

const PAD = 36;
// default view when the farm has no pen and no positions: Aktau (assumption from the contract), ~600 x 400 m
const DEFAULT_CENTER = { lat: 43.65, lng: 51.157 };
const DEFAULT_HALF_LAT = 0.0018; // ~200 m
const DEFAULT_HALF_LNG = 0.0037; // ~300 m at this latitude

interface Proj {
  minLng: number;
  maxLat: number;
  kx: number;
  k: number;
  offX: number;
  offY: number;
}
const project = (p: Proj, lat: number, lng: number) => ({
  x: p.offX + (lng - p.minLng) * p.kx * p.k,
  y: p.offY + (p.maxLat - lat) * p.k,
});
const unproject = (p: Proj, x: number, y: number) => ({
  lat: p.maxLat - (y - p.offY) / p.k,
  lng: p.minLng + (x - p.offX) / (p.kx * p.k),
});

interface MarkerProps {
  x: number;
  y: number;
  label: string;
  fill: string;
  selected: boolean;
  draggable: boolean;
  maxX: number;
  maxY: number;
  onTap: () => void;
  onDrop: (x: number, y: number) => void;
  styles: ReturnType<typeof createStyles>;
  selectedColor: string;
  accessibilityLabel: string;
}

// A marker that follows the finger while dragged (PanResponder); a short touch is a tap.
const DraggableMarker: React.FC<MarkerProps> = (props) => {
  const { x, y, label, fill, selected, draggable, styles, selectedColor } = props;
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const live = useRef(props);
  live.current = props;
  const start = useRef({ x: 0, y: 0 });

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        start.current = { x: live.current.x, y: live.current.y };
      },
      onPanResponderMove: (_, g) => {
        if (live.current.draggable) setDrag({ x: start.current.x + g.dx, y: start.current.y + g.dy });
      },
      onPanResponderRelease: (_, g) => {
        const moved = Math.hypot(g.dx, g.dy) > 6;
        setDrag(null);
        if (live.current.draggable && moved) {
          const nx = Math.max(0, Math.min(live.current.maxX, start.current.x + g.dx));
          const ny = Math.max(0, Math.min(live.current.maxY, start.current.y + g.dy));
          live.current.onDrop(nx, ny);
        } else {
          live.current.onTap();
        }
      },
      onPanResponderTerminate: () => setDrag(null),
    }),
  ).current;

  const px = drag ? drag.x : x;
  const py = drag ? drag.y : y;
  return (
    <View
      {...pan.panHandlers}
      accessible
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      style={[styles.marker, { left: px - 22, top: py - 22 }, drag ? { zIndex: 5 } : null]}
    >
      <View
        style={[
          styles.markerInnerOut,
          { backgroundColor: fill },
          selected && { borderColor: selectedColor, borderWidth: 4 },
          draggable && drag && { transform: [{ scale: 1.4 }] },
        ]}
      />
      <Text style={styles.markerText} numberOfLines={1}>{label}</Text>
    </View>
  );
};

export const MapScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const t = useTheme();
  const { colors, typography, hit, fs, spacing } = t;
  const styles = useMemo(() => createStyles(t), [t]);
  const { farm, farmId, memberships, changeFarm, dataMode, isOwner } = useSession();
  const animals = useLoad(() => api.getAnimals(), navigation);
  const pens = useLoad(() => api.getGeofences(), navigation);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [override, setOverride] = useState<Record<string, { x: number; y: number }>>({});
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);

  const list = animals.data ?? [];
  const counts = {
    danger: list.filter((a) => a.status === 'danger').length,
    noPen: list.filter((a) => !a.penId).length,
    offline: list.filter((a) => a.status === 'offline').length,
  };
  const online = list.length - counts.offline;
  const pilot = dataMode === 'MANUAL' && isOwner;
  const unplaced = pilot ? list.filter((a) => a.isDemo && (a.lat == null || a.lng == null)) : [];
  const selected: Animal | undefined = list.find((a) => a.id === selectedId);

  const scene = useMemo(() => {
    if (box.w === 0 || !pens.data || !animals.data) return null;
    const penRings = pens.data.map((p) => {
      const ring = (p.polygon?.coordinates?.[0] ?? []).map(([lng, lat]) => ({ lat, lng }));
      return { id: p.id, name: p.name, isDemo: p.isDemo, ring };
    });
    const located = list.filter((a) => a.lat != null && a.lng != null);
    const penPts = penRings.flatMap((r) => r.ring);

    // In pilot mode the view is fixed to the pens (plus a margin) so markers do not jump after a drop.
    const pts: { lat: number; lng: number }[] = pilot && penPts.length > 0 ? [...penPts] : [...penPts];
    if (!(pilot && penPts.length > 0)) located.forEach((a) => pts.push({ lat: a.lat as number, lng: a.lng as number }));
    if (pts.length === 0) {
      pts.push(
        { lat: DEFAULT_CENTER.lat - DEFAULT_HALF_LAT, lng: DEFAULT_CENTER.lng - DEFAULT_HALF_LNG },
        { lat: DEFAULT_CENTER.lat + DEFAULT_HALF_LAT, lng: DEFAULT_CENTER.lng + DEFAULT_HALF_LNG },
      );
    }

    let minLat = Math.min(...pts.map((p) => p.lat));
    let maxLat = Math.max(...pts.map((p) => p.lat));
    let minLng = Math.min(...pts.map((p) => p.lng));
    let maxLng = Math.max(...pts.map((p) => p.lng));
    if (pilot) {
      // 35 % margin on every side: room to drag an animal outside the border
      const mLat = (maxLat - minLat || 1e-4) * 0.35;
      const mLng = (maxLng - minLng || 1e-4) * 0.35;
      minLat -= mLat; maxLat += mLat; minLng -= mLng; maxLng += mLng;
    }
    const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const spanX = Math.max((maxLng - minLng) * kx, 1e-5);
    const spanY = Math.max(maxLat - minLat, 1e-5);
    const k = Math.min((box.w - 2 * PAD) / spanX, (box.h - 2 * PAD) / spanY);
    const proj: Proj = { minLng, maxLat, kx, k, offX: (box.w - spanX * k) / 2, offY: (box.h - spanY * k) / 2 };

    return {
      proj,
      pens: penRings.map((r) => ({ ...r, xy: r.ring.map((q) => project(proj, q.lat, q.lng)) })),
      animals: located.map((a) => ({ a, ...project(proj, a.lat as number, a.lng as number) })),
      empty: penPts.length === 0 && located.length === 0,
    };
  }, [pens.data, animals.data, list, box.w, box.h, pilot]);

  const onLayout = (e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  // convert a screen point to lat/lng and send it as a demo telemetry ping
  const place = async (animalId: string, x: number, y: number) => {
    if (!scene || !farmId) return;
    const { lat, lng } = unproject(scene.proj, x, y);
    setOverride((o) => ({ ...o, [animalId]: { x, y } }));
    setNote(null);
    try {
      const r = await api.simTelemetry(farmId, { animalId, lat, lng });
      setNote({ text: `Позиция отправлена: зона ${r.zone}${r.sound ? ', звук' : ''}${r.vibrate ? ', вибрация' : ''}` });
      await animals.reload();
    } catch (e) {
      setNote({ text: errorText(e), error: true });
    } finally {
      setOverride((o) => {
        const { [animalId]: _drop, ...rest } = o;
        return rest;
      });
    }
  };

  const onCanvasPress = (e: any) => {
    if (!pilot || !selectedId) return;
    place(selectedId, e.nativeEvent.locationX, e.nativeEvent.locationY);
  };

  const markerFill = (a: Animal) =>
    a.status === 'danger' ? colors.signalMap : a.status === 'offline' ? colors.offline : a.status === 'warning' ? colors.warning : colors.okDot;

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
        <Pressable style={StyleSheet.absoluteFill} onPress={onCanvasPress} accessibilityLabel="Карта" />
        <Svg width={box.w} height={box.h} style={StyleSheet.absoluteFill} pointerEvents="none">
          {(scene?.pens ?? []).map((p) => (
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

        {(scene?.animals ?? []).map(({ a, x, y }) => {
          const o = override[a.id];
          const canDrag = pilot && a.isDemo;
          return (
            <DraggableMarker
              key={a.id}
              x={o ? o.x : x}
              y={o ? o.y : y}
              label={a.isDemo ? `${a.name} (демо)` : a.name}
              fill={markerFill(a)}
              selected={a.id === selectedId}
              draggable={canDrag}
              maxX={box.w}
              maxY={box.h}
              styles={styles}
              selectedColor={colors.signalMap}
              accessibilityLabel={canDrag ? `${a.name}, перетащите, чтобы переместить` : a.name}
              onTap={() => (canDrag ? setSelectedId(a.id === selectedId ? null : a.id) : navigation.navigate('Profile', { animalId: a.id }))}
              onDrop={(nx, ny) => {
                setSelectedId(a.id);
                place(a.id, nx, ny);
              }}
            />
          );
        })}

        <StateBox
          loading={(animals.loading && !animals.data) || (pens.loading && !pens.data)}
          error={animals.error || pens.error}
          onRetry={() => { animals.reload(); pens.reload(); }}
        />
        {!animals.loading && !animals.error && scene?.empty && !pilot && (
          <Text style={[typography.caption, { color: colors.mapLine }]}>Нет загонов и животных с координатами</Text>
        )}
        {pilot && (
          <Text style={[typography.caption, styles.hint]}>
            {selected ? `Выбрано: ${selected.name}. Коснитесь карты, чтобы поставить, или перетащите` : 'Перетащите животное'}
          </Text>
        )}
      </View>

      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        {pilot && (
          <View style={{ gap: spacing.sm }}>
            {unplaced.length > 0 && (
              <>
                <Text style={[typography.caption, { color: colors.ink2 }]}>Не на карте (коснитесь, затем коснитесь карты)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                  {unplaced.map((a) => (
                    <TouchableOpacity
                      key={a.id}
                      style={[styles.chip, a.id === selectedId && styles.chipActive]}
                      hitSlop={hit(36)}
                      onPress={() => setSelectedId(a.id === selectedId ? null : a.id)}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.chipText, a.id === selectedId && styles.chipTextActive]}>{a.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}
            <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
              <TouchableOpacity style={styles.btnSmall} hitSlop={hit(36)} onPress={() => navigation.navigate('AddAnimal')} accessibilityRole="button">
                <Text style={styles.btnSmallText}>+ Животное</Text>
              </TouchableOpacity>
              {selected && (
                <TouchableOpacity style={[styles.btnSmall, styles.btnSmallSecondary]} hitSlop={hit(36)} onPress={() => navigation.navigate('Profile', { animalId: selected.id })} accessibilityRole="button">
                  <Text style={[styles.btnSmallText, { color: colors.ink }]}>Профиль</Text>
                </TouchableOpacity>
              )}
            </View>
            {note && <Text style={[typography.caption, { color: note.error ? colors.signal : colors.ok }]}>{note.text}</Text>}
          </View>
        )}
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
  hint: { position: 'absolute', bottom: spacing.sm, left: spacing.lg, right: spacing.lg, color: colors.mapLine, textAlign: 'center' },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surface2 },
  chipActive: { backgroundColor: colors.primary },
  chipText: { ...typography.caption, color: colors.ink },
  chipTextActive: { color: colors.onPrimary, fontWeight: '700' },
  btnSmall: { minHeight: sizes.btnCompact, paddingHorizontal: spacing.md, backgroundColor: colors.primary, borderRadius: radius.sm, justifyContent: 'center' },
  btnSmallSecondary: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.borderSubtle },
  btnSmallText: { ...typography.caption, color: colors.onPrimary, fontWeight: '600' },
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

