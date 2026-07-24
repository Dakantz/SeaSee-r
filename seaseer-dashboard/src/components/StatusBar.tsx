export default function StatusBar() {
    return (
        <footer
            style={{
                position: "fixed",
                bottom: 0,
                left: 0,
                width: "100%",
                height: "30px",
                background: "#2b2b2b",
                color: "white",
                display: "flex",
                alignItems: "center",
                paddingLeft: "20px",
                zIndex: 1000,
            }}
        >
            Status: Ready
        </footer>
    );
}