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
          <div className="tc-format-toggle" role="tablist" aria-label="Console display format">
            <button
              type="button"
              role="tab"
              aria-selected={formatMode === 'console'}
              className={`tc-toggle-btn ${formatMode === 'console' ? 'active' : ''}`}
              onClick={() => setFormatMode('console')}
              title="Formatted Console Output"
            >
              Console Log
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={formatMode === 'raw'}
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
            aria-label="Copy terminal output"
            title="Copy log text to clipboard"
          >
            {copyFeedback ? (
              <>
                <svg className="tc-btn-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>Copied</span>
              </>
            ) : (
              <>
                <svg className="tc-btn-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                  <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                </svg>
                <span>Copy</span>
              </>
            )}
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
            <code>{JSON.stringify(job, null, 2)}</code>
          </pre>
        ) : (
          <div className="tc-console-stream">
            {/* Terminal Command Prompt */}
            <div className="tc-log-line prompt">
              <span className="tc-prompt-symbol">$</span> seaseer-worker --job-id={job.id} --task={job.task_type || 'default'}
            </div>

            {/* Init & Status Line */}
            <div className="tc-log-line info">
              <time className="tc-timestamp">[{new Date(job.created_at).toLocaleTimeString()}]</time> [INFO] Initialized worker process context. Task status: <strong className={`tc-status-tag status-${job.status.toLowerCase()}`}>{job.status}</strong>
            </div>

            {/* Progress Output */}
            <div className="tc-log-line info">
              <time className="tc-timestamp">[{new Date().toLocaleTimeString()}]</time> [PROGRESS] Active execution progress: {(job.progress || 0).toFixed(1)}%
            </div>

            {/* Collapsible Payload Group */}
            {job.payload && (
              <details
                className="tc-group"
                open={isPayloadExpanded}
                onToggle={(e) => setIsPayloadExpanded(e.currentTarget.open)}
              >
                <summary className="tc-group-header">
                  <span className="tc-group-title">
                    <svg className="tc-group-caret" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                    [PAYLOAD CONTEXT]
                  </span>
                  <span className="tc-group-count">{Object.keys(job.payload).length} keys</span>
                </summary>
                <pre className="tc-group-body">
                  <code>{JSON.stringify(job.payload, null, 2)}</code>
                </pre>
              </details>
            )}

            {/* Highlighted Error Traceback Block */}
            {job.error_message && (
              <div className="tc-error-block">
                <div className="tc-error-header">
                  <svg className="tc-error-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <span>[ERROR TRACEBACK REASON]</span>
                </div>
                <pre className="tc-error-body">
                  <code>{job.error_message}</code>
                </pre>
              </div>
            )}

            {/* Collapsible Result Output Group */}
            {job.result && (
              <details
                className="tc-group result-group"
                open={isResultExpanded}
                onToggle={(e) => setIsResultExpanded(e.currentTarget.open)}
              >
                <summary className="tc-group-header">
                  <span className="tc-group-title">
                    <svg className="tc-group-caret" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                    [RESULT OUTPUT]
                  </span>
                  <span className="tc-group-count">Success Output</span>
                </summary>
                <pre className="tc-group-body success">
                  <code>{JSON.stringify(job.result, null, 2)}</code>
                </pre>
              </details>
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
          aria-label="Scroll to latest logs"
          title="Scroll to latest logs"
        >
          <svg className="tc-btn-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M16.707 10.293a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-6-6a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l4.293-4.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          <span>Jump to bottom</span>
        </button>
      )}
    </div>
  );
};
