import { notFound } from "next/navigation";
import { isExperienceScreenLabEnabled } from "@/lib/experience/screen-lab";
import { ExperienceScreenLab } from "./screen-lab-client";

export default function ExperienceScreenLabPage() {
  if (!isExperienceScreenLabEnabled(process.env.ZEYA_ENVIRONMENT_TARGET)) {
    notFound();
  }

  return <ExperienceScreenLab />;
}
