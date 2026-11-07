import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { colors, spacing, radius, typography } from '../theme/tokens';
import { api } from '../services/api';

export const AnimalProfileScreen: React.FC<{ route: any; navigation: any }> = ({ route, navigation }) => {
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
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
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

        <TouchableOpacity style={styles.btnMap} onPress={() => navigation.navigate('Map')}>
          <Text style={styles.btnMapText}>Показать на карте</Text>
        </TouchableOpacity>
      </View>

      {/* Trigger Hardware Test Panel */}
      <View style={styles.panel}>
        <Text style={[typography.title2, { marginBottom: spacing.sm }]}>Тестирование датчиков ошейника</Text>
        <Text style={[typography.caption, { color: colors.ink2, marginBottom: spacing.md }]}>
          Прямая подача управляющих сигналов на ESP32-ошейник через протокол API Gateway.
        </Text>

        <View style={styles.triggerRow}>
          <TouchableOpacity style={styles.triggerBtn} onPress={() => handleTrigger('sound')}>
            <Text style={styles.triggerBtnText}>Звук 0.5W</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.triggerBtn} onPress={() => handleTrigger('vibro')}>
            <Text style={styles.triggerBtnText}>Вибромотор</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.triggerBtn, styles.triggerBtnDanger]} onPress={() => handleTrigger('shock')}>
            <Text style={[styles.triggerBtnText, { color: '#ffffff' }]}>Импульс 150мс</Text>
          </TouchableOpacity>
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

const styles = StyleSheet.create({
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
    backgroundColor: 'rgba(248, 113, 113, 0.2)',
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
    marginTop: 2,
  },
  btnMap: {
    backgroundColor: colors.surface2,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnMapText: {
    ...typography.bodyL,
    fontSize: 14,
    color: colors.ink,
  },
  panel: {
    backgroundColor: colors.surface1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderGlow,
    marginBottom: 40,
  },
  triggerRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  triggerBtn: {
    flex: 1,
    height: 44,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  triggerBtnDanger: {
    backgroundColor: colors.signal,
    borderColor: colors.signalPressed,
  },
  triggerBtnText: {
    ...typography.caption,
    color: colors.ink,
    fontWeight: '600',
  },
  feedbackBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  feedbackText: {
    ...typography.caption,
    color: colors.primary,
  },
});

