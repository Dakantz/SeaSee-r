import { buildFilterQueryParams, type StreamQueryParams } from "./filterUtils.ts";
import type { QuerySummaryData } from "../CustomQueryManager.tsx";

const API_BASE_URL = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/+$/, "");
const API_BASE = `${API_BASE_URL}/pointclouds`;

export async function fetchPointCloudSummary(params: StreamQueryParams): Promise<QuerySummaryData> {
  const queryStr = buildFilterQueryParams(params).toString();
  const response = await fetch(`${API_BASE}/stream-summary?${queryStr}`);
  
  if (!response.ok) {
    throw new Error(`Summary fetch failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

export async function streamPointCloudBinary(
  params: StreamQueryParams,
  signal?: AbortSignal
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const queryStr = buildFilterQueryParams(params).toString();
  const response = await fetch(`${API_BASE}/stream-binary?${queryStr}`, { signal });

  if (!response.ok || !response.body) {
    throw new Error(`Streaming failed (${response.status}): ${await response.text()}`);
  }
  return response.body.getReader();
}
