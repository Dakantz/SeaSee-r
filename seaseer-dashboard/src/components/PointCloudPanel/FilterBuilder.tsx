import React from "react";
import type { FilterRule, FilterOperator } from "./utils/filterUtils.ts";

const AVAILABLE_FIELDS = [
  { label: "Point Cloud ID", value: "pointcloud_id", type: "string" },
  { label: "Job ID", value: "job_id", type: "string" },
  { label: "Video Metadata ID", value: "video_metadata_id", type: "string" },
  { label: "Original Filename", value: "orig_filename", type: "string" },
  { label: "Safe Filename", value: "safe_filename", type: "string" },
  { label: "Points Count", value: "number_of_points", type: "number" },
  { label: "Min X", value: "min_x", type: "number" },
  { label: "Max X", value: "max_x", type: "number" },
  { label: "Min Y", value: "min_y", type: "number" },
  { label: "Max Y", value: "max_y", type: "number" },
  { label: "Min Z", value: "min_z", type: "number" },
  { label: "Max Z", value: "max_z", type: "number" },
  { label: "Created At", value: "created_at", type: "datetime-local" },
  { label: "Video Start Time", value: "video_start_at", type: "datetime-local" },
  { label: "Video Stop Time", value: "video_stop_at", type: "datetime-local" },
  { label: "Reconstruction Index", value: "reconstruction_index", type: "number" },
  { label: "Views", value: "views", type: "number" },
  { label: "Sparse Points", value: "sparse_points", type: "number" },
  { label: "Dense Points", value: "dense_points", type: "number" },
];

const OPERATORS: { label: string; value: FilterOperator }[] = [
  { label: "=", value: "eq" },
  { label: "≠", value: "ne" },
  { label: ">", value: "gt" },
  { label: "≥", value: "gte" },
  { label: "<", value: "lt" },
  { label: "≤", value: "lte" },
  { label: "contains", value: "like" },
  { label: "in list", value: "in" },
];

const generateUniqueId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `rule-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
};

interface FilterBuilderProps {
  filters: FilterRule[];
  onChange: (filters: FilterRule[]) => void;
}

export const FilterBuilder: React.FC<FilterBuilderProps> = ({ filters, onChange }) => {
  const addRule = () => {
    onChange([
      ...filters,
      { id: generateUniqueId(), field: "number_of_points", operator: "gte", value: "" },
    ]);
  };

  const updateRule = (id: string, updates: Partial<FilterRule>) => {
    onChange(filters.map((r) => (r.id === id ? { ...r, ...updates } : r)));
  };

  const removeRule = (id: string) => {
    onChange(filters.filter((r) => r.id !== id));
  };

  return (
    <div className="filter-builder">
      {filters.map((rule) => {
        const fieldConfig = AVAILABLE_FIELDS.find((f) => f.value === rule.field);

        const handleFieldChange = (newField: string) => {
          updateRule(rule.id, {
            field: newField,
            operator: rule.operator,
            value: "",
          });
        };

        return (
          <div key={rule.id} className="filter-builder__rule">
            {/* Field Selector */}
            <select
              value={rule.field}
              onChange={(e) => handleFieldChange(e.target.value)}
              className="filter-builder__select"
            >
              {AVAILABLE_FIELDS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>

            {/* Operator Selector */}
            <select
              value={rule.operator}
              onChange={(e) => updateRule(rule.id, { operator: e.target.value as FilterOperator })}
              className="filter-builder__select filter-builder__select--operator"
            >
              {OPERATORS.map((op) => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </select>

            {/* Value Input */}
            <input
              type={fieldConfig?.type || "text"}
              step={fieldConfig?.type === "number" ? "any" : undefined}
              value={rule.value}
              onChange={(e) => updateRule(rule.id, { value: e.target.value })}
              placeholder="Value..."
              className="filter-builder__input"
            />

            {/* Remove Rule */}
            <button type="button" onClick={() => removeRule(rule.id)} className="filter-builder__remove-btn" title="Remove filter">
              ✕
            </button>
          </div>
        );
      })}

      <button type="button" onClick={addRule} className="filter-builder__add-btn">
        + Add Filter Condition
      </button>
    </div>
  );
};

export default FilterBuilder;
