import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTheme } from './theme/scale';

/** Loading / error / empty states shared by list screens. */
export const StateBox: React.FC<{
  loading?: boolean;
  error?: string | null;
  empty?: string | null;
  onRetry?: () => void;
}> = ({ loading, error, empty, onRetry }) => {
  const { colors, spacing, typography, radius, sizes } = useTheme();
  if (loading) {
    return (
      <View style={{ padding: spacing.xl, alignItems: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={{ padding: spacing.lg, gap: spacing.md, alignItems: 'center' }}>
        <Text style={[typography.body, { color: colors.signal, textAlign: 'center' }]}>{error}</Text>
        {onRetry && (
          <TouchableOpacity
            onPress={onRetry}
            accessibilityRole="button"
            style={{
              minHeight: sizes.btnCompact,
              paddingHorizontal: spacing.lg,
              borderRadius: radius.btn,
              backgroundColor: colors.primary,
              justifyContent: 'center',
            }}
          >
            <Text style={[typography.bodyL, { color: colors.onPrimary }]}>Повторить</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }
  if (empty) {
    return (
      <View style={{ padding: spacing.xl }}>
        <Text style={[typography.body, { color: colors.ink2, textAlign: 'center' }]}>{empty}</Text>
      </View>
    );
  }
  return null;
};

export const STATUS_LABEL: Record<string, string> = {
  ok: 'В зоне',
  danger: 'Вне зоны',
  warning: 'Внимание',
  offline: 'Нет связи',
};

export const CONN_LABEL: Record<string, string> = {
  ONLINE: 'Онлайн',
  OFFLINE: 'Нет связи',
  UNASSIGNED: 'Не привязан',
};
