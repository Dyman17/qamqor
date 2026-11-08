import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { useTheme, Theme } from '../theme/scale';
import { api, errorText, COLLAR_CODE_RE, timeAgo } from '../services/api';
import { useLoad } from '../state/useLoad';
import { useSession } from '../state/session';
import { StateBox, CONN_LABEL, DemoBadge } from '../components';

export const CollarsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const t = useTheme();
  const { colors, spacing, typography, radius, sizes, hit } = t;
  const styles = useMemo(() => createStyles(t), [t]);
  const { isOwner } = useSession();
  const collars = useLoad(() => api.getCollars(), navigation);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const onCode = (v: string) => {
    setCode(v.replace(/[^0-9]/g, '').slice(0, 8));
    setFormError(null);
  };

  const submit = async () => {
    if (!COLLAR_CODE_RE.test(code)) return setFormError('Код ошейника состоит ровно из 8 цифр');
    setBusy(true);
    setFormError(null);
    try {
      const res = await api.registerCollarByCode(code);
      void res;
      setNotice(`Ошейник ${code} добавлен`);
      setCode('');
      setAdding(false);
      collars.reload();
    } catch (e) {
      setFormError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const items = collars.data ?? [];

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={typography.title1}>Ошейники ({items.length})</Text>
        {isOwner && (
          <TouchableOpacity style={styles.btnAdd} hitSlop={hit(36)} onPress={() => setAdding(!adding)} accessibilityRole="button">
            <Text style={styles.btnAddText}>{adding ? 'Отмена' : '+ Добавить'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {adding && (
        <View style={styles.addBox}>
          <Text style={typography.caption}>Введите 8-значный код ошейника (он указан в прошивке)</Text>
          <TextInput
            style={styles.codeInput}
            value={code}
            onChangeText={onCode}
            keyboardType="number-pad"
            maxLength={8}
            placeholder="00000000"
            placeholderTextColor={colors.ink3}
            accessibilityLabel="Код ошейника, 8 цифр"
          />
          {formError && <Text style={[typography.caption, { color: colors.signal }]}>{formError}</Text>}
          <TouchableOpacity
            style={[styles.btnSubmit, !COLLAR_CODE_RE.test(code) && { opacity: 0.5 }]}
            onPress={submit}
            disabled={busy || !COLLAR_CODE_RE.test(code)}
            accessibilityRole="button"
          >
            {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.btnSubmitText}>Добавить ошейник</Text>}
          </TouchableOpacity>
        </View>
      )}

      {notice && <Text style={[typography.caption, { color: colors.ok, marginBottom: spacing.sm }]}>{notice}</Text>}

      <StateBox
        loading={collars.loading && !collars.data}
        error={collars.error}
        empty={!collars.loading && !collars.error && items.length === 0 ? 'Ошейников пока нет' : null}
        onRetry={collars.reload}
      />

      <FlatList
        data={items}
        keyExtractor={(item) => item.deviceId}
        refreshing={collars.loading && !!collars.data}
        onRefresh={collars.reload}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
                <Text style={[typography.bodyL, typography.tabular]}>{item.code ?? item.deviceId}</Text>
                {item.isDemo && <DemoBadge />}
                <View style={[styles.badge, item.status === 'ONLINE' ? styles.badgeOk : item.status === 'UNASSIGNED' ? styles.badgeFree : styles.badgeOff]}>
                  <Text style={styles.badgeText}>{CONN_LABEL[item.status] ?? item.status}</Text>
                </View>
              </View>
              <Text style={styles.subText}>
                {item.animalName ?? 'Не привязан'} · {timeAgo(item.lastSeenAt)}
              </Text>
            </View>

            {item.animalId && (
              <TouchableOpacity
                style={styles.btnAction}
                hitSlop={hit(36)}
                onPress={() => navigation.navigate('Profile', { animalId: item.animalId })}
              >
                <Text style={styles.btnActionText}>Профиль</Text>
              </TouchableOpacity>
            )}
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
    paddingVertical: sz(2),
    borderRadius: radius.pill,
  },
  badgeOk: {
    backgroundColor: colors.surface2,
  },
  badgeFree: {
    backgroundColor: colors.surface1,
  },
  badgeOff: {
    backgroundColor: colors.surface0,
  },
  badgeText: {
    ...typography.caption,
    fontSize: fs(11),
    fontWeight: '700',
    color: colors.ink,
  },
  addBox: { backgroundColor: colors.surface1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.borderSubtle },
  codeInput: { backgroundColor: colors.surface0, borderRadius: radius.md, minHeight: sizes.touch, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.borderSubtle, ...typography.bodyL, color: colors.ink, letterSpacing: sz(3) },
  btnSubmit: { backgroundColor: colors.primary, minHeight: sizes.btn, borderRadius: radius.btn, alignItems: 'center', justifyContent: 'center' },
  btnSubmitText: { ...typography.bodyL, color: colors.onPrimary },
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

