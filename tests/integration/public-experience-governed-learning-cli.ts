export type GovernedLearningScenario = "provenance" | "frozen" | "authority" | "isolation";

export function readScenario(args: readonly string[]): GovernedLearningScenario {
  const index = args.indexOf("--scenario");
  if (index === -1) throw new Error("missing governed-learning scenario");
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error("missing governed-learning scenario");
  if (!["provenance", "frozen", "authority", "isolation"].includes(value)) {
    throw new Error(`unknown governed-learning scenario: ${value}`);
  }
  return value as GovernedLearningScenario;
}
