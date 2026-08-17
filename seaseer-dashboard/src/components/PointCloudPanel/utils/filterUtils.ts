export type FilterOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "like";

export interface FilterRule {
  id: string;
  field: "pointcloud_id" | "number_of_points" | "video_start_at" | string;
  operator: FilterOperator;
  value: string | number;
}

export interface StreamQueryParams {
  lod: number;
  filters?: FilterRule[] | null;
}

/**
 * Converts filter rules into standard URLSearchParams
 * e.g. { field: "number_of_points", operator: "gte", value: 50000 }
 * -> "number_of_points__gte=50000"
 */
export function buildFilterQueryParams(params: StreamQueryParams): URLSearchParams {
  const searchParams = new URLSearchParams();
  searchParams.set("lod", (params?.lod ?? 0).toString());

  if (!params?.filters || !Array.isArray(params.filters)) return searchParams;

  for (const rule of params.filters) {
    if (rule.value === "" || rule.value === undefined || rule.value === null) continue;

    const paramKey = rule.operator === "eq" ? rule.field : `${rule.field}__${rule.operator}`;
    searchParams.append(paramKey, String(rule.value));
  }

  return searchParams;
}
