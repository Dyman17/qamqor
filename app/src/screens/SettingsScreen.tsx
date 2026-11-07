import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch } from 'react-native';
import { colors, spacing, radius, typography } from '../theme/tokens';

export const SettingsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [workerCanEdit, setWorkerCanEdit] = React.useState(true);

  return (
    <ScrollView style={styles.container}>
      <Text style={[typography.title1, styles.header]}>Настройки</Text>

      {/* Farm Card */}
      <View style={styles.card}>
        <Text style={[typography.caption, { color: colors.ink2 }]}>Параметры фермы</Text>
        <Text style={typography.bodyL}>Ферма Демо (Северный Участок)</Text>
        <Text style={typography.caption}>Площадь: 1 200 га · Алматинская область</Text>
      </View>

      {/* Access and Roles */}
      <View style={styles.card}>
        <Text style={[typography.caption, { color: colors.ink2 }]}>Сотрудники и доступ</Text>
        <View style={styles.memberRow}>
          <Text style={typography.body}>owner@qamqor.kz</Text>
          <Text style={[typography.caption, { color: colors.primary }]}>Владелец</Text>
        </View>
        <View style={styles.memberRow}>
          <Text style={typography.body}>serik@qamqor.kz</Text>
          <Text style={[typography.caption, { color: colors.ok }]}>Работник</Text>
        </View>
        <View style={styles.switchRow}>
          <Text style={[typography.body, { flex: 1 }]}>Работник может изменять границы</Text>
          <Switch
            value={workerCanEdit}
            onValueChange={setWorkerCanEdit}
            trackColor={{ false: colors.surface2, true: colors.primary }}
          />
        </View>
      </View>

      {/* Impulse Limits */}
      <View style={styles.card}>
        <Text style={[typography.caption, { color: colors.ink2 }]}>Параметры сигналов</Text>
        <Text style={typography.body}>Акустика: I2S MAX98357 0.5W (800–2400 Гц)</Text>
        <Text style={typography.body}>Вибрация: 2 сек при 3 м до границы</Text>
        <Text style={typography.body}>Импульс: 150 мс, 400 кВ при пересечении</Text>
      </View>

      {/* Logout */}
      <TouchableOpacity
        style={styles.btnLogout}
        onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Login' }] })}
      >
        <Text style={styles.btnLogoutText}>Выйти из аккаунта</Text>
      </TouchableOpacity>
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
    gap: spacing.xs,
  },
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderColor: colors.borderSubtle,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing.sm,
  },
  btnLogout: {
    backgroundColor: 'rgba(248, 113, 113, 0.15)',
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    marginVertical: spacing.xl,
    borderWidth: 1,
    borderColor: colors.signal,
  },
  btnLogoutText: {
    ...typography.bodyL,
    color: colors.signal,
  },
});

