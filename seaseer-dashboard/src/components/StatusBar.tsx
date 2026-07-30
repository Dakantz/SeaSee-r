export default function StatusBar() {
    return (
        <footer
            style={{
                position: "fixed",
                bottom: 0,
                left: 0,
                width: "100%",
                height: "30px",
                background: "var(--color-bg-panel-alt)",
                color: "var(--color-text-primary)",
                display: "flex",
                alignItems: "center",
                paddingLeft: "var(--spacing-2xl)",
                zIndex: "var(--z-modal)",
            }}
        >
            Status: Ready
        </footer>
    );
}