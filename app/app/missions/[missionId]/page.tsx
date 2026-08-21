import { MissionExecutiveBriefPage } from "@/components/briefing-room/MissionExecutiveBriefPage";

export default async function Page({ params }: { params: Promise<{ missionId: string }> }) {
  const { missionId } = await params;
  return <MissionExecutiveBriefPage missionId={missionId} />;
}
