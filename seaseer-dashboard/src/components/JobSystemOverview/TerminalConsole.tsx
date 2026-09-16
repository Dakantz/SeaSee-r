import React, { useState, useEffect, useRef } from 'react';
import type { JobResponse } from '../../client';

export interface TerminalConsoleProps {
  job: JobResponse;
  className?: string;
  style?: React.CSSProperties;
}

type FormatMode = 'console' | 'raw';

export const TerminalConsole: React.FC<TerminalConsoleProps> = ({
  job,
  className = '',
  style,
}) => {
  const [formatMode, setFormatMode] = useState<FormatMode>('console');
  const [isPayloadExpanded, setIsPayloadExpanded] = useState<boolean>(true);
  const [isResultExpanded, setIsResultExpanded] = useState<boolean>(true);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState<boolean>(false);
  const [copyFeedback, setCopyFeedback] = useState<boolean>(false);

  const consoleContainerRef = useRef<HTMLDivElement | null>(null);
  const isManualScrollRef = useRef<boolean>(false);

  // Auto-scroll to bottom when logs update, unless user manually scrolled up
  useEffect(() => {
    if (!consoleContainerRef.current || isManualScrollRef.current) return;
    consoleContainerRef.current.scrollTop = consoleContainerRef.current.scrollHeight;
  }, [job.progress, job.status, job.result, job.error_message, formatMode]);

  const handleScroll = () => {
    if (!consoleContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = consoleContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 30;

    if (isAtBottom) {
      isManualScrollRef.current = false;
      setShowScrollBottomBtn(false);
    } else {
      isManualScrollRef.current = true;
      setShowScrollBottomBtn(true);
    }
  };

  const scrollToBottom = () => {
    if (!consoleContainerRef.current) return;
    consoleContainerRef.current.scrollTo({
      top: consoleContainerRef.current.scrollHeight,
      behavior: 'smooth',
    });
    isManualScrollRef.current = false;
    setShowScrollBottomBtn(false);
  };

  const handleCopyLogs = () => {
    const textToCopy =
      formatMode === 'raw'
        ? JSON.stringify(job, null, 2)
        : `$ seaseer-worker --job-id=${job.id} --task=${job.task_type || 'default'}\n` +
          `[INFO] Job Status: ${job.status}\n` +
          (job.payload ? `[PAYLOAD] ${JSON.stringify(job.payload, null, 2)}\n` : '') +
          (job.error_message ? `[ERROR TRACEBACK] ${job.error_message}\n` : '') +
          (job.result ? `[RESULT] ${JSON.stringify(job.result, null, 2)}\n` : '');

    navigator.clipboard.writeText(textToCopy);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  return (
    <div className={`terminal-console ${className}`} style={style}>
      {/* Console Controls Header */}
      <div className="tc-header">
        <div className="tc-header-title">
          <span className="tc-title-text">execution.log — bash / redis-rq</span>
        </div>

        <div className="tc-header-actions">
          {/* Format Switcher */}
          <div className="tc-format-toggle">
            <button
              type="button"
              className={`tc-toggle-btn ${formatMode === 'console' ? 'active' : ''}`}
              onClick={() => setFormatMode('console')}
              title="Formatted Console Output"
            >
              Console Log
            </button>
            <button
              type="button"
              className={`tc-toggle-btn ${formatMode === 'raw' ? 'active' : ''}`}
              onClick={() => setFormatMode('raw')}
              title="Raw JSON Payload & Result"
            >
              Raw JSON
            </button>
          </div>

          <button
            type="button"
            className="tc-copy-btn"
            onClick={handleCopyLogs}
            title="Copy log text to clipboard"
          >
            {copyFeedback ? '✓ Copied' : '📋 Copy'}
          </button>
        </div>
      </div>

      {/* Console Output Scroll Box */}
      <div
        className="tc-body"
        ref={consoleContainerRef}
        onScroll={handleScroll}
      >
        {formatMode === 'raw' ? (
          <pre className="tc-raw-json">
            {JSON.stringify(job, null, 2)}
          </pre>
        ) : (
          <div className="tc-console-stream">
            {/* Terminal Command Prompt */}
            <div className="tc-log-line prompt">
              <span className="tc-prompt-symbol">$</span> seaseer-worker --job-id={job.id} --task={job.task_type || 'default'}
            </div>

            {/* Init & Status Line */}
            <div className="tc-log-line info">
              <span className="tc-timestamp">[{new Date(job.created_at).toLocaleTimeString()}]</span> [INFO] Initialized worker process context. Task status: <strong className={`tc-status-tag status-${job.status.toLowerCase()}`}>{job.status}</strong>
            </div>

            {/* Progress Output */}
            <div className="tc-log-line info">
              <span className="tc-timestamp">[{new Date().toLocaleTimeString()}]</span> [PROGRESS] Active execution progress: {(job.progress || 0).toFixed(1)}%
            </div>

            {/* Collapsible Payload Group */}
            {job.payload && (
              <div className="tc-group">
                <button
                  type="button"
                  className="tc-group-header"
                  onClick={() => setIsPayloadExpanded((prev) => !prev)}
                >
                  <span>{isPayloadExpanded ? '▼' : '▶'} [PAYLOAD CONTEXT]</span>
                  <span className="tc-group-count">{Object.keys(job.payload).length} keys</span>
                </button>
                {isPayloadExpanded && (
                  <pre className="tc-group-body">
                    {JSON.stringify(job.payload, null, 2)}
                  </pre>
                )}
              </div>
            )}

            {/* Highlighted Error Traceback Block */}
            {job.error_message && (
              <div className="tc-error-block">
                <div className="tc-error-header">
                  <span className="tc-error-icon">⚠️</span>
                  <span>[ERROR TRACEBACK REASON]</span>
                </div>
                <pre className="tc-error-body">
                  {job.error_message}
                </pre>
              </div>
            )}

            {/* Collapsible Result Output Group */}
            {job.result && (
              <div className="tc-group result-group">
                <button
                  type="button"
                  className="tc-group-header"
                  onClick={() => setIsResultExpanded((prev) => !prev)}
                >
                  <span>{isResultExpanded ? '▼' : '▶'} [RESULT OUTPUT]</span>
                  <span className="tc-group-count">Success Output</span>
                </button>
                {isResultExpanded && (
                  <pre className="tc-group-body success">
                    {JSON.stringify(job.result, null, 2)}
                  </pre>
                )}
              </div>
            )}

            {/* Execution Finish Marker */}
            {job.status === 'COMPLETED' && (
              <div className="tc-log-line success-line">
                [SUCCESS] Task execution completed cleanly. Exit code 0.
              </div>
            )}
            {job.status === 'FAILED' && (
              <div className="tc-log-line error-line">
                [FAILED] Task execution terminated with errors. Exit code 1.
              </div>
            )}
            {job.status === 'CANCELLED' && (
              <div className="tc-log-line cancel-line">
                [CANCELLED] Task execution was interrupted by user request. Exit code 130.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Floating Jump to Bottom Button */}
      {showScrollBottomBtn && (
        <button
          type="button"
          className="tc-jump-bottom-btn"
          onClick={scrollToBottom}
          title="Scroll to latest logs"
        >
          ↓ Jump to bottom
        </button>
      )}
    </div>
  );
};
