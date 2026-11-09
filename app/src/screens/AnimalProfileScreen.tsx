import { ArrowLeft } from 'phosphor-react-native/lib/module/icons/ArrowLeft';
import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme, Theme } from '../theme/scale';
import { api, errorText, timeAgo } from '../services/api';
import { useLoad } from '../state/useLoad';
import { StateBox, STATUS_LABEL, CONN_LABEL, DemoBadge } from '../components';

export const AnimalProfileScreen: React.FC<{ route: any; navigation: any }> = ({ route, navigation }) => {
  const t = useTheme();
  const { colors, spacing, typography, hit, fs } = t;
  const styles = useMemo(() => createStyles(t), [t]);
  const animalId: string = route?.params?.animalId;
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const animal = useLoad(() => api.getAnimal(animalId), navigation);
  const collars = useLoad(() => api.getCollars(), navigation);
  const pens = useLoad(() => api.getGeofences(), navigation);

  const a = animal.data;
  const collar = a?.collarId ? collars.data?.find((c) => c.deviceId === a.collarId) : undefined;
  const penName = a?.penId ? pens.data?.find((p) => p.id === a.penId)?.name ?? 'Загон' : 'Без границы';
  const freeCollars = (collars.data ?? []).filter((c) => c.status === 'UNASSIGNED');

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setFeedback(null);
    try {
      setFeedback({ text: await fn() });
    } catch (e) {
      setFeedback({ text: errorText(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  const sendTest = (signal: 'SOUND' | 'VIBRATION') =>
    run(async () => {
      await api.testSignal(a!.collarId!, signal);
      return 'Команда поставлена в очередь. Ошейник выполнит её при следующем выходе на связь.';
    });

  const assign = (deviceId: string | null) =>
    run(async () => {
      if (deviceId) await api.assignCollar(deviceId, a!.id);
      else await api.assignCollar(a!.collarId!, null);
      animal.reload();
      collars.reload();
      return deviceId ? 'Ошейник привязан' : 'Ошейник отвязан';
    });

  return (
    <ScrollView style={styles.container}>
      <TouchableOpacity style={styles.backButton} hitSlop={hit(36)} onPress={() => navigation.goBack()}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <ArrowLeft color={colors.primary} size={fs(18)} weight="regular" />
          <Text style={styles.backText}>Назад к списку</Text>
        </View>
      </TouchableOpacity>

      <StateBox loading={animal.loading && !a} error={animal.error} onRetry={animal.reload} />

      {a && (
        <>
          <View style={styles.card}>
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Text style={[typography.title1, { flexShrink: 1 }]}>{a.name}</Text>
                  {a.isDemo && <DemoBadge />}
                </View>
                <Text style={[typography.caption, { color: colors.ink2 }]}>
                  {a.breed ? `${a.breed} · ` : ''}Бирка {a.tag}
                </Text>
              </View>
              <View style={styles.badgeDanger}>
                <Text style={[styles.badgeText, a.status === 'ok' && { color: colors.ok }]}>{STATUS_LABEL[a.status]}</Text>
              </View>
            </View>

            <View style={styles.grid}>
              <View style={styles.gridItem}>
                <Text style={styles.gridLabel}>Текущий загон</Text>
                <Text style={styles.gridVal}>{penName}</Text>
              </View>
              <View style={styles.gridItem}>
                <Text style={styles.gridLabel}>Ошейник</Text>
                <Text style={styles.gridVal}>
                  {a.collarId ? `${a.collarId}${collar ? ` (${CONN_LABEL[collar.status]})` : ''}` : 'Не привязан'}
                </Text>
              </View>
              <View style={styles.gridItem}>
                <Text style={styles.gridLabel}>Координаты</Text>
                <Text style={styles.gridVal}>
                  {a.lat != null && a.lng != null ? `${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}` : 'нет данных'}
                </Text>
              </View>
              <View style={styles.gridItem}>
                <Text style={styles.gridLabel}>Связь</Text>
                <Text style={styles.gridVal}>{timeAgo(a.lastSeenAt)}</Text>
              </View>
            </View>

            {a.collarId && (
              <TouchableOpacity style={styles.btnMap} hitSlop={hit(44)} disabled={busy} onPress={() => assign(null)}>
                <Text style={styles.btnMapText}>Отвязать ошейник</Text>
              </TouchableOpacity>
            )}
          </View>

          {!a.collarId && (
            <View style={styles.panel}>
              <Text style={typography.title2}>Привязать ошейник</Text>
              {freeCollars.length === 0 ? (
                <Text style={[typography.caption, { color: colors.ink2, marginTop: spacing.xs }]}>
                  Свободных ошейников нет. Владелец добавляет ошейник по коду на вкладке «Ошейники».
                </Text>
              ) : (
                <View style={[styles.triggerList, { marginTop: spacing.sm }]}>
                  {freeCollars.map((c) => (
                    <View key={c.deviceId} style={styles.triggerItem}>
                      <Text style={[styles.triggerTitle, { flex: 1 }]}>{c.deviceId}</Text>
                      <TouchableOpacity style={styles.triggerActionBtn} hitSlop={hit(36)} disabled={busy} onPress={() => assign(c.deviceId)}>
                        <Text style={styles.triggerActionText}>Привязать</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <Text style={typography.title2}>Тест ошейника</Text>
            </View>
            <Text style={[typography.caption, { color: colors.ink2, marginBottom: spacing.md }]}>
              Тестовый сигнал ставится в очередь на сервере. Ошейник получит его при следующем выходе на связь.
            </Text>

            {a.collarId ? (
              <View style={styles.triggerList}>
                <View style={styles.triggerItem}>
                  <View style={styles.triggerInfo}>
                    <Text style={styles.triggerTitle}>Звуковой сигнал</Text>
                  </View>
                  <TouchableOpacity style={styles.triggerActionBtn} hitSlop={hit(36)} disabled={busy} onPress={() => sendTest('SOUND')}>
                    <Text style={styles.triggerActionText}>Тест звука</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.triggerItem}>
                  <View style={styles.triggerInfo}>
                    <Text style={styles.triggerTitle}>Вибромотор</Text>
                  </View>
                  <TouchableOpacity style={styles.triggerActionBtn} hitSlop={hit(36)} disabled={busy} onPress={() => sendTest('VIBRATION')}>
                    <Text style={styles.triggerActionText}>Тест вибро</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <Text style={[typography.caption, { color: colors.ink2 }]}>Привяжите ошейник, чтобы отправить тестовый сигнал.</Text>
            )}
          </View>
        </>
      )}

      {feedback && (
        <View style={[styles.feedbackBox, { marginBottom: spacing.x10 }, feedback.error && { borderLeftColor: colors.signal }]}>
          <Text style={[styles.feedbackText, feedback.error && { color: colors.signal }]}>{feedback.text}</Text>
        </View>
      )}
      <View style={{ height: spacing.x10 }} />
    </ScrollView>
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
  backButton: {
    marginBottom: spacing.md,
  },
  backText: {
    ...typography.body,
    color: colors.primary,
  },
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badgeDanger: {
    backgroundColor: colors.surface2,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  badgeText: {
    ...typography.caption,
    color: colors.signal,
    fontWeight: '700',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  gridItem: {
    width: '48%',
    backgroundColor: colors.surface0,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  gridLabel: {
    ...typography.caption,
    color: colors.ink2,
  },
  gridVal: {
    ...typography.body,
    fontWeight: '600',
    marginTop: sz(2),
  },
  btnMap: {
    backgroundColor: colors.surface2,
    minHeight: sz(44),
    borderRadius: radius.btn,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnMapText: {
    ...typography.bodyL,
    fontSize: fs(14),
    color: colors.ink,
  },
  panel: {
    backgroundColor: colors.surface1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.x10,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  badgeOk: {
    backgroundColor: colors.surface2,
    paddingHorizontal: spacing.sm,
    paddingVertical: sz(2),
    borderRadius: radius.pill,
  },
  badgeOkText: {
    ...typography.caption,
    color: colors.ok,
    fontWeight: '700',
  },
  triggerList: {
    gap: spacing.sm,
  },
  triggerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface0,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    gap: spacing.sm,
  },
  triggerIconBox: {
    width: sz(38),
    height: sz(38),
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  triggerIconBoxDanger: {
    backgroundColor: colors.surface2White,
  },
  triggerIcon: {
    fontSize: fs(18),
  },
  triggerInfo: {
    flex: 1,
  },
  triggerTitle: {
    ...typography.body,
    fontWeight: '600',
    color: colors.ink,
  },
  triggerSub: {
    ...typography.caption,
    color: colors.ink2,
  },
  triggerActionBtn: {
    minHeight: sizes.btnCompact,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface2,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  triggerActionBtnDanger: {
    backgroundColor: colors.signal,
    borderColor: colors.signalPressed,
  },
  triggerActionText: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.ink,
  },
  feedbackBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    borderLeftWidth: sz(3),
    borderLeftColor: colors.primary,
  },
  feedbackText: {
    ...typography.caption,
    color: colors.primary,
  },
});

