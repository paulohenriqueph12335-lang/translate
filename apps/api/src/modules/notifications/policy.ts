import { z } from 'zod';

export const NOTIFICATION_CATEGORIES = ['workflow', 'review', 'failures', 'assignments', 'numbering', 'administration'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type NotificationChannel = 'inApp' | 'browser';
export type NotificationProfile = 'director' | 'leader' | 'operator';
export type CategoryChannels = Record<NotificationCategory, { inApp: boolean; browser: boolean }>;
export type NotificationFrequency = 'immediate' | '5m' | '15m' | '1h';
export type DeliveryMode = 'digest' | 'individual';

const channelPatch = z.strictObject({ inApp: z.boolean().optional(), browser: z.boolean().optional() });
export const NotificationPreferencesPatch = z
  .strictObject({
    notificationsEnabled: z.boolean().optional(),
    notificationFrequency: z.enum(['immediate', '5m', '15m', '1h']).optional(),
    deliveryMode: z.enum(['digest', 'individual']).optional(),
    categories: z
      .strictObject({
        workflow: channelPatch.optional(),
        review: channelPatch.optional(),
        failures: channelPatch.optional(),
        assignments: channelPatch.optional(),
        numbering: channelPatch.optional(),
        administration: channelPatch.optional(),
      })
      .optional(),
    resetToRecommended: z.literal(true).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'Informe ao menos uma preferência');
export type NotificationPreferencesPatch = z.infer<typeof NotificationPreferencesPatch>;

const catalog: Record<NotificationCategory, { label: string; description: string }> = {
  workflow: { label: 'Produção e entregas', description: 'Documentos disponíveis e concluídos.' },
  review: { label: 'Revisão e aprovação', description: 'Conferências, devoluções, aprovações pendentes e tipos novos.' },
  failures: {
    label: 'Erros e emergências',
    description: 'Falhas, processamento parado, bloqueios e entregas aguardando download há 24 horas.',
  },
  assignments: { label: 'Remessas e responsáveis', description: 'Novas atribuições e trabalhos aguardando responsável.' },
  numbering: { label: 'Numeração e cotas', description: 'Pedidos, decisões, anomalias e limites da numeração.' },
  administration: { label: 'Administração', description: 'Avisos administrativos gerais destinados à sua conta.' },
};

export function recommendedCategories(profile: NotificationProfile): CategoryChannels {
  return Object.fromEntries(
    NOTIFICATION_CATEGORIES.map((category) => [
      category,
      { inApp: category === 'workflow' ? profile === 'operator' : category !== 'administration' || profile === 'director', browser: false },
    ]),
  ) as CategoryChannels;
}

export function notificationCatalog(profile: NotificationProfile) {
  const recommended = recommendedCategories(profile);
  const responsibility = {
    director: 'Você acompanha decisões, riscos e pendências da organização.',
    leader: 'Você acompanha decisões, riscos e pendências das equipes que lidera.',
    operator: 'Você acompanha seu trabalho e as atividades disponíveis em suas equipes.',
  }[profile];
  return NOTIFICATION_CATEGORIES.map((id) => ({
    id,
    ...catalog[id],
    reason: responsibility,
    recommended: recommended[id].inApp,
  }));
}

export function classifyNotification(kind: string) {
  let category: NotificationCategory = 'administration';
  if (['translation_ready', 'translation_approved'].includes(kind)) category = 'workflow';
  else if (['translation_submitted', 'translation_returned', 'pattern_unknown', 'approval_waiting'].includes(kind)) category = 'review';
  else if (['translation_failed', 'review_blocked', 'processing_stalled', 'download_waiting'].includes(kind)) category = 'failures';
  else if (['batch_assigned', 'translation_assigned', 'unassigned_work'].includes(kind)) category = 'assignments';
  else if (kind.startsWith('numbering_') || kind.startsWith('quota_')) category = 'numbering';
  const severity =
    kind === 'review_blocked' || kind === 'quota_exhausted'
      ? 'critical'
      : ['translation_failed', 'processing_stalled'].includes(kind)
        ? 'error'
        : [
              'translation_returned',
              'numbering_anomaly',
              'quota_warning',
              'approval_waiting',
              'download_waiting',
              'unassigned_work',
            ].includes(kind)
          ? 'warning'
          : 'info';
  const reason =
    {
      translation_ready: 'Há um documento disponível para sua conferência ou para ser assumido pela equipe.',
      translation_submitted: 'Sua liderança precisa decidir a conclusão deste documento.',
      translation_returned: 'Foram apontadas correções que precisam de nova conferência.',
      translation_failed: 'O processamento terminou com falha e precisa de acompanhamento.',
      review_blocked: 'Três reprovações consecutivas exigem registrar um formato diferente.',
      approval_waiting: 'Um documento aguarda conclusão da liderança há pelo menos 24 horas.',
      download_waiting: 'Um documento concluído aguarda o primeiro download há pelo menos 24 horas.',
      processing_stalled: 'A fila ou o processamento está sem avanço há pelo menos 30 minutos e precisa de acompanhamento.',
      unassigned_work: 'Um trabalho está disponível há pelo menos uma hora sem responsável.',
      pattern_unknown: 'O tipo de documento ainda não possui um exemplo concluído para este fluxo.',
      translation_assigned: 'Você passou a ser responsável por este documento.',
      batch_assigned: 'Uma remessa foi direcionada à sua equipe.',
    }[kind] ?? catalog[category].description;
  return { category, severity, reason };
}

export function deliveryIntervalMs(frequency: NotificationFrequency, mode: DeliveryMode) {
  return { immediate: mode === 'digest' ? 60_000 : 5_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000 }[frequency];
}
