export type FilterOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "like";

export interface FilterRule {
  id: string;
  field:
    | "pointcloud_id"
    | "number_of_points"
    | "orig_filename"
    | "video_start_at"
    | "video_stop_at"
    | "min_x"
    | "max_x"
    | "min_y"
    | "max_y"
    | "min_z"
    | "max_z"
    | string;
  operator: FilterOperator;
  value: string | number;
}

export interface StreamQueryParams {
  lod: number;
  filters?: FilterRule[] | null;
}

export const SPATIAL_FIELDS = ["min_x", "max_x", "min_y", "max_y", "min_z", "max_z"];

export function isSpatialFilter(rule: FilterRule): boolean {
  return SPATIAL_FIELDS.includes(rule.field);
}

export function sanitizeNonSpatialFilters(filters?: FilterRule[] | null): FilterRule[] {
  if (!filters || !Array.isArray(filters)) return [];
  return filters.filter((rule) => !isSpatialFilter(rule));
}

/**
 * Converts filter rules into standard URLSearchParams
 * e.g. { field: "number_of_points", operator: "gte", value: 50000 }
 * -> "number_of_points__gte=50000"
 */
export function buildFilterQueryParams(params: StreamQueryParams): URLSearchParams {
  const searchParams = new URLSearchParams();
  searchParams.set("lod", (params?.lod ?? 0).toString());

  const cleanFilters = sanitizeNonSpatialFilters(params?.filters);
  if (!cleanFilters.length) return searchParams;

  for (const rule of cleanFilters) {
    if (rule.value === "" || rule.value === undefined || rule.value === null) continue;

    const paramKey = rule.operator === "eq" ? rule.field : `${rule.field}__${rule.operator}`;
    searchParams.append(paramKey, String(rule.value));
  }

  return searchParams;
}

