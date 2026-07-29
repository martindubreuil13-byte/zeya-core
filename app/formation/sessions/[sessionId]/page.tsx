'use client';

import { useParams } from 'next/navigation';
import { FormationWorkflow } from '@/components/formation/FormationWorkflow';

export default function FormationSessionPage() {
  const params = useParams();
  const sessionId = params.sessionId as string;

  return <FormationWorkflow sessionId={sessionId} />;
}
