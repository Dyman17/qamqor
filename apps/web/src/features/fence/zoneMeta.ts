import {
  ShieldCheck,
  TriangleAlert,
  OctagonAlert,
  Ban,
  Siren,
  HelpCircle,
  type LucideIcon,
} from 'lucide-react';
import { Zone } from '@qamqor/contracts';

export type ZoneTone = 'ok' | 'warn' | 'danger' | 'critical' | 'unknown';

export interface ZoneMeta {
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  tone: ZoneTone;
  description: string;
  actuatorsSummary: string;
}

export const ZONE_META: Record<Zone, ZoneMeta> = {
  [Zone.GREEN]: {
    label: 'Безопасная зона',
    shortLabel: 'В норме',
    icon: ShieldCheck,
    tone: 'ok',
    description: 'Внутри пастбища (> 20 м от забора). Все актуаторы отключены.',
    actuatorsSummary: 'Покой',
  },
  [Zone.YELLOW]: {
    label: 'Предупреждение',
    shortLabel: 'Звук',
    icon: TriangleAlert,
    tone: 'warn',
    description: 'Приближение к границе (5–20 м). Нарастающий акустический сигнал 800–2400 Гц.',
    actuatorsSummary: 'Звук',
  },
  [Zone.ORANGE]: {
    label: 'Опасность',
    shortLabel: 'Звук + Вибро',
    icon: OctagonAlert,
    tone: 'danger',
    description: 'Предграничная зона (0–5 м). Максимальный звук и непрерывная вибрация.',
    actuatorsSummary: 'Звук + Вибро',
  },
  [Zone.RED]: {
    label: 'За периметром',
    shortLabel: 'Нарушение',
    icon: Ban,
    tone: 'critical',
    description: 'Выход за границу пастбища. Разрешен импульс 150 мс при валидном GPS.',
    actuatorsSummary: 'Импульс 150мс',
  },
  [Zone.ESCAPE]: {
    label: 'Побег (Анти-паника)',
    shortLabel: 'Побег',
    icon: Siren,
    tone: 'critical',
    description: 'Скот удалился > 100 м или бежит > 15 км/ч. Импульс заблокирован.',
    actuatorsSummary: 'Импульс блок',
  },
  [Zone.UNKNOWN]: {
    label: 'Нет надежных данных',
    shortLabel: 'Нет данных',
    icon: HelpCircle,
    tone: 'unknown',
    description: 'Слабый сигнал GPS, высокий HDOP или потеря связи. Все актуаторы выключены.',
    actuatorsSummary: 'Все OFF',
  },
};
