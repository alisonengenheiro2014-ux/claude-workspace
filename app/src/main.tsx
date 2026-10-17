import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/index.css";
import { DesignPage } from "./design/DesignPage";
import { ToastProvider } from "./ui/Toast";

// The editor screens arrive with /replica-build. Until then the app opens
// on the design system page; #/design keeps working after that.
function App() {
  return <DesignPage />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
