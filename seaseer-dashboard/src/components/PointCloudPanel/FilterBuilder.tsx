import React from "react";
import type { FilterRule, FilterOperator } from "./utils/filterUtils.ts";

const AVAILABLE_FIELDS = [
  { label: "Point Cloud ID", value: "pointcloud_id", type: "string" },
  { label: "Points Count", value: "number_of_points", type: "number" },
  { label: "Original Filename", value: "orig_filename", type: "string" },
  { label: "Video Start Time", value: "video_start_at", type: "datetime-local" },
  { label: "Video Stop Time", value: "video_stop_at", type: "datetime-local" },
  { label: "Min X", value: "min_x", type: "number" },
  { label: "Max X", value: "max_x", type: "number" },
  { label: "Min Y", value: "min_y", type: "number" },
  { label: "Max Y", value: "max_y", type: "number" },
  { label: "Min Z", value: "min_z", type: "number" },
  { label: "Max Z", value: "max_z", type: "number" },
];

const SPATIAL_FIELDS = ["min_x", "max_x", "min_y", "max_y", "min_z", "max_z"];

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
        const isSpatial = SPATIAL_FIELDS.includes(rule.field);
        const availableOperators = isSpatial
          ? OPERATORS.filter((op) => op.value === "eq")
          : OPERATORS;

        const handleFieldChange = (newField: string) => {
          const isNewSpatial = SPATIAL_FIELDS.includes(newField);
          updateRule(rule.id, {
            field: newField,
            operator: isNewSpatial ? "eq" : rule.operator,
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
              value={isSpatial ? "eq" : rule.operator}
              onChange={(e) => updateRule(rule.id, { operator: e.target.value as FilterOperator })}
              disabled={isSpatial}
              title={isSpatial ? "Spatial bounds filter operator is locked to '='" : undefined}
              className={`filter-builder__select filter-builder__select--operator ${isSpatial ? "filter-builder__select--disabled" : ""}`}
            >
              {availableOperators.map((op) => (
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
