export const roles = Object.fromEntries(
  [
    'Owner',
    'Leader',
    'Deputy Leader',
    'High',
    'Main',
    'Member',
    'Recruit',
    'Trial',
    'Ticket Support',
    'Moderator',
    'Blacklisted',
  ].map((n) => [n.toLowerCase().replaceAll(' ', '_'), n]),
);
roles.control_recruit = 'Recruit · сотрудник набора';
export const channels = Object.fromEntries(
  [
    'Welcome',
    'Goodbye',
    'Rules',
    'Applications',
    'Application Results',
    'Interview Queue',
    'Tier Applications',
    'Tier Results',
    'Support',
    'Reports',
    'Moderation Logs',
    'Ticket Logs',
    'Member Logs',
    'Security Logs',
    'Family Announcements',
    'Events',
    'Captures',
    'Suggestions',
    'Giveaways',
    'Staff Only',
    'Bot Status',
  ].map((n) => [n.toLowerCase().replaceAll(' ', '_'), n.toLowerCase().replaceAll(' ', '-')]),
);
export const categories = {
  active: 'Активные обращения',
  recruitment: 'Набор',
  tier: 'Заявки на тир',
  report: 'Разбор жалоб',
  administration: 'Обращения к руководству',
  closed: 'Закрытые обращения',
};
export const leaders = ['owner', 'leader', 'deputy_leader'];
export const recruitment = [...leaders, 'high'];
export const support = [...leaders, 'ticket_support'];
export const moderators = [...leaders, 'moderator'];
export const privateChannels = new Set([
  'reports',
  'moderation_logs',
  'ticket_logs',
  'member_logs',
  'security_logs',
  'staff_only',
  'interview_queue',
]);
export const q = (key, label, required = true) => ({ key, label, required });
export const recruitQuestions = [
  q('static', 'Ваш статик'),
  q('nick', 'Ваш игровой никнейм'),
  q('age', 'Ваш возраст OOC'),
  q('source', 'Откуда узнали о семье KARMA?'),
  q('online', 'Ваш средний онлайн'),
];
export const tierQuestions = [
  q('static', 'Ваш статик'),
  q('nick', 'Ваш игровой никнейм'),
  q('current', 'Текущий тир'),
  q('desired', 'Код желаемого тира'),
  q('proof', 'Ссылки на доказательства'),
];
export const reportQuestions = [
  q('target', 'Discord ID нарушителя'),
  q('category', 'Категория нарушения'),
  q('reason', 'Причина'),
  q('proof', 'Доказательства'),
  q('extra', 'Дополнительная информация', false),
];
function type(title, kind, category, access, questions) {
  return {
    title,
    kind,
    category,
    access,
    questions,
    mode: 'channel',
    limit: 1,
    cooldown: 300,
    priority: 'normal',
    welcome: 'Опишите детали обращения в этом канале.',
    description: title,
    emoji: '',
    log: 'ticket_logs',
    autoClose: 0,
    parent: 'support',
  };
}
export const types = {
  join: type('Вступление в семью KARMA', 'recruit', 'recruitment', recruitment, recruitQuestions),
  tier: type('Получение тира', 'tier', 'tier', recruitment, tierQuestions),
  upgrade: type('Повышение тира', 'tier', 'tier', recruitment, tierQuestions),
  complaint: type('Жалоба на участника', 'report', 'report', moderators, reportQuestions),
  appeal: type('Обжалование наказания', 'support', 'active', moderators, [
    q('reason', 'Решение и основание обжалования'),
  ]),
  support: type('Общая поддержка', 'support', 'active', support, [q('reason', 'С чем нужна помощь?')]),
  partner: type('Сотрудничество', 'support', 'active', leaders, [q('reason', 'Ваше предложение')]),
  staff: type('Жалоба на администрацию', 'report', 'administration', ['owner', 'leader'], reportQuestions),
  leadership: type('Обращение к руководству', 'support', 'administration', leaders, [
    q('reason', 'Ваш вопрос'),
  ]),
  other: type('Другие вопросы', 'support', 'active', support, [q('reason', 'Ваш вопрос')]),
};
export const moduleNames = {
  tickets: 'Обращения',
  recruit: 'Набор',
  tier: 'Тиры',
  report: 'Жалобы',
  family: 'Состав семьи',
  moderation: 'Модерация',
  security: 'Безопасность',
  events: 'Мероприятия',
  voice: 'Голосовая активность',
  points: 'Очки',
  community: 'Голосования и розыгрыши',
  welcome: 'Приветствия',
  roles: 'Роли',
  embeds: 'Шаблоны',
};
export const defaults = {
  retentionDays: 30,
  rejectHours: 24,
  acceptRole: 'member',
  nickname: false,
  domains: [
    'youtube.com',
    'www.youtube.com',
    'youtu.be',
    'imgur.com',
    'i.imgur.com',
    'yapx.ru',
    'twitch.tv',
    'www.twitch.tv',
  ],
  timezone: 'Asia/Tashkent',
  reminders: [60, 30, 15, 5],
  excludedVoice: [],
  autoRole: '',
  verificationRole: '',
  minAccountDays: 3,
  trustedRoles: [],
  trustedUsers: [],
  bannedWords: [],
  blockedDomains: [],
  antiInvite: false,
  logContent: false,
  securityDelete: false,
  logo: '',
  banner: '',
  strikeThreshold: 3,
  welcomeText: 'Добро пожаловать, {user}!',
  goodbyeText: '{user} покинул сервер.',
  floodLimit: 8,
  mentionLimit: 6,
  raidLimit: 10,
  removeOnAccept: ['recruit'],
  attendancePoints: 10,
  trainingPoints: 10,
  achievementRewards: [
    { points: 100, title: 'Участник', bonus: 5 },
    { points: 500, title: 'Ветеран', bonus: 25 },
    { points: 1500, title: 'Опора семьи', bonus: 75 },
  ],
};
