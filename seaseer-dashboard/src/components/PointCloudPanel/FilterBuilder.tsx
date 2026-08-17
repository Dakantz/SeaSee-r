import React from "react";
import type { FilterRule, FilterOperator } from "./filterUtils";

const AVAILABLE_FIELDS = [
  { label: "Point Cloud ID", value: "pointcloud_id", type: "string" },
  { label: "Points Count", value: "number_of_points", type: "number" },
  { label: "Video Start Time", value: "video_start_at", type: "datetime-local" },
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
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {filters.map((rule) => {
        const fieldConfig = AVAILABLE_FIELDS.find((f) => f.value === rule.field);
        return (
          <div key={rule.id} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            {/* Field Selector */}
            <select
              value={rule.field}
              onChange={(e) => updateRule(rule.id, { field: e.target.value })}
              style={selectStyle}
            >
              {AVAILABLE_FIELDS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>

            {/* Operator Selector */}
            <select
              value={rule.operator}
              onChange={(e) => updateRule(rule.id, { operator: e.target.value as FilterOperator })}
              style={{ ...selectStyle, width: "65px" }}
            >
              {OPERATORS.map((op) => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </select>

            {/* Value Input */}
            <input
              type={fieldConfig?.type || "text"}
              value={rule.value}
              onChange={(e) => updateRule(rule.id, { value: e.target.value })}
              placeholder="Value..."
              style={inputStyle}
            />

            {/* Remove Rule */}
            <button type="button" onClick={() => removeRule(rule.id)} style={removeBtnStyle} title="Remove filter">
              ✕
            </button>
          </div>
        );
      })}

      <button type="button" onClick={addRule} style={addBtnStyle}>
        + Add Filter Condition
      </button>
    </div>
  );
};

const selectStyle: React.CSSProperties = {
  background: "#1e1e24",
  color: "#d1d5db",
  border: "1px solid #2a2b36",
  borderRadius: "4px",
  padding: "4px 6px",
  fontSize: "11px",
  outline: "none",
};

const inputStyle: React.CSSProperties = {
  background: "#1e1e24",
  color: "#00e5ff",
  border: "1px solid #2a2b36",
  borderRadius: "4px",
  padding: "4px 8px",
  fontSize: "11px",
  flex: 1,
  outline: "none",
};

const removeBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#f87171",
  cursor: "pointer",
  fontSize: "11px",
  padding: "2px 4px",
};

const addBtnStyle: React.CSSProperties = {
  background: "rgba(59, 130, 246, 0.1)",
  border: "1px dashed rgba(59, 130, 246, 0.4)",
  color: "#60a5fa",
  borderRadius: "4px",
  padding: "4px 8px",
  fontSize: "11px",
  cursor: "pointer",
  width: "100%",
  marginTop: "4px",
};

export default FilterBuilder;
