import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useTheme, Theme } from '../theme/scale';
import { api, errorText, timeAgo } from '../services/api';
import { useLoad } from '../state/useLoad';
import { StateBox, DemoBadge } from '../components';
import { AlertType } from '../types';

const TITLES: Record<AlertType, string> = {
  GEOFENCE_BREACH: 'Вышло за границу',
  GEOFENCE_RETURN: 'Вернулось в границу',
  DEVICE_OFFLINE: 'Нет связи с ошейником',
  DEVICE_RESTORED: 'Связь восстановлена',
  SIGNAL_LIMIT_REACHED: 'Достигнут лимит сигналов',
  GPS_LOST: 'Потеряно GPS',
};

export const AlertsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const t = useTheme();
  const { colors, spacing, typography, hit } = t;
  const styles = useMemo(() => createStyles(t), [t]);
  const alerts = useLoad(() => api.getAlerts(), navigation);
  const [actionError, setActionError] = useState<string | null>(null);

  const setStatus = async (id: string, status: 'ACKNOWLEDGED' | 'RESOLVED') => {
    try {
      setActionError(null);
      await api.setAlertStatus(id, status);
      alerts.reload();
    } catch (e) {
      setActionError(errorText(e));
    }
  };

  const items = alerts.data ?? [];

  return (
    <View style={styles.container}>
      <Text style={[typography.title1, styles.header]}>Оповещения</Text>
      {actionError && <Text style={[typography.caption, { color: colors.signal, marginBottom: spacing.sm }]}>{actionError}</Text>}

      <StateBox
        loading={alerts.loading && !alerts.data}
        error={alerts.error}
        empty={!alerts.loading && !alerts.error && items.length === 0 ? 'Оповещений нет' : null}
        onRetry={alerts.reload}
      />

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshing={alerts.loading && !!alerts.data}
        onRefresh={alerts.reload}
        renderItem={({ item }) => {
          const critical = item.severity === 'CRITICAL';
          const warning = item.severity === 'WARNING';
          return (
            <View style={[styles.card, critical && styles.cardDanger, warning && styles.cardWarning]}>
              <View style={styles.cardHeader}>
                <Text
                  style={[
                    typography.bodyL,
                    { flexShrink: 1, color: critical ? colors.signal : warning ? colors.warning : colors.ink },
                  ]}
                >
                  {TITLES[item.type] ?? item.type}
                </Text>
                {item.isDemo && <DemoBadge />}
                <Text style={styles.cardTime}>{timeAgo(item.createdAt)}</Text>
              </View>
              <Text style={[typography.body, { color: colors.ink, marginVertical: spacing.xs }]}>
                {[item.animalName, item.penName].filter(Boolean).join(' · ') || item.message}
              </Text>
              <View style={styles.actions}>
                {item.animalId && (
                  <TouchableOpacity
                    style={styles.btnSecondary}
                    hitSlop={hit(36)}
                    onPress={() => navigation.navigate('Profile', { animalId: item.animalId })}
                  >
                    <Text style={styles.btnText}>Профиль</Text>
                  </TouchableOpacity>
                )}
                {item.status === 'ACTIVE' && (
                  <TouchableOpacity style={styles.btnSecondary} hitSlop={hit(36)} onPress={() => setStatus(item.id, 'ACKNOWLEDGED')}>
                    <Text style={styles.btnText}>Принято</Text>
                  </TouchableOpacity>
                )}
                {item.status !== 'RESOLVED' && (
                  <TouchableOpacity style={styles.btnPrimary} hitSlop={hit(36)} onPress={() => setStatus(item.id, 'RESOLVED')}>
                    <Text style={styles.btnPrimaryText}>Закрыть</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        }}
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

