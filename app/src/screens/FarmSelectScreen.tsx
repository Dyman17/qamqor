import React, { useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useTheme, Theme } from '../theme/scale';
import { useSession } from '../state/session';

export const FarmSelectScreen: React.FC = () => {
  const t = useTheme();
  const { typography } = t;
  const styles = useMemo(() => createStyles(t), [t]);
  const { memberships, selectFarm, signOut } = useSession();

  return (
    <View style={styles.container}>
      <Text style={[typography.title1, { marginBottom: t.spacing.md }]}>Выберите ферму</Text>
      <FlatList
        data={memberships}
        keyExtractor={(m) => m.farmId}
        ListEmptyComponent={<Text style={typography.body}>У вас нет доступа ни к одной ферме.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => selectFarm(item.farmId)} accessibilityRole="button">
            <Text style={typography.bodyL} numberOfLines={1}>{item.farmName}</Text>
            <Text style={styles.role}>{item.role === 'OWNER' ? 'Владелец' : 'Работник'}</Text>
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity style={styles.out} onPress={signOut} accessibilityRole="button">
        <Text style={typography.body}>Выйти из аккаунта</Text>
      </TouchableOpacity>
    </View>
  );
};

const createStyles = ({ colors, spacing, radius, typography, sizes }: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface0, paddingTop: 54, paddingHorizontal: spacing.lg },
    row: {
      minHeight: sizes.touch,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.surface1,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
    },
    role: { ...typography.caption, color: colors.ink2 },
    out: { minHeight: sizes.touch, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.xl },
  });
