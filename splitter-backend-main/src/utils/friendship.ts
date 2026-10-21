/**
 * Decisions about friend requests and the relation shown in search results. Pure module (no imports).
 * A REJECTED row is kept: the sender cannot re-send for COOLDOWN_MS (and in that time still sees "request sent",
 * so a refusal is never announced). BLOCKED rows stop every request.
 */
export const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export type Status = "PENDING" | "ACCEPTED" | "REJECTED" | "BLOCKED";
export interface Row { id: number; requesterId: number; receiverId: number; status: Status; updatedAt: number }

export type RequestDecision =
  | { action: "create" }
  | { action: "accept"; rowId: number }
  | { action: "reset"; rowId: number }
  | { action: "replace"; rowId: number }
  | { action: "error"; code: "ALREADY_FRIENDS" | "REQUEST_EXISTS" | "REQUEST_NOT_ALLOWED" | "REQUEST_COOLDOWN"; retryAt?: number };

/** `rows` = every friendship row between `me` and the target (either direction). */
export function decideFriendRequest(rows: Row[], me: number, now: number): RequestDecision {
  if (rows.some((r) => r.status === "ACCEPTED")) return { action: "error", code: "ALREADY_FRIENDS" };
  const reciprocal = rows.find((r) => r.status === "PENDING" && r.receiverId === me);
  if (reciprocal) return { action: "accept", rowId: reciprocal.id };
  if (rows.some((r) => r.status === "PENDING" && r.requesterId === me)) return { action: "error", code: "REQUEST_EXISTS" };
  if (rows.some((r) => r.status === "BLOCKED")) return { action: "error", code: "REQUEST_NOT_ALLOWED" };
  const myRejected = rows.find((r) => r.status === "REJECTED" && r.requesterId === me);
  if (myRejected) {
    const retryAt = myRejected.updatedAt + COOLDOWN_MS;
    return now < retryAt ? { action: "error", code: "REQUEST_COOLDOWN", retryAt } : { action: "reset", rowId: myRejected.id };
  }
  const theirRejected = rows.find((r) => r.status === "REJECTED" && r.receiverId === me);
  if (theirRejected) return { action: "replace", rowId: theirRejected.id }; // I refused them earlier; I may ask now
  return { action: "create" };
}

export type Relation = "none" | "friend" | "request_sent" | "request_received";

export function relationOf(rows: Row[], me: number, now: number): Relation {
  if (rows.some((r) => r.status === "ACCEPTED")) return "friend";
  if (rows.some((r) => r.status === "PENDING" && r.receiverId === me)) return "request_received";
  if (rows.some((r) => r.status === "PENDING" && r.requesterId === me)) return "request_sent";
  // a refusal looks like a pending request while the cooldown lasts
  if (rows.some((r) => (r.status === "REJECTED" && r.requesterId === me && now < r.updatedAt + COOLDOWN_MS) || (r.status === "BLOCKED" && r.requesterId === me))) {
    return "request_sent";
  }
  return "none";
}
