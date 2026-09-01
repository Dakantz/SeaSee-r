import React from "react";
import type { CustomQuery, QuerySummaryData } from "./CustomQueryManager";
import QuerySummary from "./QuerySummary";
import { FilterBuilder } from "./FilterBuilder";
import PointProgressBar from "./PointProgressBar";
import { usePLYPointCloudContext } from "./PLYPointCloudContext";
import type { FilterRule } from "./utils/filterUtils.ts";

export interface QuerySelectorProps {
  /** The custom query item data */
  query: CustomQuery;
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
  /** Handler to update query fields (name, filters, etc.) */
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
  onRefreshSummary: (queryId: string, filters?: FilterRule[]) => void;
  /** Indicates whether this query is currently hovered */
  isHovered?: boolean;
  /** Handler triggered when mouse enters/leaves the query card */
  onHover?: (id: string | null) => void;
  /** Initial expanded state (defaults to false / collapsed) */
  defaultExpanded?: boolean;
  /** Controlled expanded state (optional) */
  isExpanded?: boolean;
  /** Callback triggered when expanded state changes */
  onToggleExpand?: (expanded: boolean) => void;
  /** Optional override for number of points loaded */
  loadedPointCount?: number;
}

/**
 * QuerySelector Component
 * Represents a single custom query card item in the query manager list.
 * Supports expanding and collapsing into one single line (collapsed by default).
 * Displays a live point loading progress bar that becomes 100% full when LOD0 is loaded.
 * Includes name editing, visual filter builder, status indicators, action buttons, and embeds QuerySummary.
 */
export const QuerySelector: React.FC<QuerySelectorProps> = ({
  query,
  isHovered,
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
  onHover,
  defaultExpanded = false,
  isExpanded: externalIsExpanded,
  onToggleExpand,
  loadedPointCount: propLoadedPointCount,
}) => {
  const [internalIsExpanded, setInternalIsExpanded] = React.useState<boolean>(defaultExpanded);

  const isExpanded = externalIsExpanded !== undefined ? externalIsExpanded : internalIsExpanded;

  const handleToggleExpand = () => {
    const nextState = !isExpanded;
    if (externalIsExpanded === undefined) {
      setInternalIsExpanded(nextState);
    }
    onToggleExpand?.(nextState);
  };

  let ctx: ReturnType<typeof usePLYPointCloudContext> | null = null;
  try {
    ctx = usePLYPointCloudContext();
  } catch {
    // Context unavailable
  }

  // Determine actual number of points loaded from 3D context
  let loadedPoints = propLoadedPointCount ?? 0;
  if (ctx && propLoadedPointCount === undefined && ctx.pointCount) {
    loadedPoints = ctx.pointCount;
  }

  return (
    <div
      className={`query-selector ${isExpanded ? "query-selector--expanded" : "query-selector--collapsed"} ${isHovered ? "query-selector--hovered" : ""}`}
      onMouseEnter={() => onHover?.(query.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      {/* Item Top Row: Expand/Collapse Toggle, Name Editor, Stream Badges & Actions */}
      <div className="query-selector__top-row">
        <button
          type="button"
          className="query-selector__toggle-btn"
          onClick={handleToggleExpand}
          title={isExpanded ? "Collapse query details" : "Expand query details"}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? "Collapse query details" : "Expand query details"}
        >
          {isExpanded ? "▼" : "▶"}
        </button>

        <div className="query-selector__name-wrapper">
          <input
            type="text"
            value={query.name}
            onChange={(e) => onUpdateQuery(query.id, "name", e.target.value)}
            placeholder="Query Name..."
            className="query-selector__name-input"
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
          ) : null}

          <button
            type="button"
            title="Focus camera on bounding box center"
            onClick={() => onFocusQuery(query)}
            className="query-selector__btn--focus"
          >
            🎯 Focus
          </button>

          <button
            type="button"
            title={ctx?.editingPointcloudId === query.id ? "Stop editing transform" : "Edit spatial transform (Move/Rotate/Scale)"}
            onClick={() => {
              if (!ctx) return;
              if (ctx.editingPointcloudId === query.id) {
                ctx.setEditingPointcloudId(null);
                ctx.setGizmoMode(null);
              } else {
                ctx.setEditingPointcloudId(query.id);
                ctx.setGizmoMode("translate");
              }
            }}
            style={{
              padding: '4px 8px',
              borderRadius: '4px',
              border: '1px solid #475569',
              backgroundColor: ctx?.editingPointcloudId === query.id ? '#2563eb' : '#1e293b',
              color: 'white',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'all 0.2s',
            }}
          >
            ✏️ {ctx?.editingPointcloudId === query.id ? "Editing" : "Edit"}
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
              className="query-selector__btn--stream"
            >
              ⚡ Stream
            </button>
          )}

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

      {/* Mini Progress Bar in Collapsed View */}
      {!isExpanded && (isLoadingStream || isLoadedStream || loadedPoints > 0) && (
        <PointProgressBar
          loadedPoints={loadedPoints}
          totalPoints={summary?.total_points}
          isLoadingStream={isLoadingStream}
          isLoadedStream={isLoadedStream}
          compact
        />
      )}

      {/* Expandable Details Content */}
      {isExpanded && (
        <>
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
            loadedPoints={loadedPoints}
            isLoadingStream={isLoadingStream}
            isLoadedStream={isLoadedStream}
          />

          {/* Card Controls & Status Bar */}
          <div className="query-selector__bottom-bar">
            <span className={`query-selector__status-text ${saveStatus === "Error saving" ? "query-selector__status-text--error" : ""}`}></span>
          </div>
        </>
      )}
    </div>
  );
};

export default QuerySelector;


