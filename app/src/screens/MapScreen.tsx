import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { colors, spacing, radius, typography } from '../theme/tokens';
import { Animal } from '../types';

export const MapScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [selectedAnimal, setSelectedAnimal] = useState<Animal | null>(null);

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.topbar}>
        <TouchableOpacity style={styles.farmButton}>
          <Text style={styles.farmName}>Ферма Демо</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.connPill} onPress={() => navigation.navigate('Herd')}>
          <View style={styles.sdot} />
          <Text style={styles.connText}>138/142</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.gearButton} onPress={() => navigation.navigate('Settings')}>
          <Text style={{ color: colors.ink, fontSize: 18 }}>⚙</Text>
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

const styles = StyleSheet.create({
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
    fontSize: 14,
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
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.ok,
  },
  connText: {
    ...typography.caption,
    color: colors.ink,
    fontWeight: '600',
  },
  gearButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapCanvas: {
    flex: 1,
    backgroundColor: '#0a160e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  penNorthern: {
    position: 'absolute',
    top: '25%',
    left: '20%',
    width: 220,
    height: 140,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: 'rgba(188, 240, 111, 0.08)',
    borderRadius: radius.md,
    padding: spacing.xs,
  },
  penSouthern: {
    position: 'absolute',
    bottom: '25%',
    left: '30%',
    width: 200,
    height: 120,
    borderWidth: 1.5,
    borderColor: colors.ok,
    backgroundColor: 'rgba(34, 197, 94, 0.08)',
    borderRadius: radius.md,
    padding: spacing.xs,
  },
  penLabel: {
    ...typography.caption,
    color: colors.ink2,
  },
  marker: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerInnerOut: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.signal,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  markerText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.ink,
    marginTop: 2,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface1,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderColor: colors.borderSubtle,
    gap: spacing.md,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
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
    borderColor: colors.signal,
    borderWidth: 1,
  },
  tileNumber: {
    ...typography.title1,
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
    height: 48,
    borderRadius: radius.md,
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
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  btnSecondaryText: {
    ...typography.bodyL,
    color: colors.ink,
  },
});

