# Job System Overview UI Component (`JobSystemOverview.tsx`)

## Overview

The `JobSystemOverview` component ([JobSystemOverview.tsx](file:///home/tastegger/Documents/SeaSee-r/seaseer-dashboard/src/components/JobSystemOverview/JobSystemOverview.tsx)) is a React dashboard UI module in the SeaSee-r frontend. It provides real-time monitoring, visualization, and management of background job pipelines and standalone asynchronous tasks (such as video frame extraction, OpenSfM 3D reconstruction, and PostGIS point cloud ingestion).

It interfaces with the backend Job System REST API (`/jobs`, `/jobs/pipelines`) and provides stage-based Directed Acyclic Graph (DAG) graph visualization, matrix tabular views, live runtime timing, adaptive polling, optimistic state updates, and log inspection.

---

## Component Architecture & Hierarchy

The component is modularized into several focused sub-components within `seaseer-dashboard/src/components/JobSystemOverview/`:

```
JobSystemOverview/
├── JobSystemOverview.tsx      # Main container component (state, polling, views, actions)
├── PipelineGraph.tsx          # Stage-based DAG graph renderer with SVG Bezier curves
├── StageColumn.tsx            # Stage column wrapper grouping jobs by topological depth
├── JobNode.tsx                # Individual job card with status badge, progress, & actions
├── JobDetailsDrawer.tsx       # Slide-out drawer displaying metadata & execution logs
├── TerminalConsole.tsx        # Interactive log console with auto-scroll & search
└── JobSystemOverview.css      # Component styling system
```

---

## Key Technical Features

### 1. Dual View Modes

- **Pipeline Graph View (`viewMode === 'pipeline'`)**: Renders visual stage-based DAG graphs via [`PipelineGraph`](file:///home/tastegger/Documents/SeaSee-r/seaseer-dashboard/src/components/JobSystemOverview/PipelineGraph.tsx). Computes job topological depth using Kahn's logic and places jobs into columns (`Pre-Processing`, `Reconstruction`, `Ingestion`, etc.). Connects parent and child jobs using dynamic SVG Bezier connector curves with status-aware stroke styling.
- **Job Matrix View (`viewMode === 'matrix'`)**: Renders a dense tabular matrix view showing status badges, job names, IDs, task types, progress bars, runtime timers, and inline action buttons.

### 2. Smart Adaptive Auto-Polling

Integrated with the custom [`useJobSystemStatus`](file:///home/tastegger/Documents/SeaSee-r/seaseer-dashboard/src/hooks/useJobSystemStatus.ts) React hook:
- **Fast Polling** (default: `2500ms`): Triggered automatically when active jobs (`RUNNING` or `PENDING`) exist in the system.
- **Slow/Idle Polling** (default: `30000ms`): Switched to automatically when all recent jobs are idle or finished, reducing server load.
- **Visual Badge**: Live indicator in the header showing `LIVE` (fast polling) or `IDLE` (slow polling) with pulse animations.

### 3. Real-Time Live Runtime Timer & Centralized Date Formatting

- Implements a centralized 1-second `setInterval` state tick (`now`) in `JobSystemOverview.tsx` active whenever running/pending pipelines or jobs are present.
- Passes `now` down through `PipelineGraph`, `StageColumn`, `JobNode`, and `JobDetailsDrawer` to eliminate multiple desynchronized interval timers.
- Centralizes date and time formatting in [`dateUtils.ts`](file:///home/tastegger/Documents/SeaSee-r/seaseer-dashboard/src/utils/dateUtils.ts), enforcing a 24-hour model (`YYYY-MM-DD HH:mm:ss` and `HH:mm:ss`) without AM/PM across drawer metadata and tooltips.
- Computes dynamic live durations (`calculateDuration`) for active jobs/pipelines before server completion timestamps are populated.

### 4. Optimistic UI Updates & Actions

- **Retry Job (`handleRetryJob`)**: Optimistically updates local state to `PENDING` (or `BLOCKED` if parent dependencies remain unfulfilled), then triggers backend `retryJob` API.
- **Cancel Job (`handleCancelJob`)**: Optimistically marks target and downstream pipeline jobs as `CANCELLED`, calling backend `cancelJob` API.
- **Delete Pipeline (`handleDeletePipeline`)**: Confirms deletion and deletes pipeline along with associated jobs (`deleteJob`).
- **Download Full Logs (`handleDownloadFullLogs`)**: Aggregates job execution metadata, error messages, and raw output JSON payloads across pipeline jobs into a downloadable text log file (`pipeline_logs_<timestamp>.txt`).

### 5. URL Deep-Linking & Filtering

- **URL Query Sync**: Checks `?jobId=<id>` search parameter on load/change to automatically open the target job in the [`JobDetailsDrawer`](file:///home/tastegger/Documents/SeaSee-r/seaseer-dashboard/src/components/JobSystemOverview/JobDetailsDrawer.tsx).
- **Click-Outside & Escape Dismissal**: The drawer automatically dismisses when clicking anywhere outside the drawer panel or when pressing the `Escape` key, while seamlessly allowing clicks on other job nodes to switch selection.
- **Search Box**: Client-side text filter matching job names, pipeline names, job UUIDs, or task types in real time.

---

## Component Props Reference (`JobSystemOverviewProps`)

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `limit` | `number` | `10` | Maximum number of recent jobs to fetch. |
| `activePollInterval` | `number` | `2500` | Fast polling interval (ms) when active jobs exist. |
| `idlePollInterval` | `number` | `30000` | Slow polling interval (ms) when all jobs are idle. |
| `autoPoll` | `boolean` | `true` | Enables or disables automatic polling. |
| `title` | `string` | `'Job Pipelines'` | Custom header title text. |
| `compact` | `boolean` | `false` | Enables compact layout mode for sidebars/popovers. |
| `className` | `string` | `''` | Custom root CSS class name. |
| `style` | `React.CSSProperties` | `undefined` | Inline styling object. |
| `onJobSelect` | `(job: JobResponse) => void` | `undefined` | Callback fired when a job item is selected. |
