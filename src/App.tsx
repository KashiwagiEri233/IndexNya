import { Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import ChatPage from "@/pages/ChatPage";
import PracticePage from "@/pages/PracticePage";
import LiteraturePage from "@/pages/LiteraturePage";
import UniversePage from "@/pages/UniversePage";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/practice" element={<PracticePage />} />
        <Route path="/literature" element={<LiteraturePage />} />
        <Route path="/universe" element={<UniversePage />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
    </AppShell>
  );
}
