import React from "react";
import type { CustomQuery, QuerySummaryData } from "./CustomQueryManager";
import QuerySummary from "./QuerySummary";
import { FilterBuilder } from "./FilterBuilder";
import type { FilterRule } from "./utils/filterUtils.ts";

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
  /** Handler to update query fields (name, queryText, filters, etc.) */
  onUpdateQuery: (id: string, field: string, value: any) => void;
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
 * Includes name editing, visual filter builder, status indicators, action buttons, and embeds QuerySummary.
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
    <div className={`query-selector ${isActive ? "query-selector--active" : ""}`}>
      {/* Item Top Row: Name Editor, Stream Badges & Delete */}
      <div className="query-selector__top-row">
        <div className="query-selector__name-wrapper">
          <input
            type="text"
            value={query.name}
            onChange={(e) => onUpdateQuery(query.id, "name", e.target.value)}
            placeholder="Query Name..."
            className={`query-selector__name-input ${isActive ? "query-selector__name-input--active" : ""}`}
          />
        </div>

        <div className="query-selector__actions">
          {isLoadingStream ? (
            <span className="query-selector__badge query-selector__badge--streaming">
              🌀 Streaming
            </span>
          ) : isLoadedStream ? (
            <span className="query-selector__badge query-selector__badge--streamed">
              ⚡ Streamed
            </span>
          ) : isActive ? (
            <span className="query-selector__badge query-selector__badge--active">
              Active
            </span>
          ) : null}

          <button
            type="button"
            title="Delete query"
            onClick={() => onDeleteQuery(query.id)}
            className="query-selector__delete-btn"
          >
            🗑️
          </button>
        </div>
      </div>

      {/* Visual Filter Builder UI */}
      <div className="query-selector__filters-section">
        <div className="query-selector__section-label">
          Filters (Flexible Comparators)
        </div>

        <FilterBuilder
          filters={query.filters || []}
          onChange={(newFilters: FilterRule[]) => onUpdateQuery(query.id, "filters", newFilters)}
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
      <div className="query-selector__bottom-bar">
        <span className={`query-selector__status-text ${saveStatus === "Error saving" ? "query-selector__status-text--error" : ""}`}>
          {saveStatus ? saveStatus : "Auto-saved"}
        </span>

        <div className="query-selector__btn-group">
          <button
            type="button"
            title="Focus camera on bounding box center"
            onClick={() => onFocusQuery(query)}
            className="query-selector__btn--focus"
          >
            🎯 Focus
          </button>

          {isLoadedStream || isLoadingStream ? (
            <button
              type="button"
              title="Unload this query from 3D scene"
              onClick={() => onUnloadQuery?.(query)}
              className="query-selector__btn--unload"
            >
              ⏸️ Unload
            </button>
          ) : (
            <button
              type="button"
              title="Run / Stream this query"
              onClick={() => onRunQuery(query)}
              className={`query-selector__btn--stream ${isActive ? "query-selector__btn--stream-active" : ""}`}
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
