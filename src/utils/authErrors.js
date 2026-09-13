/**
 * Maps raw Supabase authentication errors to clean, user-friendly messages.
 * Prevents leaking low-level database or backend details.
 */
export function mapAuthError(error) {
  if (!error) return null;
  const message = error.message || '';
  const lower = message.toLowerCase();

  if (lower.includes('invalid login credentials') || lower.includes('invalid_grant')) {
    return 'Invalid email or password. Please verify your credentials and try again.';
  }
  if (lower.includes('user already registered') || lower.includes('already exists')) {
    return 'An account with this email address already exists. Please sign in instead.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Your email address has not been confirmed yet. Please check your inbox for the verification link.';
  }
  if (lower.includes('password should be at least') || lower.includes('weak password')) {
    return 'Password is too weak. Please use at least 6 characters.';
  }
  if (lower.includes('network') || lower.includes('failed to fetch')) {
    return 'Unable to reach the server. Please check your internet connection.';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'Too many attempts. Please wait a moment before trying again.';
  }
  return message || 'An unexpected authentication error occurred. Please try again.';
}
