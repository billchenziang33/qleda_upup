import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { IeltsBackgroundScene } from "./IeltsBackgroundScene";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <IeltsBackgroundScene />
    <App />
  </StrictMode>
);
