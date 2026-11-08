import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TextInput, FlatList, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme, Theme } from '../theme/scale';

const ANIMALS = [
  { id: '0142', tag: 'DEMO-A42', pen: 'Загон «Северный»', status: 'danger', ago: 5 },
  { id: '0087', tag: 'DEMO-A87', pen: 'Загон «Северный»', status: 'ok', ago: 1 },
  { id: '0054', tag: 'DEMO-A54', pen: 'Загон «Северный»', status: 'ok', ago: 2 },
  { id: '0099', tag: 'DEMO-A99', pen: 'Загон «Северный»', status: 'ok', ago: 3 },
  { id: '0231', tag: 'DEMO-A31', pen: 'Загон «Северный»', status: 'offline', ago: 12 },
  { id: '0301', tag: 'DEMO-A01', pen: 'Загон «Южный»', status: 'ok', ago: 1 },
  { id: '0410', tag: 'DEMO-A11', pen: 'Без границы', status: 'warning', ago: 6 },
];

export const HerdScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const t = useTheme();
  const { colors, spacing, typography, sz, fs, hit } = t;
  const styles = useMemo(() => createStyles(t), [t]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const filtered = ANIMALS.filter((a) => {
    const matchesFilter = filter === 'all' || a.status === filter;
    const matchesSearch = a.id.includes(search) || a.tag.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  return (
    <View style={styles.container}>
      <Text style={[typography.title1, styles.header]}>Стадо (142)</Text>

      {/* Search Input */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Номер или бирка..."
          placeholderTextColor={colors.ink3}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Filter Tabs */}
      <View style={{ marginBottom: spacing.md }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {(['all', 'ok', 'danger', 'offline'] as const).map((st) => (
            <TouchableOpacity
              key={st}
              style={[styles.filterChip, filter === st && styles.filterChipActive]}
              hitSlop={hit(36)}
              onPress={() => setFilter(st)}
            >
              <Text style={[styles.chipText, filter === st && styles.chipTextActive]}>
                {st === 'all' ? 'Все' : st === 'ok' ? 'В зоне' : st === 'danger' ? 'Вне зоны' : 'Без связи'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Animal List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
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
              <Text style={styles.rowTitle} numberOfLines={1}>Корова #{item.id}</Text>
              <Text style={styles.rowSub} numberOfLines={1} ellipsizeMode="tail">Бирка {item.tag} · {item.pen}</Text>
            </View>
            <Text style={styles.rowTime} numberOfLines={1}>{item.ago} мин назад</Text>
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
  header: {
    marginBottom: spacing.md,
  },
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

