'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface OwnerOnboardingProps {
  onStartExperience: () => void;
  onCreateDirect: () => void;
}

export function OwnerOnboarding({ onStartExperience, onCreateDirect }: OwnerOnboardingProps) {
  const [selectedOption, setSelectedOption] = useState<'experience' | 'direct' | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSelect = async (option: 'experience' | 'direct') => {
    setIsLoading(true);
    setSelectedOption(option);

    try {
      if (option === 'experience') {
        await onStartExperience();
      } else {
        await onCreateDirect();
      }
    } catch (err) {
      console.error('[owner-onboarding]', err);
      setIsLoading(false);
      setSelectedOption(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-white mb-4">Welcome to Zeya</h1>
          <p className="text-gray-300 text-lg">
            Let&apos;s build your business representation
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Option 1: Representation Experience (Recommended) */}
          <div
            className={`relative p-8 rounded-lg border-2 transition-all cursor-pointer ${
              selectedOption === 'experience'
                ? 'border-blue-500 bg-blue-50/10'
                : 'border-gray-600 bg-gray-800/50 hover:border-blue-400'
            }`}
            onClick={() => !isLoading && handleSelect('experience')}
          >
            <div className="absolute top-4 right-4 bg-blue-600 text-white px-3 py-1 rounded-full text-sm font-medium">
              Recommended
            </div>

            <div className="mb-4">
              <div className="text-4xl mb-2">🎯</div>
              <h2 className="text-2xl font-bold text-white mb-2">Representation Experience</h2>
            </div>

            <p className="text-gray-300 mb-6">
              Start with our guided experience. You&apos;ll have an initial conversation with Zeya, who will learn about your business and create your first representation.
            </p>

            <div className="space-y-2 mb-6">
              <div className="flex items-start">
                <span className="text-green-400 mr-2">✓</span>
                <span className="text-gray-300">Guided first conversation</span>
              </div>
              <div className="flex items-start">
                <span className="text-green-400 mr-2">✓</span>
                <span className="text-gray-300">Zeya learns your business deeply</span>
              </div>
              <div className="flex items-start">
                <span className="text-green-400 mr-2">✓</span>
                <span className="text-gray-300">Review and approve your representation</span>
              </div>
            </div>

            <button
              onClick={() => !isLoading && handleSelect('experience')}
              disabled={isLoading}
              className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading && selectedOption === 'experience' ? 'Starting...' : 'Start Experience'}
            </button>
          </div>

          {/* Option 2: Direct Creation */}
          <div
            className={`relative p-8 rounded-lg border-2 transition-all cursor-pointer ${
              selectedOption === 'direct'
                ? 'border-purple-500 bg-purple-50/10'
                : 'border-gray-600 bg-gray-800/50 hover:border-purple-400'
            }`}
            onClick={() => !isLoading && handleSelect('direct')}
          >
            <div className="mb-4">
              <div className="text-4xl mb-2">⚡</div>
              <h2 className="text-2xl font-bold text-white mb-2">Create Directly</h2>
            </div>

            <p className="text-gray-300 mb-6">
              Already know what you want? Skip the experience and create your representation directly. Manage details at your own pace.
            </p>

            <div className="space-y-2 mb-6">
              <div className="flex items-start">
                <span className="text-purple-400 mr-2">✓</span>
                <span className="text-gray-300">Full control from the start</span>
              </div>
              <div className="flex items-start">
                <span className="text-purple-400 mr-2">✓</span>
                <span className="text-gray-300">Define your own details</span>
              </div>
              <div className="flex items-start">
                <span className="text-purple-400 mr-2">✓</span>
                <span className="text-gray-300">Manage your representation immediately</span>
              </div>
            </div>

            <button
              onClick={() => !isLoading && handleSelect('direct')}
              disabled={isLoading}
              className="w-full px-6 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading && selectedOption === 'direct' ? 'Creating...' : 'Create Directly'}
            </button>
          </div>
        </div>

        <p className="text-center text-gray-400 text-sm mt-8">
          You can change your choice later. Both paths lead to the same representation workspace.
        </p>
      </div>
    </div>
  );
}
