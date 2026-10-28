// Auth answers a refused sign-up (no access rule for the email: trigger before_auth_user_created, or
// sign-ups off) with a generic database error; the sign-in page explains it instead.
export const NO_ACCESS_MESSAGE = "This email has no access to Endpoint Inventory. Ask an admin to add your email or your email domain.";

export function signInErrorMessage(message: string): string {
  if (/database error saving new user|signups not allowed|no access for/i.test(message)) return NO_ACCESS_MESSAGE;
  return message;
}
