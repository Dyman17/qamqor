import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useTheme, Theme } from '../theme/scale';
import { api, errorText } from '../services/api';
import { useSession } from '../state/session';
import { useLoad } from '../state/useLoad';
import { Animal, CollarResponseDto, DataMode, GeofencePen, SimEvent, SimulationDto } from '../types';

const MODES: { v: DataMode; label: string }[] = [
  { v: 'REAL', label: 'Реальный' },
  { v: 'MANUAL', label: 'Пилотный' },
  { v: 'AUTO', label: 'Автоматический' },
];
const SPEEDS = [1, 2, 5, 10] as const;
const EVENTS: { v: SimEvent; label: string }[] = [
  { v: 'BREACH', label: 'Выход за границу' },
  { v: 'ESCAPE', label: 'Побег' },
  { v: 'RETURN', label: 'Возврат' },
  { v: 'GPS_LOST', label: 'Потеря GPS' },
  { v: 'COLLAR_OFFLINE', label: 'Ошейник молчит' },
  { v: 'COLLAR_ONLINE', label: 'Связь есть' },
];

// local flat-earth geometry (metres): a point `insideM` metres inside the nearest border of the pen
function nearestBorderInside(pen: GeofencePen, lat: number, lng: number, insideM: number) {
  const ring = pen.polygon.coordinates[0];
  const kx = Math.cos((lat * Math.PI) / 180) * 111320;
  const ky = 110574;
  const P = { x: lng * kx, y: lat * ky };
  let best: { x: number; y: number; d: number } | null = null;
  for (let i = 0; i < ring.length - 1; i++) {
    const A = { x: ring[i][0] * kx, y: ring[i][1] * ky };
    const B = { x: ring[i + 1][0] * kx, y: ring[i + 1][1] * ky };
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2));
    const Q = { x: A.x + u * dx, y: A.y + u * dy };
    const d = Math.hypot(P.x - Q.x, P.y - Q.y);
    if (!best || d < best.d) best = { ...Q, d };
  }
  if (!best) return null;
  const d = best.d || 1;
  const ux = (P.x - best.x) / d; // from the border toward the animal (inside)
  const uy = (P.y - best.y) / d;
  return { lat: (best.y + uy * insideM) / ky, lng: (best.x + ux * insideM) / kx };
}

export const ModeSection: React.FC = () => {
  const t = useTheme();
  const { colors, spacing, typography, hit } = t;
  const styles = useMemo(() => createStyles(t), [t]);
  const { farmId, isOwner, dataMode, setDataMode } = useSession();
  const [sim, setSim] = useState<SimulationDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [latS, setLatS] = useState('');
  const [lngS, setLngS] = useState('');
  const [speed, setSpeed] = useState<1 | 2 | 5 | 10>(1);
  const [last, setLast] = useState<CollarResponseDto | null>(null);

  const animals = useLoad(() => api.getAnimals());
  const pens = useLoad(() => api.getGeofences());
  const reloadAnimals = animals.reload;
  const demoAnimals = (animals.data ?? []).filter((a) => a.isDemo);
  const current: Animal | undefined = demoAnimals.find((a) => a.id === selected);

  const poll = useCallback(async () => {
    try {
      const s = await api.getSimulation(farmId!);
      setSim(s);
      setDataMode(s.dataMode);
      setSpeed(s.speed);
    } catch (e) {
      setMsg({ text: errorText(e), error: true });
    }
  }, [farmId, setDataMode]);

  // initial read; while AUTO is on, poll every ~10 s (this component exists only while Settings is open)
  useEffect(() => {
    poll();
  }, [poll]);
  useEffect(() => {
    if (dataMode !== 'AUTO') return;
    const id = setInterval(() => {
      poll();
      reloadAnimals();
    }, 10000);
    return () => clearInterval(id);
  }, [dataMode, poll, reloadAnimals]);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ text });
    } catch (e) {
      setMsg({ text: errorText(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  const applySim = (s: SimulationDto) => {
    setSim(s);
    setDataMode(s.dataMode);
    setSpeed(s.speed);
    animals.reload();
    pens.reload();
  };

  const changeMode = (m: DataMode) => {
    if (m === dataMode) return;
    const go = () =>
      run(async () => {
        applySim(m === 'AUTO' ? await api.startSimulation(farmId!, { speed }) : await api.setDataMode(farmId!, m));
      });
    if (m === 'REAL') {
      Alert.alert(
        'Вернуться в реальный режим?',
        'Все демо-данные (животные, загон, оповещения) будут удалены. Настоящие данные не затрагиваются.',
        [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Удалить демо и вернуться', style: 'destructive', onPress: go },
        ],
      );
    } else go();
  };

  const sendTelemetry = (lat: number, lng: number) =>
    run(async () => {
      setLast(await api.simTelemetry(farmId!, { animalId: selected!, lat, lng }));
      animals.reload();
      return 'Позиция отправлена';
    });

  const manualPos = () => {
    const lat = parseFloat(latS.replace(',', '.'));
    const lng = parseFloat(lngS.replace(',', '.'));
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      setMsg({ text: 'Введите корректные широту и долготу', error: true });
      return;
    }
    sendTelemetry(lat, lng);
  };

  const toBorder = () => {
    const list = pens.data ?? [];
    const pen = list.find((p) => p.id === current?.penId) ?? list.find((p) => p.isDemo) ?? list[0];
    if (!pen || !current || current.lat == null || current.lng == null) {
      setMsg({ text: 'Сначала отправьте позицию животного', error: true });
      return;
    }
    const p = nearestBorderInside(pen, current.lat, current.lng, 3);
    if (!p) {
      setMsg({ text: 'У загона нет границы', error: true });
      return;
    }
    sendTelemetry(p.lat, p.lng);
  };

  const fireEvent = (ev: SimEvent) =>
    run(async () => {
      const r = await api.simEvent(farmId!, selected!, ev);
      setLast('zone' in r ? r : null);
      animals.reload();
      return 'Событие выполнено';
    });

  const addAnimal = () =>
    run(async () => {
      const a = await api.simAddAnimal(farmId!);
      setSelected(a.id);
      animals.reload();
      pens.reload();
      return `Добавлено: ${a.name}`;
    });

  const chip = (key: string, active: boolean, label: string, onPress: () => void, disabled?: boolean) => (
    <TouchableOpacity
      key={key}
      style={[styles.chip, active && styles.chipActive, disabled && { opacity: 0.5 }]}
      hitSlop={hit(36)}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  const btn = (label: string, onPress: () => void, secondary?: boolean) => (
    <TouchableOpacity
      style={[styles.btn, secondary && styles.btnSecondary]}
      hitSlop={hit(36)}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
    >
      <Text style={[styles.btnText, secondary && { color: colors.ink }]}>{label}</Text>
    </TouchableOpacity>
  );

  const modeLabel = MODES.find((m) => m.v === dataMode)?.label;

  return (
    <View style={styles.card}>
      <Text style={[typography.caption, { color: colors.ink2 }]}>Режим</Text>

      {!isOwner ? (
        <Text style={typography.body}>Режим данных: {modeLabel}. Менять может только владелец.</Text>
      ) : (
        <>
          {sim && !sim.enabled && (
            <Text style={[typography.caption, { color: colors.signal }]}>Демо-режимы отключены на сервере.</Text>
          )}
          <View style={styles.chips}>
            {MODES.map((m) =>
              chip(m.v, dataMode === m.v, m.label, () => changeMode(m.v), busy || (!!sim && !sim.enabled && m.v !== 'REAL')),
            )}
          </View>

          {dataMode === 'REAL' && (
            <Text style={typography.caption}>Показываются только данные настоящих ошейников.</Text>
          )}

          {dataMode === 'AUTO' && (
            <View style={{ gap: spacing.sm }}>
              <Text style={typography.body}>
                {sim?.running ? 'Симуляция идёт' : 'Симуляция остановлена'} · животных: {sim?.demo.animals ?? '…'} ·
                демо-оповещений: {sim?.demo.alerts ?? '…'}
              </Text>
              {sim?.until && (
                <Text style={typography.caption}>Автостоп: {new Date(sim.until).toLocaleTimeString('ru-RU')}</Text>
              )}
              <Text style={styles.label}>Скорость</Text>
              <View style={styles.chips}>
                {SPEEDS.map((s) =>
                  chip(
                    String(s),
                    speed === s,
                    `x${s}`,
                    () =>
                      run(async () => {
                        setSpeed(s);
                        if (sim?.running) applySim(await api.setSimulationSpeed(farmId!, s));
                      }),
                    busy,
                  ),
                )}
              </View>
              <View style={styles.chips}>
                {sim?.running
                  ? btn('Остановить', () => run(async () => applySim(await api.stopSimulation(farmId!))), true)
                  : btn('Запустить', () => run(async () => applySim(await api.startSimulation(farmId!, { speed }))))}
                {btn('Сбросить сценарий', () => run(async () => applySim(await api.resetSimulation(farmId!))), true)}
              </View>
            </View>
          )}

          {dataMode === 'MANUAL' && (
            <View style={{ gap: spacing.sm }}>
              <Text style={styles.label}>Демо-животное</Text>
              <View style={styles.chips}>
                {demoAnimals.map((a) => chip(a.id, selected === a.id, a.name, () => setSelected(a.id)))}
                {btn('+ Добавить демо-животное', addAnimal, true)}
              </View>

              {current && (
                <>
                  <Text style={typography.caption}>
                    Позиция:{' '}
                    {current.lat != null && current.lng != null
                      ? `${current.lat.toFixed(5)}, ${current.lng.toFixed(5)}`
                      : 'не задана'}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      value={latS}
                      onChangeText={setLatS}
                      placeholder="Широта"
                      placeholderTextColor={colors.ink3}
                      keyboardType="numbers-and-punctuation"
                      accessibilityLabel="Широта"
                    />
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      value={lngS}
                      onChangeText={setLngS}
                      placeholder="Долгота"
                      placeholderTextColor={colors.ink3}
                      keyboardType="numbers-and-punctuation"
                      accessibilityLabel="Долгота"
                    />
                  </View>
                  <View style={styles.chips}>
                    {btn('Отправить позицию', manualPos)}
                    {btn('К границе', toBorder, true)}
                    {btn('За границу', () => fireEvent('BREACH'), true)}
                  </View>
                  <Text style={styles.label}>События</Text>
                  <View style={styles.chips}>{EVENTS.map((e) => chip(e.v, false, e.label, () => fireEvent(e.v), busy))}</View>
                  {last && (
                    <Text style={typography.caption}>
                      Ответ ошейнику: зона {last.zone}
                      {last.distanceToBorderMeters != null ? `, до границы ${Math.round(last.distanceToBorderMeters)} м` : ''}
                      {last.sound ? ', звук' : ''}
                      {last.vibrate ? ', вибрация' : ''}
                    </Text>
                  )}
                </>
              )}
            </View>
          )}
        </>
      )}

      {msg && <Text style={[typography.caption, { color: msg.error ? colors.signal : colors.ok }]}>{msg.text}</Text>}
    </View>
  );
};

const createStyles = ({ colors, spacing, radius, typography, sizes }: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface1,
      borderRadius: radius.md,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      marginBottom: spacing.md,
      gap: spacing.sm,
    },
    label: { ...typography.caption, color: colors.ink2 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
    chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surface2 },
    chipActive: { backgroundColor: colors.primary },
    chipText: { ...typography.caption, color: colors.ink },
    chipTextActive: { color: colors.onPrimary, fontWeight: '700' },
    input: {
      backgroundColor: colors.surface2,
      borderRadius: radius.md,
      minHeight: sizes.touch,
      paddingHorizontal: spacing.md,
      color: colors.ink,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
    },
    btn: {
      minHeight: sizes.btnCompact,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.primary,
      borderRadius: radius.sm,
      justifyContent: 'center',
      alignItems: 'center',
    },
    btnSecondary: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.borderSubtle },
    btnText: { ...typography.caption, color: colors.onPrimary, fontWeight: '600' },
  });
