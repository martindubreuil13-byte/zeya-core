// Authenticated fetch helper for browser-side API calls
// Automatically includes Bearer token from Supabase session
// Handles 401 response with optional retry

import type { Session } from '@supabase/supabase-js';

export interface AuthenticatedFetchOptions extends RequestInit {
  retryOn401?: boolean; // Default: true
}

/**
 * Make an authenticated API call with Supabase session token
 * Only use in browser context where session is available
 */
export async function authenticatedFetch(
  url: string,
  session: Session | null,
  options: AuthenticatedFetchOptions = {}
): Promise<Response> {
  const { retryOn401 = true, ...fetchOptions } = options;

  if (!session?.access_token) {
    return new Response(
      JSON.stringify({ success: false, error: 'No session available' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const headers = new Headers(fetchOptions.headers || {});
  headers.set('Authorization', `Bearer ${session.access_token}`);

  const response = await fetch(url, {
    ...fetchOptions,
    headers,
  });

  // Handle 401 - token may have expired, but don't retry here
  // (Token refresh is handled by auth provider)
  if (response.status === 401 && retryOn401) {
    console.warn('[authenticated-fetch] Received 401, not retrying (auth provider handles refresh)');
  }

  return response;
}
