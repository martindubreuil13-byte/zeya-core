'use client';

import { useState } from 'react';

interface OwnerOnboardingProps {
  onStartExperience: () => void | Promise<void>;
}

export function OwnerOnboarding({ onStartExperience }: OwnerOnboardingProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStartExperience = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await onStartExperience();
    } catch (err) {
      console.error('[owner-onboarding]', err);
      setError('Unable to begin the Experience. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center p-4">
      <div className="max-w-xl w-full">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-white mb-4">Begin with Zeya</h1>
          <p className="text-gray-300 text-lg leading-relaxed">
            Before I represent your business, I need to understand what you do,
            what matters, and where I should be careful.
          </p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-lg p-8 shadow-xl">
          <p className="text-gray-400 text-sm mb-6">
            The Representation Experience is a guided conversation designed to build a
            deep, accurate understanding of your business. Existing work will remain
            available when you return.
          </p>

          <button
            onClick={handleStartExperience}
            disabled={isLoading}
            className="w-full px-6 py-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? 'Beginning...' : 'Begin the Representation Experience'}
          </button>
          {error && (
            <p role="alert" className="mt-4 text-sm text-red-300">
              {error}
            </p>
          )}
        </div>

        <p className="text-center text-gray-500 text-xs mt-8">
          This is your first step. You can pause anytime.
        </p>
      </div>
    </div>
  );
}
