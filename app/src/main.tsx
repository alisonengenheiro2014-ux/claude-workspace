import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/index.css";
import { useRoute } from "./app/router";
import { watchForUpdates } from "./app/updates";
import { DesignPage } from "./design/DesignPage";
import { Editor } from "./screens/Editor";
import { Home } from "./screens/Home";
import { ToastProvider } from "./ui/Toast";

function App() {
  const route = useRoute();
  if (route.name === "editor") return <Editor key={route.projectId} projectId={route.projectId} />;
  if (route.name === "design") return <DesignPage />;
  return <Home />;
}

watchForUpdates();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
