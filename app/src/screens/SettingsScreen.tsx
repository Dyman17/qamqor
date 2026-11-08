import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch } from 'react-native';
import { useTheme, Theme } from '../theme/scale';
import { api, errorText } from '../services/api';
import { useLoad } from '../state/useLoad';
import { useSession } from '../state/session';

export const SettingsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const t = useTheme();
  const { colors, spacing, typography, hit } = t;
  const styles = useMemo(() => createStyles(t), [t]);
  const { user, farm, farmId, isOwner, memberships, signOut, changeFarm } = useSession();
  const farmData = useLoad(() => api.getFarm(farmId!), navigation);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (value: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await api.setWorkerCanEditBoundaries(farmId!, value);
      farmData.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <TouchableOpacity hitSlop={hit(36)} onPress={() => navigation.goBack()} style={{ marginBottom: spacing.md }}>
        <Text style={[typography.body, { color: colors.primary }]}>← Назад</Text>
      </TouchableOpacity>
      <Text style={[typography.title1, styles.header]}>Настройки</Text>

      <View style={styles.card}>
        <Text style={[typography.caption, { color: colors.ink2 }]}>Ферма</Text>
        <Text style={typography.bodyL}>{farm?.farmName}</Text>
        <Text style={typography.caption}>Ваша роль: {isOwner ? 'Владелец' : 'Работник'}</Text>
      </View>

      <View style={styles.card}>
        <Text style={[typography.caption, { color: colors.ink2 }]}>Аккаунт</Text>
        <Text style={typography.body}>{user?.fullName}</Text>
        <Text style={typography.caption}>{user?.email}</Text>
      </View>

      <View style={styles.card}>
        <Text style={[typography.caption, { color: colors.ink2 }]}>Доступ</Text>
        <View style={styles.switchRow}>
          <Text style={[typography.body, { flex: 1 }]}>Работник может изменять границы</Text>
          <Switch
            value={!!farmData.data?.workerCanEditBoundaries}
            onValueChange={toggle}
            disabled={!isOwner || saving || !farmData.data}
            trackColor={{ false: colors.line, true: colors.primary }}
            accessibilityLabel="Работник может изменять границы"
          />
        </View>
        {!isOwner && <Text style={typography.caption}>Менять может только владелец.</Text>}
        {(error || farmData.error) && <Text style={[typography.caption, { color: colors.signal }]}>{error || farmData.error}</Text>}
      </View>

      {memberships.length > 1 && (
        <TouchableOpacity style={styles.btnSecondary} onPress={changeFarm} accessibilityRole="button">
          <Text style={typography.label}>Сменить ферму</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.btnLogout} onPress={signOut} accessibilityRole="button">
        <Text style={styles.btnLogoutText}>Выйти из аккаунта</Text>
      </TouchableOpacity>
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
  btnSecondary: { backgroundColor: colors.surface2, minHeight: sizes.btn, borderRadius: radius.btn, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md, borderWidth: 1, borderColor: colors.borderSubtle },
  btnLogout: {
    backgroundColor: colors.signal,
    minHeight: sizes.btn,
    justifyContent: 'center',
    padding: spacing.md,
    borderRadius: radius.btn,
    alignItems: 'center',
    marginVertical: spacing.xl,
  },
  btnLogoutText: {
    ...typography.label,
    color: colors.onPrimary,
  },
});

