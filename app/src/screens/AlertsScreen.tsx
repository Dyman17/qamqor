import React, { useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useTheme, Theme } from '../theme/scale';

const ALERTS = [
  {
    id: '1',
    title: 'Вышло за забор',
    sub: 'Корова #0142 · Загон «Северный»',
    time: '5 мин назад',
    type: 'danger',
  },
  {
    id: '2',
    title: 'Нет связи',
    sub: 'Корова #0231 · Бирка DEMO-A31',
    time: '12 мин назад',
    type: 'offline',
  },
  {
    id: '3',
    title: 'Ошейники вне зоны Wi-Fi',
    sub: 'Корова #0410, #0415 (2 животных)',
    time: '25 мин назад',
    type: 'warning',
  },
];

export const AlertsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const t = useTheme();
  const { colors, spacing, typography, sz, fs, hit } = t;
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <View style={styles.container}>
      <Text style={[typography.title1, styles.header]}>Оповещения</Text>

      <FlatList
        data={ALERTS}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View
            style={[
              styles.card,
              item.type === 'danger' && styles.cardDanger,
              item.type === 'warning' && styles.cardWarning,
            ]}
          >
            <View style={styles.cardHeader}>
              <Text
                style={[
                  typography.bodyL,
                  {
                    flexShrink: 1,
                    color:
                      item.type === 'danger'
                        ? colors.signal
                        : item.type === 'warning'
                        ? colors.warning
                        : colors.ink,
                  },
                ]}
              >
                {item.title}
              </Text>
              <Text style={styles.cardTime}>{item.time}</Text>
            </View>
            <Text style={[typography.body, { color: colors.ink, marginVertical: spacing.xs }]}>
              {item.sub}
            </Text>
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.btnSecondary}
                hitSlop={hit(36)}
                onPress={() => navigation.navigate('Map')}
              >
                <Text style={styles.btnText}>На карте</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btnPrimary}
                hitSlop={hit(36)}
                onPress={() => navigation.navigate('Profile', { animalId: '0142' })}
              >
                <Text style={styles.btnPrimaryText}>Профиль</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
    </View>
  );
};

const createStyles = ({ colors, spacing, radius, typography, sizes, sz, fs, lh, hairline }: Theme) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface0,
    paddingTop: 54,
    paddingHorizontal: spacing.lg,
  },
  header: {
    marginBottom: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.md,
  },
  cardDanger: {
    borderLeftWidth: sz(4),
    borderLeftColor: colors.signal,
  },
  cardWarning: {
    borderLeftWidth: sz(4),
    borderLeftColor: colors.warning,
  },
  cardHeader: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTime: {
    ...typography.caption,
    color: colors.ink3,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  btnSecondary: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface2,
    borderRadius: radius.sm,
  },
  btnPrimary: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
  },
  btnText: {
    ...typography.caption,
    color: colors.ink,
  },
  btnPrimaryText: {
    ...typography.caption,
    color: colors.onPrimary,
    fontWeight: '700',
  },
});

