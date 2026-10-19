/**
 * 枚举 → 中文 / 颜色映射。
 *
 * 唯一来源是 `@huanbuddy/shared`（后端维护），这里只做「前端命名」到
 * shared 导出名的薄别名，避免重复实现与漂移。
 */
export {
  TASK_STATUS_LABEL as taskStatusLabel,
  TASK_STATUS_COLOR as taskStatusColor,
  PRIORITY_LABEL as priorityLabel,
  PRIORITY_COLOR as priorityColor,
  REJECT_REASON_LABEL as rejectReasonLabel,
  SKILL_STATUS_LABEL as skillStatusLabel,
  TRUST_LEVEL_LABEL as trustLevelLabel,
  PERMISSION_CAPABILITY_LABEL as capabilityLabel,
  PERMISSION_CAPABILITY_ORDER,
  MEMBER_ROLE_LABEL as memberRoleLabel,
  MEMBER_TYPE_LABEL as memberTypeLabel,
  MEMBER_TYPE_COLOR as memberTypeColor,
  AUDIT_RESULT_LABEL as auditResultLabel,
  AUDIT_RESULT_COLOR as auditResultColor,
  MODEL_HEALTH_LABEL as modelHealthLabel,
  MODEL_HEALTH_COLOR as modelHealthColor,
  MODEL_PRIORITY_LABEL as modelPriorityLabel,
  NOTIFICATION_KIND_LABEL as notificationKindLabel,
  FEEDBACK_LABEL as feedbackLabel,
  ACTIVITY_TYPE_LABEL as activityTypeLabel,
  ARTIFACT_TYPE_LABEL as artifactTypeLabel,
  SKILL_SOURCE_LABEL as skillSourceLabel,
  SYNC_SOURCE_TYPE_LABEL as syncSourceTypeLabel,
} from '@/lib/shared';

/** AI 成员用靛蓝底，人类成员用灰底 —— 同一套视觉规则，仅底色不同 */
export function avatarBg(type: 'human' | 'ai'): string {
  return type === 'ai' ? 'var(--ac)' : 'var(--st-2)';
}
