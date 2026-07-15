#!/bin/bash

# Integration Test Runner for Canonical Representation State
# Requires: Supabase running, environment variables configured

echo "🧪 Starting Canonical Representation State Integration Tests..."
echo ""

# Set environment
export API_BASE_URL="http://localhost:3000"

# Run TypeScript test file
npx tsx tests/integration/representation-state.test.ts
