import { Routes, Route } from "react-router-dom";
import "./App.css";

import Toolbar from "./components/Toolbar";
import Workspace from "./components/Workspace/Workspace";
import StatusBar from "./components/StatusBar";
import ExampleDiagnostics from "./components/ExampleDiagnostics.tsx";

function App() {
    return (
        <div className="app">
            <Toolbar />
            <Routes>
                <Route 
                    path="/" 
                    element={
                        <>
                            <Workspace />
                            <StatusBar />
                        </>
                    } 
                />
                <Route path="/exampleDiagnostics" element={<ExampleDiagnostics />} />
            </Routes>
        </div>
    );
}

export default App;