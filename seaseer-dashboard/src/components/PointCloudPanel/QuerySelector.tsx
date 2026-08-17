import React from "react";
import type { CustomQuery, QuerySummaryData } from "./CustomQueryManager";
import QuerySummary from "./QuerySummary";

export interface QuerySelectorProps {
  /** The custom query item data */
  query: CustomQuery;
  /** Indicates whether this query is currently active/selected */
  isActive: boolean;
  /** Indicates whether points for this query are actively streaming */
  isLoadingStream: boolean;
  /** Indicates whether points for this query are fully streamed/loaded in 3D scene */
  isLoadedStream: boolean;
  /** Optional auto-save status feedback message */
  saveStatus?: string;
  /** Calculated query summary data */
  summary?: QuerySummaryData | null;
  /** Summary calculation loading state */
  summaryLoading?: boolean;
  /** Summary calculation error state */
  summaryError?: string | null;
  /** Handler to update query name or queryText */
  onUpdateQuery: (id: string, field: "name" | "queryText", value: string) => void;
  /** Handler to delete a query */
  onDeleteQuery: (id: string) => void;
  /** Handler to run/stream a query */
  onRunQuery: (query: CustomQuery) => void;
  /** Handler to unload a query from the 3D scene */
  onUnloadQuery?: (query: CustomQuery) => void;
  /** Handler to focus camera on the query bounding box center */
  onFocusQuery: (query: CustomQuery) => void;
  /** Handler to refresh/re-fetch summary information for a query */
  onRefreshSummary: (queryId: string, queryText: string) => void;
}

/**
 * QuerySelector Component
 * Represents a single custom query card item in the query manager list.
 * Includes name editing, SQL text editor, status indicators, action buttons, and embeds QuerySummary.
 */
export const QuerySelector: React.FC<QuerySelectorProps> = ({
  query,
  isActive,
  isLoadingStream,
  isLoadedStream,
  saveStatus,
  summary,
  summaryLoading,
  summaryError,
  onUpdateQuery,
  onDeleteQuery,
  onRunQuery,
  onUnloadQuery,
  onFocusQuery,
  onRefreshSummary,
}) => {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "12px",
        borderRadius: "var(--radius-md, 6px)",
        background: isActive
          ? "var(--color-bg-accent-subtle, rgba(59, 130, 246, 0.12))"
          : "var(--color-bg-subtle, #14151b)",
        border: isActive
          ? "1px solid var(--color-accent, #3b82f6)"
          : "1px solid var(--color-border-subtle, #2a2b36)",
        transition: "all 0.15s ease-in-out",
      }}
    >
      {/* Item Top Row: Name Editor, Stream Badges & Delete */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: 1 }}>
          <input
            type="text"
            value={query.name}
            onChange={(e) => onUpdateQuery(query.id, "name", e.target.value)}
            placeholder="Query Name..."
            style={{
              background: "transparent",
              border: "1px solid transparent",
              borderRadius: "var(--radius-sm, 4px)",
              color: isActive
                ? "var(--color-text-primary, #ffffff)"
                : "var(--color-text-secondary, #d1d5db)",
              fontWeight: isActive ? 600 : 500,
              fontSize: "var(--font-size-sm, 13px)",
              padding: "2px 4px",
              outline: "none",
              flex: 1,
            }}
            onFocus={(e) => {
              e.target.style.border = "1px solid var(--color-border-strong, #374151)";
              e.target.style.background = "var(--color-bg-card, #1e1e24)";
            }}
            onBlur={(e) => {
              e.target.style.border = "1px solid transparent";
              e.target.style.background = "transparent";
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            flexShrink: 0,
          }}
        >
          {isLoadingStream ? (
            <span
              style={{
                fontSize: "10px",
                padding: "2px 6px",
                borderRadius: "var(--radius-sm, 4px)",
                background: "rgba(245, 158, 11, 0.2)",
                color: "#fbbf24",
                fontWeight: 500,
              }}
            >
              🌀 Streaming
            </span>
          ) : isLoadedStream ? (
            <span
              style={{
                fontSize: "10px",
                padding: "2px 6px",
                borderRadius: "var(--radius-sm, 4px)",
                background: "rgba(16, 185, 129, 0.2)",
                color: "#34d399",
                fontWeight: 500,
              }}
            >
              ⚡ Streamed
            </span>
          ) : isActive ? (
            <span
              style={{
                fontSize: "10px",
                padding: "2px 6px",
                borderRadius: "var(--radius-sm, 4px)",
                background: "rgba(59, 130, 246, 0.2)",
                color: "#60a5fa",
                fontWeight: 500,
              }}
            >
              Active
            </span>
          ) : null}

          <button
            type="button"
            title="Delete query"
            onClick={() => onDeleteQuery(query.id)}
            style={{
              background: "rgba(248, 113, 113, 0.1)",
              border: "1px solid rgba(248, 113, 113, 0.3)",
              color: "#f87171",
              borderRadius: "var(--radius-sm, 4px)",
              padding: "3px 6px",
              fontSize: "11px",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            🗑️
          </button>
        </div>
      </div>

      {/* SQL Query Textarea */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <textarea
          rows={4}
          value={query.queryText}
          onChange={(e) => onUpdateQuery(query.id, "queryText", e.target.value)}
          placeholder="Enter SQL query (e.g. SELECT PC_Explode(patch)...)"
          style={{
            background: "var(--color-bg-card, #1e1e24)",
            border: "1px solid var(--color-border-strong, #2a2b36)",
            color: "#00e5ff",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: "11px",
            lineHeight: "1.4",
            padding: "8px",
            borderRadius: "var(--radius-sm, 4px)",
            resize: "vertical",
            width: "100%",
            boxSizing: "border-box",
            outline: "none",
          }}
        />
      </div>

      {/* Summary Information Display Panel */}
      <QuerySummary
        query={query}
        summary={summary}
        isLoading={summaryLoading}
        error={summaryError}
        onRefreshSummary={onRefreshSummary}
        onFocusQuery={onFocusQuery}
      />

      {/* Card Controls & Status Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "2px",
        }}
      >
        <span
          style={{
            fontSize: "11px",
            color: saveStatus === "Error saving" ? "#f87171" : "var(--color-text-muted, #9ca3af)",
            fontStyle: "italic",
          }}
        >
          {saveStatus ? saveStatus : "Auto-saved"}
        </span>

        <div style={{ display: "flex", gap: "6px" }}>
          <button
            type="button"
            title="Focus camera on bounding box center"
            onClick={() => onFocusQuery(query)}
            style={{
              background: "rgba(16, 185, 129, 0.15)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              color: "#34d399",
              borderRadius: "var(--radius-sm, 4px)",
              padding: "3px 8px",
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s ease",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            🎯 Focus
          </button>

          {isLoadedStream || isLoadingStream ? (
            <button
              type="button"
              title="Unload this query from 3D scene"
              onClick={() => onUnloadQuery?.(query)}
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#f87171",
                borderRadius: "var(--radius-sm, 4px)",
                padding: "3px 10px",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "background 0.15s ease",
              }}
            >
              ⏸️ Unload
            </button>
          ) : (
            <button
              type="button"
              title="Run / Stream this query"
              onClick={() => onRunQuery(query)}
              style={{
                background: isActive
                  ? "var(--color-bg-button, #2563eb)"
                  : "var(--color-bg-subtle, #1f2937)",
                border: isActive ? "none" : "1px solid var(--color-border-strong, #374151)",
                color: "#ffffff",
                borderRadius: "var(--radius-sm, 4px)",
                padding: "3px 10px",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "background 0.15s ease",
              }}
            >
              ⚡ Stream
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuerySelector;
