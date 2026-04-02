export const braintrustDatasetName = "Helpr Seed Dataset";

export function getBraintrustProjectName(): string | undefined {
  return process.env.BRAINTRUST_PROJECT;
}

export function requireBraintrustProjectName(): string {
  const projectName = getBraintrustProjectName();

  if (!projectName) {
    throw new Error("BRAINTRUST_PROJECT is required.");
  }

  return projectName;
}

export function getBraintrustDatasetName(): string {
  return braintrustDatasetName;
}
