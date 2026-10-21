/** The profile fields every user-facing endpoint returns. Never add `password` here. */
export const PROFILE_SELECT = {
  id: true,
  email: true,
  username: true,
  uniqueId: true,
  avatarUrl: true,
} as const;

/** What other people may see about a user: no email, ever. */
export const PUBLIC_USER_SELECT = {
  id: true,
  username: true,
  uniqueId: true,
  avatarUrl: true,
} as const;
