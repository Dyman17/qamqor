import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { colors, spacing, radius, typography } from '../theme/tokens';

const COLLARS = [
  { id: 'QAM-0001', animal: 'Корова #0142', status: 'ONLINE', signal: -68, gps: 4.5 },
  { id: 'QAM-0002', animal: 'Корова #0087', status: 'ONLINE', signal: -72, gps: 3.2 },
  { id: 'QAM-0003', animal: 'Не привязан (Свободен)', status: 'FREE', signal: -80, gps: 5.0 },
  { id: 'QAM-0004', animal: 'Корова #0231', status: 'OFFLINE', signal: -92, gps: 12.0 },
];

export const CollarsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={typography.title1}>Ошейники (145)</Text>
        <TouchableOpacity style={styles.btnAdd}>
          <Text style={styles.btnAddText}>+ Добавить</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={COLLARS}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Text style={[typography.bodyL, typography.tabular]}>{item.id}</Text>
                <View
                  style={[
                    styles.badge,
                    item.status === 'ONLINE'
                      ? styles.badgeOk
                      : item.status === 'FREE'
                      ? styles.badgeFree
                      : styles.badgeOff,
                  ]}
                >
                  <Text style={styles.badgeText}>{item.status}</Text>
                </View>
              </View>
              <Text style={styles.subText}>{item.animal}</Text>
            </View>

            <TouchableOpacity
              style={styles.btnAction}
              onPress={() => navigation.navigate('Profile', { animalId: '0142' })}
            >
              <Text style={styles.btnActionText}>
                {item.status === 'FREE' ? 'Привязать' : 'Профиль'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface0,
    paddingTop: 54,
    paddingHorizontal: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  btnAdd: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  btnAddText: {
    ...typography.caption,
    color: colors.onPrimary,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  badgeOk: {
    backgroundColor: 'rgba(56, 224, 120, 0.2)',
  },
  badgeFree: {
    backgroundColor: 'rgba(188, 240, 111, 0.2)',
  },
  badgeOff: {
    backgroundColor: 'rgba(148, 163, 184, 0.2)',
  },
  badgeText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '700',
    color: colors.ink,
  },
  subText: {
    ...typography.caption,
    color: colors.ink2,
    marginTop: spacing.xs,
  },
  btnAction: {
    backgroundColor: colors.surface2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  btnActionText: {
    ...typography.caption,
    color: colors.ink,
  },
});

