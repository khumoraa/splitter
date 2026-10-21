import type { Response } from "express";

/** Stable machine codes of the friends/groups API. The client translates by `code`; `error` is English for logs/curl. */
export const ERROR_STATUS = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  RATE_LIMITED: 429,
  CANNOT_ADD_SELF: 400,
  ALREADY_FRIENDS: 409,
  REQUEST_EXISTS: 409,
  REQUEST_RECEIVED: 409,
  REQUEST_COOLDOWN: 429,
  REQUEST_NOT_ALLOWED: 403,
  ALREADY_MEMBER: 409,
  NOT_A_MEMBER: 404,
  CANNOT_INVITE_SELF: 400,
  INVITATION_EXISTS: 409,
  INVITATION_NOT_PENDING: 409,
  FRIENDSHIP_REQUIRED: 403,
  OWNER_CANNOT_LEAVE: 400,
  CANNOT_REMOVE_OWNER: 400,
  GROUP_FULL: 409,
  INVITE_LIMIT: 429,
  TOKEN_EXPIRED: 400,
  TOKEN_INVALID: 400,
  OVERPAYMENT: 409,
  OBLIGATION_CLOSED: 409,
  PAYMENT_NOT_PENDING: 409,
  PENDING_PAYMENTS: 409,
  REMINDER_TOO_SOON: 429,
  SESSION_LOCKED: 409,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

const MESSAGE: Record<ErrorCode, string> = {
  UNAUTHORIZED: "Unauthorized",
  FORBIDDEN: "Forbidden",
  NOT_FOUND: "Not found",
  VALIDATION: "Invalid input",
  RATE_LIMITED: "Too many requests. Please try again later.",
  CANNOT_ADD_SELF: "You cannot add yourself",
  ALREADY_FRIENDS: "Already friends",
  REQUEST_EXISTS: "Request already sent",
  REQUEST_RECEIVED: "Awaiting your response",
  REQUEST_COOLDOWN: "This person has not accepted your earlier request; try again later",
  REQUEST_NOT_ALLOWED: "You cannot send a request to this user",
  ALREADY_MEMBER: "Already a member",
  NOT_A_MEMBER: "Not a group member",
  CANNOT_INVITE_SELF: "You cannot invite yourself",
  INVITATION_EXISTS: "An invitation is already pending",
  INVITATION_NOT_PENDING: "The invitation is no longer pending",
  FRIENDSHIP_REQUIRED: "Only friends can be added directly; send an invitation instead",
  OWNER_CANNOT_LEAVE: "The owner cannot leave; transfer ownership first",
  CANNOT_REMOVE_OWNER: "The group owner cannot be removed",
  GROUP_FULL: "The group is full",
  INVITE_LIMIT: "Invitation limit reached",
  TOKEN_EXPIRED: "The invitation link has expired",
  TOKEN_INVALID: "The invitation link is not valid",
  OVERPAYMENT: "The amount is more than what is left to pay",
  OBLIGATION_CLOSED: "This debt is already settled, forgiven or cancelled",
  PAYMENT_NOT_PENDING: "This payment was already confirmed or rejected",
  PENDING_PAYMENTS: "Answer the pending payment first",
  REMINDER_TOO_SOON: "A reminder was already sent in the last 24 hours",
  SESSION_LOCKED: "This bill already has recorded payments and can no longer be changed",
};

export function fail(res: Response, code: ErrorCode, extra: Record<string, unknown> = {}) {
  return res.status(ERROR_STATUS[code]).json({ error: MESSAGE[code], code, ...extra });
}

export const serverError = (res: Response) => res.status(500).json({ error: "Server error", code: "SERVER_ERROR" });
