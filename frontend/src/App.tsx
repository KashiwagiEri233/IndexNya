import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import ChatPage from "@/pages/ChatPage";
import PracticePage from "@/pages/PracticePage";
import SettingsPage from "@/pages/SettingsPage";
import LiteraturePage from "@/pages/LiteraturePage";
import UniversePage from "@/pages/UniversePage";
import { useAppStore } from "@/stores/app";

export default function App() {
  const ensureStudent = useAppStore((s) => s.ensureStudent);

  useEffect(() => {
    ensureStudent().catch((e) => console.error("ensureStudent failed:", e));
  }, [ensureStudent]);

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/practice" element={<PracticePage />} />
        <Route path="/literature" element={<LiteraturePage />} />
        <Route path="/universe" element={<UniversePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
    </AppShell>
  );
}
