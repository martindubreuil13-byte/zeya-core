'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/auth-provider';

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, openAuth } = useAuth();

  // Redirect if already authenticated
  // Use router.replace to avoid history stack issues with auth flow
  useEffect(() => {
    if (user && !loading) {
      router.replace('/formation/entry');
    }
  }, [user, loading, router]);

  // Open auth modal on mount
  useEffect(() => {
    if (!loading && !user) {
      openAuth('sign-in');
    }
  }, [loading, user, openAuth]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border border-gray-300 border-t-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Checking authentication status...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-2">Zeya</h1>
        <p className="text-gray-600">Business Development Engine</p>
        <p className="text-gray-500 text-sm mt-4">Opening authentication...</p>
      </div>
    </div>
  );
}
