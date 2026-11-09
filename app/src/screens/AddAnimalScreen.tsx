import { ArrowLeft } from 'phosphor-react-native/lib/module/icons/ArrowLeft';
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useTheme, Theme } from '../theme/scale';
import { api, errorText } from '../services/api';
import { useLoad } from '../state/useLoad';
import { Animal } from '../types';

const SPECIES: { v: Animal['species']; label: string }[] = [
  { v: 'CATTLE', label: 'Корова' },
  { v: 'HORSE', label: 'Лошадь' },
  { v: 'CAMEL', label: 'Верблюд' },
  { v: 'SHEEP', label: 'Овца' },
  { v: 'GOAT', label: 'Коза' },
];

export const AddAnimalScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const t = useTheme();
  const { colors, spacing, typography, hit, fs } = t;
  const styles = useMemo(() => createStyles(t), [t]);
  const pens = useLoad(() => api.getGeofences());
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [breed, setBreed] = useState('');
  const [species, setSpecies] = useState<Animal['species']>('CATTLE');
  const [penId, setPenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() || !tag.trim()) return setError('Укажите кличку и номер бирки');
    setBusy(true);
    setError(null);
    try {
      const created = await api.createAnimal({
        name: name.trim(),
        tag: tag.trim(),
        species,
        ...(breed.trim() ? { breed: breed.trim() } : {}),
        ...(penId ? { penId } : {}),
      });
      navigation.replace('Profile', { animalId: created.id });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const Chip = ({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) => (
    <TouchableOpacity style={[styles.chip, active && styles.chipActive]} hitSlop={hit(36)} onPress={onPress} accessibilityRole="button">
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <TouchableOpacity hitSlop={hit(36)} onPress={() => navigation.goBack()} style={{ marginBottom: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <ArrowLeft color={colors.primary} size={fs(18)} weight="regular" />
          <Text style={[typography.body, { color: colors.primary }]}>Назад</Text>
        </View>
      </TouchableOpacity>
      <Text style={[typography.title1, { marginBottom: spacing.lg }]}>Добавить животное</Text>

      <Text style={styles.label}>Кличка</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} accessibilityLabel="Кличка" />
      <Text style={styles.label}>Номер бирки</Text>
      <TextInput style={styles.input} value={tag} onChangeText={setTag} autoCapitalize="characters" accessibilityLabel="Номер бирки" />
      <Text style={styles.label}>Порода (необязательно)</Text>
      <TextInput style={styles.input} value={breed} onChangeText={setBreed} accessibilityLabel="Порода" />

      <Text style={styles.label}>Вид</Text>
      <View style={styles.chips}>
        {SPECIES.map((s) => (
          <Chip key={s.v} active={species === s.v} label={s.label} onPress={() => setSpecies(s.v)} />
        ))}
      </View>

      {(pens.data ?? []).length > 0 && (
        <>
          <Text style={styles.label}>Загон (необязательно)</Text>
          <View style={styles.chips}>
            <Chip active={penId === null} label="Без границы" onPress={() => setPenId(null)} />
            {(pens.data ?? []).map((p) => (
              <Chip key={p.id} active={penId === p.id} label={p.name} onPress={() => setPenId(p.id)} />
            ))}
          </View>
        </>
      )}

      {error && <Text style={[typography.caption, { color: colors.signal, marginTop: spacing.md }]}>{error}</Text>}

      <TouchableOpacity style={styles.btn} onPress={submit} disabled={busy} accessibilityRole="button">
        {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.btnText}>Сохранить</Text>}
      </TouchableOpacity>
      <View style={{ height: spacing.x10 }} />
    </ScrollView>
  );
};

const createStyles = ({ colors, spacing, radius, typography, sizes }: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface0, paddingTop: 54, paddingHorizontal: spacing.lg },
    label: { ...typography.caption, color: colors.ink2, marginBottom: spacing.xs, marginTop: spacing.md },
    input: {
      backgroundColor: colors.surface2,
      borderRadius: radius.md,
      minHeight: sizes.touch,
      paddingHorizontal: spacing.md,
      color: colors.ink,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surface1 },
    chipActive: { backgroundColor: colors.primary },
    chipText: { ...typography.caption, color: colors.ink2 },
    chipTextActive: { color: colors.onPrimary, fontWeight: '700' },
    btn: {
      backgroundColor: colors.primary,
      minHeight: sizes.btn,
      borderRadius: radius.btn,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing.xl,
    },
    btnText: { ...typography.bodyL, color: colors.onPrimary },
  });
