import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import ChatPage from "@/pages/ChatPage";
import ProfilePage from "@/pages/ProfilePage";
import PracticePage from "@/pages/PracticePage";
import PathPage from "@/pages/PathPage";
import DashboardPage from "@/pages/DashboardPage";
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
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/practice" element={<PracticePage />} />
        <Route path="/literature" element={<LiteraturePage />} />
        <Route path="/universe" element={<UniversePage />} />
        <Route path="/path" element={<PathPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
    </AppShell>
  );
}
