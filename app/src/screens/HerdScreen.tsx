import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TextInput, FlatList, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme, Theme } from '../theme/scale';
import { api, timeAgo } from '../services/api';
import { useLoad } from '../state/useLoad';
import { StateBox, STATUS_LABEL } from '../components';
import { AnimalStatus } from '../types';

export const HerdScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const t = useTheme();
  const { colors, spacing, typography, sz, fs, hit } = t;
  const styles = useMemo(() => createStyles(t), [t]);
  const [filter, setFilter] = useState<'all' | AnimalStatus>('all');
  const [search, setSearch] = useState('');
  const animals = useLoad(() => api.getAnimals(), navigation);
  const pens = useLoad(() => api.getGeofences(), navigation);

  const penName = (id: string | null) => (id ? pens.data?.find((p) => p.id === id)?.name ?? 'Загон' : 'Без границы');
  const all = animals.data ?? [];
  const q = search.trim().toLowerCase();
  const filtered = all.filter(
    (a) =>
      (filter === 'all' || a.status === filter) &&
      (!q || a.name.toLowerCase().includes(q) || a.tag.toLowerCase().includes(q)),
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={typography.title1}>Стадо ({all.length})</Text>
        <TouchableOpacity style={styles.btnAdd} hitSlop={hit(36)} onPress={() => navigation.navigate('AddAnimal')} accessibilityRole="button">
          <Text style={styles.btnAddText}>+ Животное</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Кличка или бирка..."
          placeholderTextColor={colors.ink3}
          value={search}
          onChangeText={setSearch}
          accessibilityLabel="Поиск животного"
        />
      </View>

      <View style={{ marginBottom: spacing.md }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {(['all', 'ok', 'danger', 'warning', 'offline'] as const).map((st) => (
            <TouchableOpacity
              key={st}
              style={[styles.filterChip, filter === st && styles.filterChipActive]}
              hitSlop={hit(36)}
              onPress={() => setFilter(st)}
            >
              <Text style={[styles.chipText, filter === st && styles.chipTextActive]}>
                {st === 'all' ? 'Все' : STATUS_LABEL[st]}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <StateBox
        loading={animals.loading && !animals.data}
        error={animals.error}
        empty={!animals.loading && !animals.error && filtered.length === 0 ? 'Животных нет' : null}
        onRetry={animals.reload}
      />

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshing={animals.loading && !!animals.data}
        onRefresh={animals.reload}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => navigation.navigate('Profile', { animalId: item.id })}
          >
            <View
              style={[
                styles.dot,
                {
                  backgroundColor:
                    item.status === 'ok'
                      ? colors.okDot
                      : item.status === 'danger'
                      ? colors.signal
                      : item.status === 'offline'
                      ? colors.offline
                      : colors.warning,
                },
              ]}
            />
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.rowSub} numberOfLines={1} ellipsizeMode="tail">Бирка {item.tag} · {penName(item.penId)}</Text>
            </View>
            <Text style={styles.rowTime} numberOfLines={1}>{timeAgo(item.lastSeenAt)}</Text>
          </TouchableOpacity>
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
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  btnAdd: { backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md },
  btnAddText: { ...typography.caption, color: colors.onPrimary, fontWeight: '700' },
  searchBar: {
    backgroundColor: colors.surface1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    minHeight: sizes.touch,
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  searchInput: {
    ...typography.body,
    color: colors.ink,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface1,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
  },
  chipText: {
    ...typography.caption,
    color: colors.ink2,
  },
  chipTextActive: {
    color: colors.onPrimary,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    gap: spacing.md,
  },
  dot: {
    width: sz(8),
    height: sz(8),
    borderRadius: sz(4),
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    ...typography.bodyL,
  },
  rowSub: {
    ...typography.caption,
    color: colors.ink2,
    marginTop: sz(2),
  },
  rowTime: {
    ...typography.caption,
    color: colors.ink3,
    flexShrink: 0,
  },
});

