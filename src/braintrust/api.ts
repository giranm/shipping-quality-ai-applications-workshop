import { ProjectNameIdMap, login } from "braintrust";

export type BraintrustIfExists = "error" | "ignore" | "replace";

export async function ensureBraintrustProject(projectName: string): Promise<string> {
  await login();
  const projectMap = new ProjectNameIdMap();

  return projectMap.getId(projectName);
}
