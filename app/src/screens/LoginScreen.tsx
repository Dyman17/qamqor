import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useTheme, Theme } from '../theme/scale';
import { api, errorText } from '../services/api';
import { useSession } from '../state/session';

export const LoginScreen: React.FC = () => {
  const t = useTheme();
  const { colors, typography } = t;
  const styles = useMemo(() => createStyles(t), [t]);
  const { signIn } = useSession();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [farmName, setFarmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const em = email.trim();
    if (!em || !password) return setError('Введите email и пароль');
    if (mode === 'register') {
      if (!fullName.trim()) return setError('Введите имя');
      if (password.length < 8) return setError('Пароль не короче 8 символов');
    }
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === 'login'
          ? await api.login(em, password)
          : await api.register({
              email: em,
              password,
              fullName: fullName.trim(),
              ...(farmName.trim() ? { farmName: farmName.trim() } : {}),
            });
      signIn(res);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ flex: 1, backgroundColor: colors.surface0 }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.logo}>QAMQOR</Text>
          <Text style={styles.subTitle}>Умный спутниковый выпас скота</Text>

          {mode === 'register' && (
            <>
              <View style={styles.field}>
                <Text style={styles.label}>Имя</Text>
                <TextInput style={styles.input} value={fullName} onChangeText={setFullName} accessibilityLabel="Имя" />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Название фермы (необязательно)</Text>
                <TextInput style={styles.input} value={farmName} onChangeText={setFarmName} accessibilityLabel="Название фермы" />
              </View>
            </>
          )}

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Email"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Пароль</Text>
            <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry accessibilityLabel="Пароль" />
          </View>

          {error && <Text style={[typography.caption, { color: colors.signal, marginTop: t.spacing.sm }]}>{error}</Text>}

          <TouchableOpacity style={styles.btnLogin} onPress={submit} disabled={busy} accessibilityRole="button">
            {busy ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.btnLoginText}>{mode === 'login' ? 'Войти' : 'Создать аккаунт'}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={{ marginTop: t.spacing.lg, alignItems: 'center' }}
            hitSlop={t.hit(36)}
            onPress={() => {
              setError(null);
              setMode(mode === 'login' ? 'register' : 'login');
            }}
          >
            <Text style={[typography.body, { color: colors.primary }]}>
              {mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const createStyles = ({ colors, spacing, radius, typography, sizes, sz, fs, lh, hairline }: Theme) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface0,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  logo: {
    ...typography.display,
    color: colors.primary,
    textAlign: 'center',
    letterSpacing: sz(2),
  },
  subTitle: {
    ...typography.caption,
    textAlign: 'center',
    color: colors.ink2,
    marginBottom: spacing.xl,
    marginTop: spacing.xs,
  },
  field: {
    marginBottom: spacing.md,
  },
  label: {
    ...typography.caption,
    color: colors.ink2,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surface0,
    borderRadius: radius.md,
    minHeight: sizes.touch,
    paddingHorizontal: spacing.md,
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  btnLogin: {
    backgroundColor: colors.primary,
    minHeight: sizes.btn,
    borderRadius: radius.btn,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  btnLoginText: {
    ...typography.bodyL,
    color: colors.onPrimary,
  },
});

