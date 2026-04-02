import { ProjectNameIdMap, login } from "braintrust";

export type BraintrustIfExists = "error" | "ignore" | "replace";

export type BraintrustFunctionRecord = {
  id: string;
  _xact_id?: string | null;
  project_id: string;
  name: string;
  slug: string;
  function_type?: string | null;
  description?: string | null;
};

type BraintrustListResponse<T> = {
  objects: T[];
};

function getBraintrustApiBaseUrl(): string {
  return (process.env.BRAINTRUST_API_URL ?? "https://api.braintrust.dev").replace(/\/+$/, "");
}

export function requireBraintrustApiKey(): string {
  const apiKey = process.env.BRAINTRUST_API_KEY;

  if (!apiKey) {
    throw new Error("BRAINTRUST_API_KEY is required.");
  }

  return apiKey;
}

export async function ensureBraintrustProject(projectName: string): Promise<string> {
  await login();
  const projectMap = new ProjectNameIdMap();

  return projectMap.getId(projectName);
}

type BraintrustApiRequestOptions = {
  body?: unknown;
  method?: string;
};

export async function braintrustApiRequest<T>(
  path: string,
  options: BraintrustApiRequestOptions = {},
): Promise<T> {
  const response = await fetch(`${getBraintrustApiBaseUrl()}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${requireBraintrustApiKey()}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Braintrust API request failed (${response.status} ${response.statusText}): ${text}`);
  }

  return (await response.json()) as T;
}

export async function listProjectFunctions(
  projectId: string,
  options: { functionType?: string; slug?: string } = {},
): Promise<BraintrustFunctionRecord[]> {
  const params = new URLSearchParams({
    project_id: projectId,
  });

  if (options.functionType) {
    params.set("function_type", options.functionType);
  }

  if (options.slug) {
    params.set("slug", options.slug);
  }

  const result = await braintrustApiRequest<BraintrustListResponse<BraintrustFunctionRecord>>(
    `/v1/function?${params.toString()}`,
  );

  return result.objects;
}

export async function getProjectFunctionBySlug(
  projectId: string,
  slug: string,
  functionType = "scorer",
): Promise<BraintrustFunctionRecord> {
  const matches = (await listProjectFunctions(projectId, { functionType })).filter(
    (record) => record.slug === slug,
  );

  if (matches.length === 0) {
    throw new Error(`Could not find Braintrust ${functionType} with slug ${slug} in project ${projectId}.`);
  }

  return matches[0]!;
}
