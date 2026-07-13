import "./App.css";

import Toolbar from "./components/Toolbar";
import Workspace from "./components/Workspace/Workspace";
import StatusBar from "./components/StatusBar";

function App() {
    return (
        <div className="app">
            <Toolbar />
            <Workspace />
            <StatusBar />
        </div>
    );
}

export default App;