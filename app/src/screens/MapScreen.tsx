import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme, Theme } from '../theme/scale';
import { Animal } from '../types';

export const MapScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const t = useTheme();
  const { colors, spacing, typography, sz, fs, hit } = t;
  const styles = useMemo(() => createStyles(t), [t]);
  const [selectedAnimal, setSelectedAnimal] = useState<Animal | null>(null);

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.topbar}>
        <TouchableOpacity style={styles.farmButton} hitSlop={hit(36)}>
          <Text style={styles.farmName}>Ферма Демо</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.connPill} hitSlop={hit(36)} onPress={() => navigation.navigate('Herd')}>
          <View style={styles.sdot} />
          <Text style={styles.connText}>138/142</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.gearButton} hitSlop={hit(48)} accessibilityLabel="Настройки" onPress={() => navigation.navigate('Settings')}>
          <Text style={{ color: colors.ink, fontSize: fs(18) }}>⚙</Text>
        </TouchableOpacity>
      </View>

      {/* Map Placeholder Canvas */}
      <View style={styles.mapCanvas}>
        <View style={styles.penNorthern}>
          <Text style={styles.penLabel}>Загон «Северный»</Text>
        </View>
        <View style={styles.penSouthern}>
          <Text style={styles.penLabel}>Загон «Южный»</Text>
        </View>

        {/* Demo Marker */}
        <TouchableOpacity
          style={[styles.marker, { top: '35%', left: '55%' }]}
          onPress={() => navigation.navigate('Profile', { animalId: '0142' })}
        >
          <View style={styles.markerInnerOut} />
          <Text style={styles.markerText}>142</Text>
        </TouchableOpacity>
      </View>

      {/* Floating Bottom Sheet */}
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.summaryRow}>
          <TouchableOpacity style={[styles.sumTile, styles.sumTileDanger]} onPress={() => navigation.navigate('Herd')}>
            <Text style={styles.tileNumber}>1</Text>
            <Text style={styles.tileLabel}>Вне зоны</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.sumTile} onPress={() => navigation.navigate('Herd')}>
            <Text style={styles.tileNumber}>2</Text>
            <Text style={styles.tileLabel}>Без границы</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.sumTile} onPress={() => navigation.navigate('Herd')}>
            <Text style={styles.tileNumber}>2</Text>
            <Text style={styles.tileLabel}>Нет связи</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity style={[styles.btn, styles.btnPrimary]}>
            <Text style={styles.btnPrimaryText}>+ Загон</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]}>
            <Text style={styles.btnSecondaryText}>Перегон стада</Text>
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
  marker: {
    position: 'absolute',
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
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
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

