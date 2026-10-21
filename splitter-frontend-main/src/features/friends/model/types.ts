import { z } from 'zod';

/** What the server tells about another person. No email, ever; avatarUrl may be null. */
export const ZUser = z.object({
  id: z.number(),
  username: z.string(),
  uniqueId: z.string(),
  avatarUrl: z.string().nullish().transform((v) => v ?? null),
});
export type User = z.infer<typeof ZUser>;

export const ZRelation = z.enum(['none', 'friend', 'request_sent', 'request_received']);
export const ZGroupStatus = z.enum(['none', 'member', 'invited']);

export const ZSearchHit = ZUser.extend({ relation: ZRelation, groupStatus: ZGroupStatus.optional() });
export type SearchHit = z.infer<typeof ZSearchHit>;

export const ZSearchPage = z.object({
  results: z.array(ZSearchHit),
  nextOffset: z.number().nullable(),
  tooShort: z.boolean().optional(),
});

export const ZRequests = z.object({
  incoming: z.array(z.object({ id: z.number(), createdAt: z.string().optional(), from: ZUser })),
  outgoing: z.array(z.object({ id: z.number(), createdAt: z.string().optional(), to: ZUser })),
});
export type RequestsPayload = z.infer<typeof ZRequests>;
