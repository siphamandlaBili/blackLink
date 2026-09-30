import { z } from 'zod';
import { objectId, pageQuery } from './common.js';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
const reason = z.string().trim().min(3).max(500);

export const dashboardParams = z.object({ businessId: objectId }).strict();
export const dashboardQuery = z.object({ range: z.enum(['30', '90']).default('30').transform(Number) }).strict();

export const reportListQuery = z
  .object({
    status: z.enum(['open', 'kept', 'removed', 'dismissed']).default('open'),
    targetType: z.enum(['review', 'business', 'user', 'post', 'comment']).optional(),
    auto: bool.optional(),
    ...pageQuery,
  })
  .strict();

/** keep: the content stays. remove: the content is taken down. dismiss: the report itself was unfounded. */
export const resolveBody = z.object({ action: z.enum(['keep', 'remove', 'dismiss']), note: z.string().trim().max(500).optional() }).strict();
export const suspendBody = z.object({ reason }).strict();
export const cipcBody = z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional() }).strict();
export const auditQuery = z.object({ targetType: z.string().max(30).optional(), targetId: objectId.optional(), actorId: objectId.optional(), ...pageQuery }).strict();

export const deleteAccountBody = z.object({ confirm: z.literal('DELETE') }).strict();
