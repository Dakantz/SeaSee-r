import React, { useState } from "react";
import { Link } from "react-router-dom";
import { FiAlertTriangle, FiArrowRight, FiX } from "react-icons/fi";
import "./LegacyBanner.css";

interface LegacyBannerProps {
    pageName: string;
}

export const LegacyBanner: React.FC<LegacyBannerProps> = ({ pageName }) => {
    const [dismissed, setDismissed] = useState(false);

    if (dismissed) {
        return null;
    }

    return (
        <div className="legacy-banner" role="alert" aria-live="polite">
            <div className="legacy-banner-left">
                <span className="legacy-banner-icon">
                    <FiAlertTriangle size={18} />
                </span>
                <span className="legacy-banner-badge">Legacy</span>
                <span className="legacy-banner-text">
                    <strong className="legacy-banner-target">{pageName}</strong> is a legacy page that is no longer supposed to be used.
                </span>
            </div>
            <div className="legacy-banner-actions">
                <Link to="/" className="legacy-banner-link-btn">
                    <span>Go to PointCloud Overview</span>
                    <FiArrowRight size={14} />
                </Link>
                <button
                    type="button"
                    className="legacy-banner-dismiss-btn"
                    onClick={() => setDismissed(true)}
                    title="Dismiss notification"
                    aria-label="Dismiss notification"
                >
                    <FiX size={16} />
                </button>
            </div>
        </div>
    );
};

export default LegacyBanner;
