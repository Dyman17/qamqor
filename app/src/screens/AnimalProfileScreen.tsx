import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useTheme, Theme } from '../theme/scale';
import { api } from '../services/api';

export const AnimalProfileScreen: React.FC<{ route: any; navigation: any }> = ({ route, navigation }) => {
  const t = useTheme();
  const { colors, spacing, typography, sz, fs, hit } = t;
  const styles = useMemo(() => createStyles(t), [t]);
  const animalId = route?.params?.animalId || '0142';
  const [activeFeedback, setActiveFeedback] = useState<string | null>(null);

  const handleTrigger = async (type: 'sound' | 'vibro' | 'shock') => {
    try {
      if (type === 'sound') {
        setActiveFeedback('Сирена MAX98357 0.5W воспроизводится на ошейнике QAM-0001');
        await api.triggerActuator('QAM-0001', { sound: true });
      } else if (type === 'vibro') {
        setActiveFeedback('Вибромотор активирован на 2 секунды');
        await api.triggerActuator('QAM-0001', { vibrate: true });
      } else if (type === 'shock') {
        setActiveFeedback('Импульс 150мс (400 кВ) подан на контакты');
        await api.triggerActuator('QAM-0001', { shock: true });
      }
    } catch (e) {
      // Local demo fallback
    }
  };

  return (
    <ScrollView style={styles.container}>
      <TouchableOpacity style={styles.backButton} hitSlop={hit(36)} onPress={() => navigation.goBack()}>
        <Text style={styles.backText}>← Назад к списку</Text>
      </TouchableOpacity>

      {/* Main Animal Card */}
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View>
            <Text style={typography.title1}>Корова #{animalId}</Text>
            <Text style={[typography.caption, { color: colors.ink2 }]}>Казахская белоголовая · Бирка DEMO-A42</Text>
          </View>
          <View style={styles.badgeDanger}>
            <Text style={styles.badgeText}>Вне зоны</Text>
          </View>
        </View>

        <View style={styles.grid}>
          <View style={styles.gridItem}>
            <Text style={styles.gridLabel}>Текущий загон</Text>
            <Text style={styles.gridVal}>Загон «Северный»</Text>
          </View>
          <View style={styles.gridItem}>
            <Text style={styles.gridLabel}>Ошейник</Text>
            <Text style={styles.gridVal}>QAM-0001 (Онлайн)</Text>
          </View>
          <View style={styles.gridItem}>
            <Text style={styles.gridLabel}>Координаты</Text>
            <Text style={styles.gridVal}>43.6501, 51.1572</Text>
          </View>
          <View style={styles.gridItem}>
            <Text style={styles.gridLabel}>Связь</Text>
            <Text style={styles.gridVal}>5 мин назад</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.btnMap} hitSlop={hit(44)} onPress={() => navigation.navigate('Map')}>
          <Text style={styles.btnMapText}>Показать на карте</Text>
        </TouchableOpacity>
      </View>

      {/* Trigger Hardware Test Panel */}
      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={typography.title2}>Тестирование датчиков ошейника</Text>
          <View style={styles.badgeOk}>
            <Text style={styles.badgeOkText}>Тест-режим</Text>
          </View>
        </View>
        <Text style={[typography.caption, { color: colors.ink2, marginBottom: spacing.md }]}>
          Прямая подача управляющих сигналов на ESP32-ошейник через протокол API Gateway.
        </Text>

        <View style={styles.triggerList}>
          <View style={styles.triggerItem}>
            <View style={styles.triggerIconBox}>
              <Text style={styles.triggerIcon}>🔔</Text>
            </View>
            <View style={styles.triggerInfo}>
              <Text style={styles.triggerTitle}>Звуковой сигнал</Text>
              <Text style={styles.triggerSub}>0.5 Вт · 800–2400 Гц свип</Text>
            </View>
            <TouchableOpacity style={styles.triggerActionBtn} hitSlop={hit(36)} onPress={() => handleTrigger('sound')}>
              <Text style={styles.triggerActionText}>Тест звука</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.triggerItem}>
            <View style={styles.triggerIconBox}>
              <Text style={styles.triggerIcon}>📳</Text>
            </View>
            <View style={styles.triggerInfo}>
              <Text style={styles.triggerTitle}>Вибромотор</Text>
              <Text style={styles.triggerSub}>ERM мотор · 2 секунды</Text>
            </View>
            <TouchableOpacity style={styles.triggerActionBtn} hitSlop={hit(36)} onPress={() => handleTrigger('vibro')}>
              <Text style={styles.triggerActionText}>Тест вибро</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.triggerItem}>
            <View style={[styles.triggerIconBox, styles.triggerIconBoxDanger]}>
              <Text style={styles.triggerIcon}>⚡</Text>
            </View>
            <View style={styles.triggerInfo}>
              <Text style={styles.triggerTitle}>Электро-импульс</Text>
              <Text style={styles.triggerSub}>150 мс · 400 кВ при границе</Text>
            </View>
            <TouchableOpacity style={[styles.triggerActionBtn, styles.triggerActionBtnDanger]} hitSlop={hit(36)} onPress={() => handleTrigger('shock')}>
              <Text style={[styles.triggerActionText, { color: colors.onPrimary }]}>Импульс</Text>
            </TouchableOpacity>
          </View>
        </View>

        {activeFeedback && (
          <View style={styles.feedbackBox}>
            <Text style={styles.feedbackText}>{activeFeedback}</Text>
          </View>
        )}
      </View>
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

