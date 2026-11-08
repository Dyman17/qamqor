import type { MailMessage } from './mailer';

export type Lang = 'kk' | 'ru' | 'en';
export const LANGS: Lang[] = ['kk', 'ru', 'en'];

export function pickLang(lang?: string): Lang {
  return LANGS.includes(lang as Lang) ? (lang as Lang) : 'ru';
}

function link(base: string | undefined, path: string, token: string): string {
  return base ? `${base.replace(/\/+$/, '')}/${path}?token=${encodeURIComponent(token)}` : '';
}

/*
 * NOTE: the Kazakh (kk) texts are a draft and must be reviewed by a native speaker
 * before they are sent to real users (project rule: no unverified language content).
 */

export function invitationMail(
  lang: Lang,
  p: { to: string; farmName: string; inviterName: string; token: string; baseUrl?: string },
): MailMessage {
  const url = link(p.baseUrl, 'invite', p.token);
  const tail = (code: string, days: string) => `${code}: ${p.token}${url ? `\n${url}` : ''}\n\n${days}`;
  switch (lang) {
    case 'kk':
      return {
        to: p.to,
        subject: `Qamqor: «${p.farmName}» шаруашылығына шақыру`,
        text:
          `Сәлем!\n${p.inviterName} сізді Qamqor қолданбасындағы «${p.farmName}» шаруашылығына қызметкер ретінде шақырды.\n\n` +
          tail('Шақыруды қабылдау коды', 'Шақыру 7 күн бойы жарамды.'),
      };
    case 'en':
      return {
        to: p.to,
        subject: `Qamqor: invitation to "${p.farmName}"`,
        text:
          `Hello!\n${p.inviterName} invited you to join the farm "${p.farmName}" in Qamqor as a worker.\n\n` +
          tail('Invitation code', 'The invitation is valid for 7 days.'),
      };
    default:
      return {
        to: p.to,
        subject: `Qamqor: приглашение в хозяйство «${p.farmName}»`,
        text:
          `Здравствуйте!\n${p.inviterName} приглашает вас в хозяйство «${p.farmName}» в Qamqor в роли работника.\n\n` +
          tail('Код приглашения', 'Приглашение действует 7 суток.'),
      };
  }
}

export function passwordResetMail(
  lang: Lang,
  p: { to: string; token: string; baseUrl?: string },
): MailMessage {
  const url = link(p.baseUrl, 'reset-password', p.token);
  const tail = (code: string, note: string) => `${code}: ${p.token}${url ? `\n${url}` : ''}\n\n${note}`;
  switch (lang) {
    case 'kk':
      return {
        to: p.to,
        subject: 'Qamqor: құпиясөзді қалпына келтіру',
        text:
          'Құпиясөзді қалпына келтіруге сұраныс алынды.\n\n' +
          tail('Қалпына келтіру коды', 'Код 1 сағат бойы жарамды. Егер сұранысты сіз жібермесеңіз, бұл хатты елемеңіз.'),
      };
    case 'en':
      return {
        to: p.to,
        subject: 'Qamqor: password reset',
        text:
          'A password reset was requested for your account.\n\n' +
          tail('Reset code', 'The code is valid for 1 hour. If you did not request this, ignore this email.'),
      };
    default:
      return {
        to: p.to,
        subject: 'Qamqor: сброс пароля',
        text:
          'Получен запрос на сброс пароля.\n\n' +
          tail('Код сброса', 'Код действует 1 час. Если вы не запрашивали сброс, проигнорируйте письмо.'),
      };
  }
}
