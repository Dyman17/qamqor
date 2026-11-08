import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { useTheme, Theme } from '../theme/scale';

export const LoginScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const t = useTheme();
  const { colors, spacing, typography, sz, fs, hit } = t;
  const styles = useMemo(() => createStyles(t), [t]);
  const [email, setEmail] = useState('owner@qamqor.kz');
  const [password, setPassword] = useState('password123');

  const handleLogin = () => {
    navigation.reset({
      index: 0,
      routes: [{ name: 'Main' }],
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.logo}>QAMQOR</Text>
        <Text style={styles.subTitle}>Умный спутниковый выпас скота</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Пароль</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
        </View>

        <TouchableOpacity style={styles.btnLogin} onPress={handleLogin}>
          <Text style={styles.btnLoginText}>Войти в систему</Text>
        </TouchableOpacity>
      </View>
    </View>
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

